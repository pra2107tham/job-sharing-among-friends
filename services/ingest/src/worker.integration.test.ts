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

/** How the Android bubble and iOS extension share: raw text, no hash. */
async function seedShareWithoutHash(url: string): Promise<{ jobPostId: string; userId: string }> {
  const client = await pool.connect();
  try {
    const { rows: userRows } = await client.query<{ id: string }>(
      `insert into auth.users (email) values ('native-share@example.test') returning id`,
    );
    const userId = userRows[0]!.id;
    await client.query(`select set_config('request.jwt.claims', $1, false)`, [
      JSON.stringify({ sub: userId, role: 'authenticated' }),
    ]);
    await client.query(`insert into groups (name, created_by) values ('Native test', $1)`, [
      userId,
    ]);

    const { rows } = await client.query<{ job_post_id: string }>(
      `select * from share_job(
         p_client_share_id := gen_random_uuid(),
         p_source_type := 'link',
         p_raw_input := $1)`,
      [url],
    );
    return { jobPostId: rows[0]!.job_post_id, userId };
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

describe.skipIf(!available)('server-side dedupe (M3: native surfaces send no hash)', () => {
  beforeEach(async () => {
    await pool.query('delete from ingest_jobs');
  });

  it('folds a hashless share into the job that already owns the URL', async () => {
    const url = `https://jobs.northwind.test/dupe/${Date.now()}`;

    // First share goes through the JS path, which supplies a hash.
    const first = await seedShare(url);
    await runOnce(pool, stubFetcher(JOB_HTML));

    // Second share arrives the way the Android bubble sends: raw input only.
    const second = await seedShareWithoutHash(url);
    expect(second.jobPostId).not.toBe(first.jobPostId);

    await runOnce(pool, stubFetcher(JOB_HTML));

    // The duplicate row is gone and its delivery now points at the survivor.
    const survivors = await pool.query<{ id: string }>(
      `select id from job_posts where id = any($1::uuid[])`,
      [[first.jobPostId, second.jobPostId]],
    );
    expect(survivors.rows).toHaveLength(1);
    expect(survivors.rows[0]!.id).toBe(first.jobPostId);

    const orphanMessages = await pool.query(`select 1 from messages where job_post_id = $1`, [
      second.jobPostId,
    ]);
    expect(orphanMessages.rows).toHaveLength(0);

    const moved = await pool.query(`select 1 from shares where job_post_id = $1`, [
      first.jobPostId,
    ]);
    // Both shares now hang off the surviving job.
    expect(moved.rows.length).toBeGreaterThanOrEqual(2);
  });

  it('sets the hash when nothing else owns it', async () => {
    const url = `https://jobs.northwind.test/unique/${Date.now()}`;
    const { jobPostId } = await seedShareWithoutHash(url);

    await runOnce(pool, stubFetcher(JOB_HTML));

    const row = await pool.query<{ url_hash: string | null }>(
      `select url_hash from job_posts where id = $1`,
      [jobPostId],
    );
    expect(row.rows[0]?.url_hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('keeps the owner-only job_status when both rows were tracked', async () => {
    const url = `https://jobs.northwind.test/tracked/${Date.now()}`;
    const first = await seedShare(url);
    await runOnce(pool, stubFetcher(JOB_HTML));
    const second = await seedShareWithoutHash(url);

    // Same user tracks both rows, which would collide on merge.
    await pool.query(
      `insert into job_status (user_id, job_post_id, status) values ($1, $2, 'applied'), ($1, $3, 'saved')`,
      [first.userId, first.jobPostId, second.jobPostId],
    );

    await runOnce(pool, stubFetcher(JOB_HTML));

    const status = await pool.query<{ status: string }>(
      `select status from job_status where user_id = $1`,
      [first.userId],
    );
    expect(status.rows).toHaveLength(1);
    // The status on the surviving row wins — it is the job they keep seeing.
    expect(status.rows[0]?.status).toBe('applied');
  });
});
