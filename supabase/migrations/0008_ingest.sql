-- Server-side enrichment queue (doc 1 §8).
--
-- Postgres-backed rather than a separate broker: the volume is low and bursty,
-- and keeping the queue in the same transaction as the job_post insert means a
-- share can never be accepted without its enrichment work being durable.
-- Workers claim rows with SELECT ... FOR UPDATE SKIP LOCKED.

create table ingest_jobs (
  id uuid primary key default gen_random_uuid(),
  job_post_id uuid not null references job_posts(id) on delete cascade,
  kind text not null check (kind in ('unfurl', 'ocr', 'parse_text', 'dedupe', 'refresh')),
  status text not null default 'queued'
    check (status in ('queued', 'running', 'done', 'failed', 'dead')),
  attempts int not null default 0,
  max_attempts int not null default 5,
  last_error text,
  run_after timestamptz not null default now(),
  locked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The claim query's index: ready work, oldest first.
create index ingest_jobs_claim_idx
  on ingest_jobs (run_after, created_at)
  where status = 'queued';

create index ingest_jobs_job_post_idx on ingest_jobs (job_post_id);

create trigger ingest_jobs_set_updated_at
  before update on ingest_jobs
  for each row execute function set_updated_at();

-- Workers connect with the service role, which bypasses RLS. No client ever
-- touches this table, so RLS is on with no policies at all: deny by default.
alter table ingest_jobs enable row level security;
