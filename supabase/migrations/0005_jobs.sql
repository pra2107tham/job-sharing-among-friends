-- Job posts and attachments.
--
-- THIS TABLE IS THE SPINE. docs/03-integration.md §2: the Phase 2 application
-- agent points `applications.job_post_id` here. One row = one real-world job,
-- however many times it gets shared. Do not fork this table.

create table job_posts (
  id uuid primary key default gen_random_uuid(),
  source_type text not null check (source_type in ('link', 'image', 'text')),

  -- Always retained, even when every parse step fails. Doc 1 §5.1: a failed
  -- parse degrades to "a message with a link in it", never to an error.
  raw_input text,

  -- Identity for dedupe. canonical_url has tracking params stripped and
  -- site-specific rules applied (doc 1 §8); url_hash is sha256 of it.
  canonical_url text,
  url_hash text,
  -- For image/text shares that have no URL: hash of normalised extracted text.
  content_hash text,

  title text,
  company text,
  location text,
  work_mode text check (work_mode in ('onsite', 'hybrid', 'remote')),
  employment_type text,
  experience_min int check (experience_min >= 0),
  experience_max int check (experience_max >= 0),
  salary_text text,

  -- The two entry points the Phase 2 agent uses.
  apply_url text,
  apply_emails text[] not null default '{}',

  -- Full JD text, from OCR or paste. Never truncate: it is the agent's
  -- resume-tailoring input (docs/03 §2).
  description text,

  og_image_url text,
  favicon_url text,
  source_site text,

  posted_at timestamptz,
  closes_at timestamptz,

  parse_status text not null default 'pending'
    check (parse_status in ('pending', 'ok', 'partial', 'failed')),
  parse_meta jsonb not null default '{}'::jsonb,

  first_shared_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  check (experience_max is null or experience_min is null or experience_max >= experience_min)
);

-- The dedupe guarantee: two shares of the same URL collapse to one job.
create unique index job_posts_url_hash_uniq
  on job_posts (url_hash)
  where url_hash is not null;

create unique index job_posts_content_hash_uniq
  on job_posts (content_hash)
  where content_hash is not null and url_hash is null;

-- Fuzzy fallback for image/text jobs with no URL (M2 dedupe).
create index job_posts_title_company_trgm
  on job_posts using gin ((coalesce(title, '') || ' ' || coalesce(company, '')) gin_trgm_ops);

create trigger job_posts_set_updated_at
  before update on job_posts
  for each row execute function set_updated_at();

create table job_attachments (
  id uuid primary key default gen_random_uuid(),
  job_post_id uuid not null references job_posts(id) on delete cascade,
  storage_path text not null,
  mime text,
  width int,
  height int,
  ocr_text text,
  created_at timestamptz not null default now()
);

create index job_attachments_job_post_idx on job_attachments (job_post_id);

alter table job_posts enable row level security;
alter table job_attachments enable row level security;
