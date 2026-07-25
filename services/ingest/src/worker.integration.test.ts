import pg from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { runOnce, type Fetcher } from './worker.ts';

/**
 * Runs the real worker against the real schema on the local Postgres harness
 * (scripts/db.sh). Only the network is stubbed.
 *
 * This is the test that proves the pieces fit: share_job queues work, the worker
 * claims it, and the job_post the app renders actually gets filled in. Unit
 * tests on the parser cannot show that.
 *
 * Skipped automatically when no database is reachable, so `pnpm test` still
 * works on a machine that has not run `pnpm db:start`.
 */

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://postgres@127.0.0.1:54329/jobdrop';

/**
 * Connectivity is probed at module load rather than in beforeAll, so the suite
 * can report SKIPPED instead of silently passing when no database is running.
 * A test that quietly passes because it did nothing is worse than no test.
 */
const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 2 });
const available = await pool
  .query('select 1')
  .then(() => true)
  .catch(() => false);

if (!available) {
  console.warn(
    `\n  SKIPPING ingest integration tests: no database at ${DATABASE_URL}.\n  Run \`pnpm db:start && pnpm db:reset\` to exercise them.\n`,
  );
}

const JOB_HTML = `<html><head>
<script type="application/ld+json">
{"@type":"JobPosting","title":"Platform Engineer",
 "hiringOrganization":{"name":"Northwind"},
 "jobLocation":{"address":{"addressLocality":"Pune","addressRegion":"MH"}},
 "description":"<p>Remote friendly. Mail jobs@northwind.test</p>"}
</script></head><body></body></html>`;

const stubFetcher =
  (body: string, status = 200): Fetcher =>
  async (url) => ({ status, body, finalUrl: url });

/** Create a user + group the way the app does, then share through the RPC. */
async function seedShare(url: string): Promise<{ jobPostId: string; userId: string }> {
  const client = await pool.connect();
  try {
    const { rows: userRows } = await client.query<{ id: string }>(
      `insert into auth.users (email) values ('worker-test@example.test') returning id`,
    );
    const userId = userRows[0]!.id;

    await client.query(`select set_config('request.jwt.claims', $1, false)`, [
      JSON.stringify({ sub: userId, role: 'authenticated' }),
    ]);

    const { rows: groupRows } = await client.query<{ id: string }>(
      `insert into groups (name, created_by) values ('Worker test', $1) returning id`,
      [userId],
    );

    const { rows: shareRows } = await client.query<{ job_post_id: string }>(
      `select * from share_job(
         p_client_share_id := gen_random_uuid(),
         p_source_type := 'link',
         p_raw_input := $1,
         p_canonical_url := $1,
         p_url_hash := encode(digest($1, 'sha256'), 'hex'))`,
      [url],
    );

    expect(groupRows[0]).toBeDefined();
    return { jobPostId: shareRows[0]!.job_post_id, userId };
  } finally {
    await client.query(`select set_config('request.jwt.claims', '', false)`).catch(() => {});
    client.release();
  }
}

afterAll(async () => {
  await pool?.end();
});

describe.skipIf(!available)('ingest worker against the real schema', () => {
  // The worker claims the OLDEST queued job, not "the one this test just made".
  // Without this the suite passes or fails depending on whether the SQL suites
  // ran first and left work in the queue — which is exactly the kind of
  // order-dependent green that hides real breakage.
  beforeEach(async () => {
    await pool.query('delete from ingest_jobs');
  });

  it('turns a queued share into an enriched job_post', async () => {
    const url = `https://jobs.northwind.test/roles/${Date.now()}`;
    const { jobPostId } = await seedShare(url);

    const before = await pool.query<{ parse_status: string; title: string | null }>(
      `select parse_status, title from job_posts where id = $1`,
      [jobPostId],
    );
    expect(before.rows[0]?.parse_status).toBe('pending');
    expect(before.rows[0]?.title).toBeNull();

    const worked = await runOnce(pool, stubFetcher(JOB_HTML));
    expect(worked).toBe(true);

    const after = await pool.query<{
      parse_status: string;
      title: string | null;
      company: string | null;
      location: string | null;
      apply_emails: string[];
    }>(`select parse_status, title, company, location, apply_emails from job_posts where id = $1`, [
      jobPostId,
    ]);

    const row = after.rows[0]!;
    expect(row.title).toBe('Platform Engineer');
    expect(row.company).toBe('Northwind');
    expect(row.location).toBe('Pune, MH');
    expect(row.apply_emails).toContain('jobs@northwind.test');
    expect(row.parse_status).toBe('ok');

    const queue = await pool.query<{ status: string }>(
      `select status from ingest_jobs where job_post_id = $1`,
      [jobPostId],
    );
    expect(queue.rows[0]?.status).toBe('done');
  });

  it('marks a 404 dead instead of retrying forever, leaving the card usable', async () => {
    const url = `https://jobs.northwind.test/gone/${Date.now()}`;
    const { jobPostId } = await seedShare(url);

    await runOnce(pool, stubFetcher('', 404));

    const queue = await pool.query<{ status: string; last_error: string }>(
      `select status, last_error from ingest_jobs where job_post_id = $1`,
      [jobPostId],
    );
    expect(queue.rows[0]?.status).toBe('dead');
    expect(queue.rows[0]?.last_error).toContain('404');

    const post = await pool.query<{ parse_status: string; raw_input: string }>(
      `select parse_status, raw_input from job_posts where id = $1`,
      [jobPostId],
    );
    expect(post.rows[0]?.parse_status).toBe('failed');
    // The raw link survives, so the card still shows something the user can open.
    expect(post.rows[0]?.raw_input).toBe(url);
  });

  it('retries a 500 with backoff rather than giving up', async () => {
    const url = `https://jobs.northwind.test/flaky/${Date.now()}`;
    const { jobPostId } = await seedShare(url);

    await runOnce(pool, stubFetcher('', 500));

    const queue = await pool.query<{ status: string; attempts: number; run_after: Date }>(
      `select status, attempts, run_after from ingest_jobs where job_post_id = $1`,
      [jobPostId],
    );
    expect(queue.rows[0]?.status).toBe('queued');
    expect(queue.rows[0]?.attempts).toBe(1);
    expect(queue.rows[0]!.run_after.getTime()).toBeGreaterThan(Date.now());
  });

  it('returns false when the queue is empty', async () => {
    // Drain anything left by earlier tests.
    for (let i = 0; i < 20; i++) {
      if (!(await runOnce(pool, stubFetcher(JOB_HTML)))) break;
    }
    await pool.query(`update ingest_jobs set run_after = now() + interval '1 hour'
                      where status = 'queued'`);

    expect(await runOnce(pool, stubFetcher(JOB_HTML))).toBe(false);
  });
});
