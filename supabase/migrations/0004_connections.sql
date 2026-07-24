-- Connections and DM threads.
--
-- Doc 1 §2: a DM requires approval first. The gate is enforced in the database
-- (0010_rls_policies.sql), not in the client — a client-side check is not a gate.

create table connections (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references profiles(id) on delete cascade,
  addressee_id uuid not null references profiles(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'blocked')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,

  check (requester_id <> addressee_id)
);

-- One connection per unordered pair, so A→B and B→A cannot both exist.
create unique index connections_pair_uniq
  on connections (least(requester_id, addressee_id), greatest(requester_id, addressee_id));

create index connections_addressee_idx on connections (addressee_id, status);
create index connections_requester_idx on connections (requester_id, status);

create table dm_threads (
  id uuid primary key default gen_random_uuid(),
  -- Canonically ordered so a pair maps to exactly one thread.
  user_a uuid not null references profiles(id) on delete cascade,
  user_b uuid not null references profiles(id) on delete cascade,
  connection_id uuid not null references connections(id) on delete cascade,
  created_at timestamptz not null default now(),

  check (user_a < user_b),
  unique (user_a, user_b)
);

-- Is there an accepted connection between these two users?
-- SECURITY DEFINER so RLS on `connections` cannot make this return false
-- for a row the caller is legitimately party to.
create or replace function is_connected(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from connections c
    where c.status = 'accepted'
      and (
        (c.requester_id = a and c.addressee_id = b) or
        (c.requester_id = b and c.addressee_id = a)
      )
  );
$$;

alter table connections enable row level security;
alter table dm_threads enable row level security;
