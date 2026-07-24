-- Joining a group.
--
-- groups_select_member (0010) hides groups from non-members, which is correct —
-- but it also means an invite link cannot render, and nobody can ever join. That
-- is what these SECURITY DEFINER RPCs are for: they are the *only* sanctioned way
-- for a non-member to learn about or enter a group, and each one decides exactly
-- what it reveals.

-- What an invite landing page is allowed to see before joining: enough to decide,
-- and nothing about who is in the group.
create or replace function preview_group_by_code(code text)
returns table (id uuid, name text, avatar_url text, member_count bigint)
language sql
stable
security definer
set search_path = public
as $$
  select g.id, g.name, g.avatar_url, (
    select count(*) from group_members gm where gm.group_id = g.id
  )
  from groups g
  where g.join_code = code and g.join_code_enabled
  limit 1;
$$;

create or replace function join_group_by_code(code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  gid uuid;
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select g.id into gid
  from groups g
  where g.join_code = code and g.join_code_enabled;

  if gid is null then
    raise exception 'invalid or disabled join code' using errcode = 'P0002';
  end if;

  insert into group_members (group_id, user_id, role)
  values (gid, uid, 'member')
  on conflict (group_id, user_id) do nothing;

  return gid;
end;
$$;

-- Accepting a direct invite. Separate from the code path because it also has to
-- close out the invite row, and because it must not let you accept someone
-- else's invite.
create or replace function accept_group_invite(invite uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  rec group_invites%rowtype;
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select * into rec from group_invites where id = invite;

  if rec.id is null or rec.invitee_id <> uid or rec.status <> 'pending' then
    raise exception 'invite not available' using errcode = 'P0002';
  end if;

  insert into group_members (group_id, user_id, role)
  values (rec.group_id, uid, 'member')
  on conflict (group_id, user_id) do nothing;

  update group_invites
  set status = 'accepted', responded_at = now()
  where id = invite;

  return rec.group_id;
end;
$$;

revoke execute on function preview_group_by_code(text) from public;
revoke execute on function join_group_by_code(text) from public;
revoke execute on function accept_group_invite(uuid) from public;

grant execute on function preview_group_by_code(text) to authenticated;
grant execute on function join_group_by_code(text) to authenticated;
grant execute on function accept_group_invite(uuid) to authenticated;
