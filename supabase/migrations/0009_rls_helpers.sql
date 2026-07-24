-- RLS helper functions.
--
-- WHY THESE EXIST — read before writing any new policy:
--
-- A policy on group_members that itself selects from group_members recurses
-- infinitely ("infinite recursion detected in policy for relation ..."). Same for
-- any policy whose USING clause reads a table that is itself protected by a
-- policy referencing the first table.
--
-- The fix is to funnel every membership/visibility check through a
-- SECURITY DEFINER function. It executes as the function owner, so it bypasses
-- RLS on the tables it reads and the recursion never starts.
--
-- Rule for this repo: policies must not query group_members, dm_threads or
-- shares directly. Call these helpers instead.

create or replace function is_group_member(gid uuid, uid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select uid is not null and exists (
    select 1 from group_members gm
    where gm.group_id = gid and gm.user_id = uid
  );
$$;

create or replace function is_group_admin(gid uuid, uid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select uid is not null and exists (
    select 1 from group_members gm
    where gm.group_id = gid and gm.user_id = uid and gm.role = 'admin'
  );
$$;

create or replace function is_thread_participant(tid uuid, uid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select uid is not null and exists (
    select 1 from dm_threads t
    where t.id = tid and (t.user_a = uid or t.user_b = uid)
  );
$$;

-- A job is visible if it was shared into any group you belong to, or you are the
-- one who first shared it (covers the window between insert and fan-out).
create or replace function can_see_job(jid uuid, uid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select uid is not null and (
    exists (
      select 1
      from shares s
      join group_members gm on gm.group_id = s.group_id
      where s.job_post_id = jid and gm.user_id = uid
    )
    or exists (
      select 1 from job_posts j where j.id = jid and j.first_shared_by = uid
    )
  );
$$;

-- Two users share at least one group. Used to scope profile visibility: you can
-- see the profile of someone you share a group with, or are connected to.
create or replace function shares_group_with(other uuid, uid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select uid is not null and exists (
    select 1
    from group_members a
    join group_members b on b.group_id = a.group_id
    where a.user_id = uid and b.user_id = other
  );
$$;

revoke execute on function is_group_member(uuid, uuid) from public;
revoke execute on function is_group_admin(uuid, uuid) from public;
revoke execute on function is_thread_participant(uuid, uuid) from public;
revoke execute on function can_see_job(uuid, uuid) from public;
revoke execute on function shares_group_with(uuid, uuid) from public;
revoke execute on function is_connected(uuid, uuid) from public;

grant execute on function is_group_member(uuid, uuid) to authenticated;
grant execute on function is_group_admin(uuid, uuid) to authenticated;
grant execute on function is_thread_participant(uuid, uuid) to authenticated;
grant execute on function can_see_job(uuid, uuid) to authenticated;
grant execute on function shares_group_with(uuid, uuid) to authenticated;
grant execute on function is_connected(uuid, uuid) to authenticated;
