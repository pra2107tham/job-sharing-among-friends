-- Per-user application tracking.
--
-- PRIVACY LINE (docs/03-integration.md §3.2): this table is readable only by its
-- owner. Nobody in a group ever sees what another member applied to or was
-- rejected from. Group-visible signals, if they ever exist, will be aggregate
-- views built on top of this — never direct reads.

create table job_status (
  user_id uuid not null references profiles(id) on delete cascade,
  job_post_id uuid not null references job_posts(id) on delete cascade,
  status text not null default 'new' check (status in (
    'new', 'saved', 'applied', 'interviewing', 'offer', 'rejected', 'not_interested'
  )),
  applied_at timestamptz,
  notes text,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  primary key (user_id, job_post_id)
);

-- Drives the Tracker tab (doc 1 §5.2), which filters by status per user.
create index job_status_user_status_idx on job_status (user_id, status, updated_at desc);

create trigger job_status_set_updated_at
  before update on job_status
  for each row execute function set_updated_at();

-- Stamp applied_at the first time a row moves to 'applied', so the Tracker can
-- show "applied 6 days ago" without the client having to remember.
create or replace function stamp_applied_at()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'applied' and new.applied_at is null then
    new.applied_at := now();
  end if;
  return new;
end;
$$;

create trigger job_status_stamp_applied_at
  before insert or update on job_status
  for each row execute function stamp_applied_at();

alter table job_status enable row level security;
