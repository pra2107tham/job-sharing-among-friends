import { canonicalizeUrl, extractEmails } from '@jobdrop/contracts';
import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { looksAuthWalled, parseJobFromHtml, type ParsedJob } from './parse.ts';

/**
 * The enrichment worker (doc 1 §8).
 *
 * Claims work with SELECT ... FOR UPDATE SKIP LOCKED, so several workers can run
 * at once without coordinating and a crashed worker's row is simply picked up by
 * the next one once its lock is released.
 *
 * It connects with a role that bypasses RLS (service_role / direct DB), which is
 * why ingest_jobs has RLS on with no policies: no client can reach this table.
 */

export type IngestJob = {
  id: string;
  job_post_id: string;
  kind: string;
  attempts: number;
  max_attempts: number;
};

export type Fetcher = (url: string) => Promise<{ status: number; body: string; finalUrl: string }>;

/** Real fetch, with the bits that matter for job boards. */
export const httpFetcher: Fetcher = async (url) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        // Identify honestly. Some boards serve better markup to a real UA, but
        // pretending to be a browser to defeat a block is not what this does.
        'User-Agent': 'JobDropBot/0.1 (+https://jobdrop.app/bot)',
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-IN,en;q=0.9',
      },
    });
    // Cap the read: some career pages are enormous and we only need the head.
    const body = (await response.text()).slice(0, 800_000);
    return { status: response.status, body, finalUrl: response.url || url };
  } finally {
    clearTimeout(timeout);
  }
};

const CLAIM_SQL = `
  update ingest_jobs
  set status = 'running', locked_at = now(), attempts = attempts + 1
  where id = (
    select id from ingest_jobs
    where status = 'queued' and run_after <= now()
    order by run_after, created_at
    for update skip locked
    limit 1
  )
  returning id, job_post_id, kind, attempts, max_attempts
`;

export async function claimJob(client: PoolClient): Promise<IngestJob | null> {
  const { rows } = await client.query<IngestJob>(CLAIM_SQL);
  return rows[0] ?? null;
}

/** Exponential backoff with a ceiling: 1m, 2m, 4m … capped at an hour. */
function backoffSeconds(attempts: number): number {
  return Math.min(60 * 2 ** (attempts - 1), 3600);
}

async function failJob(
  client: PoolClient,
  job: IngestJob,
  error: string,
  permanent = false,
): Promise<void> {
  const dead = permanent || job.attempts >= job.max_attempts;
  await client.query(
    `update ingest_jobs
       set status = $2,
           last_error = $3,
           run_after = case when $2 = 'queued' then now() + ($4 || ' seconds')::interval else run_after end
     where id = $1`,
    [job.id, dead ? 'dead' : 'queued', error.slice(0, 500), String(backoffSeconds(job.attempts))],
  );

  if (dead) {
    // The card stays usable — it just shows the hostname and the raw link.
    await client.query(`update job_posts set parse_status = 'failed' where id = $1`, [
      job.job_post_id,
    ]);
  }
}

async function applyParsed(
  client: PoolClient,
  jobPostId: string,
  parsed: ParsedJob,
  canonicalUrl: string | null,
): Promise<void> {
  await client.query(
    `update job_posts set
       title = coalesce($2, title),
       company = coalesce($3, company),
       location = coalesce($4, location),
       work_mode = coalesce($5, work_mode),
       employment_type = coalesce($6, employment_type),
       salary_text = coalesce($7, salary_text),
       description = coalesce($8, description),
       apply_url = coalesce($9, apply_url),
       apply_emails = case when cardinality($10::text[]) > 0 then $10::text[] else apply_emails end,
       og_image_url = coalesce($11, og_image_url),
       favicon_url = coalesce($12, favicon_url),
       source_site = coalesce($13, source_site),
       posted_at = coalesce($14::timestamptz, posted_at),
       closes_at = coalesce($15::timestamptz, closes_at),
       canonical_url = coalesce($16, canonical_url),
       parse_status = $17,
       parse_meta = parse_meta || $18::jsonb
     where id = $1`,
    [
      jobPostId,
      parsed.title ?? null,
      parsed.company ?? null,
      parsed.location ?? null,
      parsed.workMode ?? null,
      parsed.employmentType ?? null,
      parsed.salaryText ?? null,
      parsed.description ?? null,
      parsed.applyUrl ?? null,
      parsed.applyEmails ?? [],
      parsed.ogImageUrl ?? null,
      parsed.faviconUrl ?? null,
      parsed.sourceSite ?? null,
      parsed.postedAt ?? null,
      parsed.closesAt ?? null,
      canonicalUrl,
      parsed.status === 'failed' ? 'partial' : parsed.status,
      JSON.stringify({ parsed_at: new Date().toISOString() }),
    ],
  );
}

/**
 * Unfurl one link job.
 *
 * The client already canonicalised the URL before hashing, but a client can be
 * wrong or out of date, so the worker re-canonicalises server-side and writes
 * the authoritative value back.
 */
export async function processUnfurl(
  client: PoolClient,
  job: IngestJob,
  fetcher: Fetcher,
): Promise<string | void> {
  const { rows } = await client.query<{ canonical_url: string | null; raw_input: string | null }>(
    `select canonical_url, raw_input from job_posts where id = $1`,
    [job.job_post_id],
  );
  const post = rows[0];
  if (!post) {
    await failJob(client, job, 'job_post disappeared', true);
    return;
  }

  const url = canonicalizeUrl(post.canonical_url ?? post.raw_input ?? '');
  if (!url) {
    await failJob(client, job, 'no usable URL', true);
    return;
  }

  const response = await fetcher(url);

  if (response.status === 404 || response.status === 410) {
    // The posting is gone. Retrying will not bring it back.
    await failJob(client, job, `http ${response.status}`, true);
    return;
  }
  if (response.status >= 400) {
    await failJob(client, job, `http ${response.status}`);
    return;
  }

  if (looksAuthWalled(response.body, url)) {
    // Expected on LinkedIn (doc 1 §8). Not a bug, and not worth retrying —
    // the card degrades to the link, which still works for the reader.
    await client.query(
      `update job_posts set parse_status = 'partial',
         source_site = coalesce(source_site, 'linkedin.com'),
         parse_meta = parse_meta || '{"auth_walled": true}'::jsonb
       where id = $1`,
      [job.job_post_id],
    );
    await client.query(`update ingest_jobs set status = 'done' where id = $1`, [job.id]);
    return;
  }

  const parsed = parseJobFromHtml(response.body, response.finalUrl || url);
  await applyParsed(client, job.job_post_id, parsed, url);

  // Authoritative dedupe (0016_merge_job_posts.sql). Native capture surfaces
  // send no hash at all, and a client-computed one can be stale, so the hash is
  // settled here — after redirects have resolved, which is when we finally know
  // the real URL.
  const merged = await dedupeByUrl(client, job.job_post_id, url);

  await client.query(`update ingest_jobs set status = 'done' where id = $1`, [job.id]);
  return merged;
}

/**
 * Give this job its canonical URL hash, or fold it into the job that already
 * owns that hash. Returns the id of whichever row survived.
 */
export async function dedupeByUrl(
  client: PoolClient,
  jobPostId: string,
  canonicalUrl: string,
): Promise<string> {
  const hash = createHash('sha256').update(canonicalUrl).digest('hex');

  const { rows } = await client.query<{ id: string | null }>(
    `select job_post_by_url_hash($1) as id`,
    [hash],
  );
  const existing = rows[0]?.id ?? null;

  if (existing && existing !== jobPostId) {
    await client.query(`select merge_job_posts($1, $2)`, [jobPostId, existing]);
    return existing;
  }

  // Unique partial index on url_hash; another worker may have claimed it in the
  // gap above, in which case fall back to merging rather than erroring.
  try {
    await client.query(`update job_posts set url_hash = $2, canonical_url = $1 where id = $3`, [
      canonicalUrl,
      hash,
      jobPostId,
    ]);
  } catch (err) {
    if ((err as { code?: string }).code === '23505') {
      const { rows: raced } = await client.query<{ id: string | null }>(
        `select job_post_by_url_hash($1) as id`,
        [hash],
      );
      const winner = raced[0]?.id;
      if (winner && winner !== jobPostId) {
        await client.query(`select merge_job_posts($1, $2)`, [jobPostId, winner]);
        return winner;
      }
    }
    throw err;
  }

  return jobPostId;
}

/** Pasted JD text: no fetch, just extraction. */
export async function processText(client: PoolClient, job: IngestJob): Promise<void> {
  const { rows } = await client.query<{ raw_input: string | null }>(
    `select raw_input from job_posts where id = $1`,
    [job.job_post_id],
  );
  const raw = rows[0]?.raw_input ?? '';
  if (!raw.trim()) {
    await failJob(client, job, 'no text to parse', true);
    return;
  }

  const emails = extractEmails(raw);
  // First non-empty line is a serviceable title for a pasted JD; the LLM
  // extraction planned for M4 replaces this.
  const firstLine = raw
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 3 && l.length < 120);

  await client.query(
    `update job_posts set
       title = coalesce(title, $2),
       description = coalesce(description, $3),
       apply_emails = case when cardinality($4::text[]) > 0 then $4::text[] else apply_emails end,
       parse_status = 'partial'
     where id = $1`,
    [job.job_post_id, firstLine ?? null, raw, emails],
  );
  await client.query(`update ingest_jobs set status = 'done' where id = $1`, [job.id]);
}

/** Run one job if any is available. Returns false when the queue is empty. */
export async function runOnce(pool: Pool, fetcher: Fetcher = httpFetcher): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const job = await claimJob(client);
    if (!job) {
      await client.query('commit');
      return false;
    }

    try {
      if (job.kind === 'unfurl') await processUnfurl(client, job, fetcher);
      else if (job.kind === 'parse_text') await processText(client, job);
      else {
        // OCR arrives in M4; leaving it queued would spin, so park it.
        await failJob(client, job, `unsupported kind: ${job.kind}`, true);
      }
    } catch (err) {
      await failJob(client, job, err instanceof Error ? err.message : String(err));
    }

    await client.query('commit');
    return true;
  } catch (err) {
    await client.query('rollback').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
