-- Profiles and devices.
--
-- `profiles` mirrors auth.users because auth.users is not exposed to the API and
-- carries fields (email, provider tokens) we never want readable by other users.

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  handle citext unique,
  display_name text,
  avatar_url text,
  -- Onboarding is incomplete until a handle is chosen; the app routes on this.
  onboarded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint handle_format check (
    handle is null or handle ~ '^[a-z0-9_]{3,20}$'
  ),
  constraint display_name_len check (
    display_name is null or char_length(display_name) between 1 and 60
  )
);

comment on column profiles.handle is
  'Lowercase, unique. Null until the user picks one during onboarding.';

create table devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  platform text not null check (platform in ('ios', 'android', 'web')),
  push_token text,
  app_version text,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),

  -- One row per physical device; re-registering updates in place.
  unique (user_id, push_token)
);

create index devices_user_id_idx on devices (user_id);

-- Keep updated_at honest without relying on clients.
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
  before update on profiles
  for each row execute function set_updated_at();

-- A profile row must exist the instant a user signs up, otherwise the app has a
-- window where auth.uid() resolves to nothing joinable.
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'avatar_url', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

alter table profiles enable row level security;
alter table devices enable row level security;
