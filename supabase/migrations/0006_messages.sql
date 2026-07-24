-- Messages, shares, reactions, read state.

create table messages (
  id uuid primary key default gen_random_uuid(),

  -- A message lives in exactly one place: a group or a DM thread.
  group_id uuid references groups(id) on delete cascade,
  thread_id uuid references dm_threads(id) on delete cascade,

  sender_id uuid references profiles(id) on delete set null,
  kind text not null default 'text' check (kind in ('text', 'job', 'system')),

  -- For kind='text' the message body; for kind='job' the optional note the
  -- sharer attached ("this one's remote"). Doc 1 §5.2 keeps that field because
  -- context is what makes a forwarded job useful.
  body text,
  job_post_id uuid references job_posts(id) on delete cascade,

  -- Client-supplied idempotency key for typed messages. Share fan-out relies on
  -- shares.client_share_id instead, so this is nullable.
  client_msg_id uuid,

  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz,

  constraint message_venue_exclusive check (
    (group_id is not null and thread_id is null) or
    (group_id is null and thread_id is not null)
  ),
  constraint job_message_has_job check (
    (kind = 'job') = (job_post_id is not null)
  ),
  constraint text_message_has_body check (
    kind <> 'text' or (body is not null and char_length(body) between 1 and 4000)
  )
);

create unique index messages_client_msg_id_uniq
  on messages (sender_id, client_msg_id)
  where client_msg_id is not null;

-- The two read paths: a group's timeline, and a thread's timeline.
create index messages_group_created_idx on messages (group_id, created_at desc)
  where group_id is not null;
create index messages_thread_created_idx on messages (thread_id, created_at desc)
  where thread_id is not null;
create index messages_job_post_idx on messages (job_post_id) where job_post_id is not null;

-- One row per (job, group) fan-out. This is what answers "who shared this,
-- where, and when" and what makes the broadcast idempotent.
create table shares (
  id uuid primary key default gen_random_uuid(),
  job_post_id uuid not null references job_posts(id) on delete cascade,
  sharer_id uuid not null references profiles(id) on delete cascade,
  group_id uuid not null references groups(id) on delete cascade,
  message_id uuid references messages(id) on delete set null,
  note text,
  -- Generated on the device before the network is touched (doc 1 §4.3), so a
  -- retry or a double-tap collapses instead of duplicating.
  client_share_id uuid not null,
  created_at timestamptz not null default now(),

  unique (sharer_id, client_share_id, group_id)
);

create index shares_job_post_idx on shares (job_post_id);
create index shares_group_created_idx on shares (group_id, created_at desc);

create table reactions (
  message_id uuid not null references messages(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  emoji text not null check (char_length(emoji) between 1 and 8),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);

-- Per-group only. Doc 1 §2 explicitly excludes per-message read receipts.
create table read_state (
  user_id uuid not null references profiles(id) on delete cascade,
  group_id uuid not null references groups(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (user_id, group_id)
);

alter table messages enable row level security;
alter table shares enable row level security;
alter table reactions enable row level security;
alter table read_state enable row level security;
