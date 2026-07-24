-- Groups, membership, invites.

create table groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 60),
  avatar_url text,
  -- Shareable join code (doc 1 §10: jobdrop.app/j/<code>). Rotatable, so it is
  -- a column rather than derived from the id.
  join_code text not null unique default encode(gen_random_bytes(6), 'hex'),
  join_code_enabled boolean not null default true,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table group_members (
  group_id uuid not null references groups(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('admin', 'member')),
  joined_at timestamptz not null default now(),
  muted_until timestamptz,
  primary key (group_id, user_id)
);

create index group_members_user_id_idx on group_members (user_id);

create table group_invites (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete cascade,
  inviter_id uuid not null references profiles(id) on delete cascade,
  invitee_id uuid not null references profiles(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'declined', 'revoked')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,

  check (inviter_id <> invitee_id)
);

-- Only one live invite per (group, invitee); re-inviting after a decline is fine.
create unique index group_invites_pending_uniq
  on group_invites (group_id, invitee_id)
  where status = 'pending';

create index group_invites_invitee_idx on group_invites (invitee_id, status);

-- The creator is always the first admin. Doing this in a trigger means a client
-- cannot create a group it is not a member of.
create or replace function add_creator_as_admin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.created_by is not null then
    insert into public.group_members (group_id, user_id, role)
    values (new.id, new.created_by, 'admin')
    on conflict do nothing;
  end if;
  return new;
end;
$$;

create trigger groups_add_creator_as_admin
  after insert on groups
  for each row execute function add_creator_as_admin();

alter table groups enable row level security;
alter table group_members enable row level security;
alter table group_invites enable row level security;
