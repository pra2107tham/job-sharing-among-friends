-- What the Groups tab needs in one round trip: member count, the last message,
-- and how many messages the caller has not read.
--
-- `security_invoker = true` is the whole point. A normal view executes as its
-- owner (postgres), which bypasses RLS on every table it touches — that would
-- turn this view into a hole that leaks every group in the database. With
-- security_invoker the underlying policies are evaluated as the calling user, so
-- the view returns exactly the groups they are already allowed to see.

create view group_overview
with (security_invoker = true) as
select
  g.id,
  g.name,
  g.avatar_url,
  g.join_code,
  g.created_by,
  g.created_at,
  (select count(*) from group_members gm where gm.group_id = g.id) as member_count,
  lm.created_at as last_message_at,
  lm.preview as last_message_preview,
  lm.sender_name as last_message_sender,
  (
    select count(*)
    from messages m
    where m.group_id = g.id
      and m.deleted_at is null
      -- Your own messages are never unread.
      and m.sender_id is distinct from auth.uid()
      and m.created_at > coalesce(
        (select rs.last_read_at from read_state rs
          where rs.group_id = g.id and rs.user_id = auth.uid()),
        '-infinity'::timestamptz
      )
  ) as unread_count
from groups g
left join lateral (
  select
    m.created_at,
    -- A job share has no body of its own; show the role instead of an empty row.
    case
      when m.kind = 'job' then coalesce(jp.title, jp.company, 'Shared a job')
      else m.body
    end as preview,
    p.display_name as sender_name
  from messages m
  left join job_posts jp on jp.id = m.job_post_id
  left join profiles p on p.id = m.sender_id
  where m.group_id = g.id and m.deleted_at is null
  order by m.created_at desc
  limit 1
) lm on true;

grant select on group_overview to authenticated;

-- Marking a group read. An upsert from the client would need both an insert and
-- an update policy plus a round trip to know which; one function is simpler and
-- keeps the "you must be a member" check in one place.
create or replace function mark_group_read(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  if not is_group_member(p_group_id, uid) then
    raise exception 'not a member of that group' using errcode = '42501';
  end if;

  insert into read_state (user_id, group_id, last_read_at)
  values (uid, p_group_id, now())
  on conflict (user_id, group_id) do update set last_read_at = now();
end;
$$;

revoke execute on function mark_group_read(uuid) from public;
grant execute on function mark_group_read(uuid) to authenticated;
