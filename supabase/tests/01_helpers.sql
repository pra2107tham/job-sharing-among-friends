-- Test helpers. Local only — never applied to a real Supabase project.
--
-- Note on why `become()` also switches role: superusers bypass RLS entirely, and
-- the migrations are applied as `postgres`. A test that forgets to leave the
-- superuser role will pass no matter how broken the policies are. Every
-- assertion below therefore runs as `authenticated`, which is the role PostgREST
-- actually uses.

create schema if not exists tests;

-- Impersonate a user for subsequent statements in this session.
create or replace function tests.become(uid uuid)
returns void
language plpgsql
as $$
begin
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', uid::text, 'role', 'authenticated')::text,
    false
  );
  execute 'set role authenticated';
end;
$$;

-- Drop back to superuser for fixture setup.
create or replace function tests.become_admin()
returns void
language plpgsql
as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', false);
end;
$$;

create or replace function tests.assert(cond boolean, msg text)
returns void
language plpgsql
as $$
begin
  if cond is not true then
    raise exception 'ASSERTION FAILED: %', msg;
  end if;
end;
$$;

create or replace function tests.assert_eq(actual anyelement, expected anyelement, msg text)
returns void
language plpgsql
as $$
begin
  if actual is distinct from expected then
    raise exception 'ASSERTION FAILED: % (expected %, got %)', msg, expected, actual;
  end if;
end;
$$;

-- Assert that a statement is rejected. Used for the write-side of RLS, where a
-- violation raises rather than silently filtering.
create or replace function tests.assert_denied(stmt text, msg text)
returns void
language plpgsql
as $$
begin
  begin
    execute stmt;
  exception
    when insufficient_privilege or check_violation then
      return;                       -- expected: RLS or a WITH CHECK rejected it
    when others then
      raise exception 'ASSERTION FAILED: % (rejected, but with unexpected error %: %)',
        msg, sqlstate, sqlerrm;
  end;
  raise exception 'ASSERTION FAILED: % (statement was allowed)', msg;
end;
$$;

-- Assert that a write statement touched nothing.
--
-- This is the one that catches tests passing for the wrong reason. An UPDATE or
-- DELETE blocked by RLS does NOT raise — the USING clause simply matches no rows,
-- so the statement "succeeds" having done nothing. Only INSERT (via WITH CHECK)
-- raises. Use assert_denied for inserts, assert_noop for updates and deletes.
create or replace function tests.assert_noop(stmt text, msg text)
returns void
language plpgsql
as $$
declare
  n int;
begin
  execute stmt;
  get diagnostics n = row_count;
  if n <> 0 then
    raise exception 'ASSERTION FAILED: % (% row(s) affected)', msg, n;
  end if;
end;
$$;

-- Assert that a statement raises *anything*. For application-level errors
-- (an RPC rejecting bad input), where assert_denied's strict RLS error codes
-- would not match.
create or replace function tests.assert_raises(stmt text, msg text)
returns void
language plpgsql
as $$
begin
  begin
    execute stmt;
  exception
    when others then
      return;
  end;
  raise exception 'ASSERTION FAILED: % (statement did not raise)', msg;
end;
$$;

-- Create a user the way Supabase would: insert into auth.users and let the
-- handle_new_user trigger produce the profile row.
create or replace function tests.mk_user(p_handle text)
returns uuid
language plpgsql
as $$
declare
  uid uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, raw_user_meta_data)
  values (uid, p_handle || '@example.test',
          json_build_object('full_name', initcap(p_handle))::jsonb);

  update public.profiles set handle = p_handle, onboarded_at = now()
  where id = uid;

  return uid;
end;
$$;

grant usage on schema tests to authenticated;
grant execute on all functions in schema tests to authenticated;
