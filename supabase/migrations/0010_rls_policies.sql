-- Row level security policies.
--
-- Every policy targets the `authenticated` role. `anon` gets nothing: this is a
-- private app with no public surface. `service_role` bypasses RLS entirely and
-- is what the enrichment workers use.
--
-- Reminder from 0009: never query group_members / dm_threads / shares directly
-- inside a policy. Use the SECURITY DEFINER helpers or you will reintroduce
-- policy recursion.

-- PostgREST enforces table privileges *and* RLS. Both are required.
grant select, insert, update, delete on
  profiles, devices, groups, group_members, group_invites,
  connections, dm_threads, job_posts, job_attachments,
  messages, shares, reactions, read_state, job_status
  to authenticated;

-- ---------------------------------------------------------------- profiles --

create policy profiles_select on profiles for select to authenticated
using (
  id = auth.uid()
  or shares_group_with(id)
  -- Either side of a connection request must be able to see the other, or an
  -- incoming request would render as an anonymous row.
  or exists (
    select 1 from connections c
    where (c.requester_id = auth.uid() and c.addressee_id = profiles.id)
       or (c.addressee_id = auth.uid() and c.requester_id = profiles.id)
  )
);

create policy profiles_insert_self on profiles for insert to authenticated
with check (id = auth.uid());

create policy profiles_update_self on profiles for update to authenticated
using (id = auth.uid()) with check (id = auth.uid());

-- ----------------------------------------------------------------- devices --

create policy devices_own on devices for all to authenticated
using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ------------------------------------------------------------------ groups --

-- Non-members cannot read groups. Joining by code goes through the SECURITY
-- DEFINER RPC in 0012 rather than a permissive select policy.
--
-- `created_by = auth.uid()` is not redundant with membership. INSERT ... RETURNING
-- evaluates the SELECT policy against the new row, and at that instant the
-- creator is not yet a member — add_creator_as_admin is an AFTER trigger. Without
-- this clause the idiomatic client call, insert(...).select().single(), fails on
-- every group creation. Covered by the regression test in rls.test.sql.
create policy groups_select_member on groups for select to authenticated
using (is_group_member(id) or created_by = auth.uid());

create policy groups_insert on groups for insert to authenticated
with check (created_by = auth.uid());

create policy groups_update_admin on groups for update to authenticated
using (is_group_admin(id)) with check (is_group_admin(id));

create policy groups_delete_admin on groups for delete to authenticated
using (is_group_admin(id));

-- ----------------------------------------------------------- group_members --

create policy group_members_select on group_members for select to authenticated
using (is_group_member(group_id));

-- Deliberately no self-insert: it would let anyone add themselves to any group.
-- Members arrive via the join RPC (0012) or an admin.
create policy group_members_insert_admin on group_members for insert to authenticated
with check (is_group_admin(group_id));

-- Own row (mute settings), or an admin changing someone's role.
create policy group_members_update on group_members for update to authenticated
using (user_id = auth.uid() or is_group_admin(group_id))
with check (user_id = auth.uid() or is_group_admin(group_id));

-- Leave, or be removed by an admin.
create policy group_members_delete on group_members for delete to authenticated
using (user_id = auth.uid() or is_group_admin(group_id));

-- ----------------------------------------------------------- group_invites --

create policy group_invites_select on group_invites for select to authenticated
using (
  invitee_id = auth.uid() or inviter_id = auth.uid() or is_group_admin(group_id)
);

create policy group_invites_insert on group_invites for insert to authenticated
with check (inviter_id = auth.uid() and is_group_member(group_id));

-- Invitee accepts/declines; inviter revokes.
create policy group_invites_update on group_invites for update to authenticated
using (invitee_id = auth.uid() or inviter_id = auth.uid())
with check (invitee_id = auth.uid() or inviter_id = auth.uid());

-- ------------------------------------------------------------- connections --

create policy connections_select on connections for select to authenticated
using (requester_id = auth.uid() or addressee_id = auth.uid());

create policy connections_insert on connections for insert to authenticated
with check (requester_id = auth.uid() and status = 'pending');

create policy connections_update on connections for update to authenticated
using (requester_id = auth.uid() or addressee_id = auth.uid())
with check (requester_id = auth.uid() or addressee_id = auth.uid());

create policy connections_delete on connections for delete to authenticated
using (requester_id = auth.uid() or addressee_id = auth.uid());

-- -------------------------------------------------------------- dm_threads --

-- Direct column check, not is_thread_participant(id): the helper re-queries
-- dm_threads by id, which fails during INSERT ... RETURNING for the snapshot
-- reason documented on groups_select_member. The helper stays in use where the
-- policy lives on a *different* table (messages, below), which is safe.
create policy dm_threads_select on dm_threads for select to authenticated
using (user_a = auth.uid() or user_b = auth.uid());

-- A thread cannot exist without an accepted connection. This is the first half
-- of the DM approval gate; the second half is on messages below.
create policy dm_threads_insert on dm_threads for insert to authenticated
with check (
  (user_a = auth.uid() or user_b = auth.uid())
  and is_connected(user_a, user_b)
);

-- -------------------------------------------------------------- job_posts --

-- `first_shared_by = auth.uid()` is checked directly rather than left to
-- can_see_job(), which re-queries job_posts. During INSERT ... RETURNING the new
-- row is not yet in the statement's snapshot, so a policy that looks the row up
-- by id sees nothing and denies. Testing a column of the row under evaluation
-- always works. Same trap as groups_select_member above.
create policy job_posts_select on job_posts for select to authenticated
using (first_shared_by = auth.uid() or can_see_job(id));

create policy job_posts_insert on job_posts for insert to authenticated
with check (first_shared_by = auth.uid());

-- No client update policy: enrichment is the server's job (0008 workers run as
-- service_role). A user correcting a parsed title will go through an RPC when
-- that feature exists, so that we can audit it.

create policy job_attachments_select on job_attachments for select to authenticated
using (can_see_job(job_post_id));

create policy job_attachments_insert on job_attachments for insert to authenticated
with check (can_see_job(job_post_id));

-- ---------------------------------------------------------------- messages --

create policy messages_select on messages for select to authenticated
using (
  (group_id is not null and is_group_member(group_id))
  or (thread_id is not null and is_thread_participant(thread_id))
);

create policy messages_insert on messages for insert to authenticated
with check (
  sender_id = auth.uid()
  and (
    (group_id is not null and is_group_member(group_id))
    or (
      thread_id is not null
      and is_thread_participant(thread_id)
      -- Second half of the DM gate: re-checked on every message, so blocking a
      -- connection stops the conversation even though the thread still exists.
      and exists (
        select 1 from dm_threads t
        where t.id = messages.thread_id and is_connected(t.user_a, t.user_b)
      )
    )
  )
);

create policy messages_update_own on messages for update to authenticated
using (sender_id = auth.uid()) with check (sender_id = auth.uid());

create policy messages_delete_own on messages for delete to authenticated
using (sender_id = auth.uid() or (group_id is not null and is_group_admin(group_id)));

-- ------------------------------------------------------------------ shares --

create policy shares_select on shares for select to authenticated
using (is_group_member(group_id));

create policy shares_insert on shares for insert to authenticated
with check (sharer_id = auth.uid() and is_group_member(group_id));

-- --------------------------------------------------------------- reactions --

-- The `messages` subquery is itself RLS-filtered, so this resolves to
-- "the message is visible to me" without a second helper.
create policy reactions_select on reactions for select to authenticated
using (exists (select 1 from messages m where m.id = reactions.message_id));

create policy reactions_insert on reactions for insert to authenticated
with check (
  user_id = auth.uid()
  and exists (select 1 from messages m where m.id = reactions.message_id)
);

create policy reactions_delete on reactions for delete to authenticated
using (user_id = auth.uid());

-- -------------------------------------------------------------- read_state --

create policy read_state_own on read_state for all to authenticated
using (user_id = auth.uid() and is_group_member(group_id))
with check (user_id = auth.uid() and is_group_member(group_id));

-- -------------------------------------------------------------- job_status --

-- THE PRIVACY LINE. Owner only, all four verbs. If a future feature needs
-- aggregate group signals, it gets a SECURITY DEFINER view that returns counts —
-- this policy does not loosen.
create policy job_status_own on job_status for all to authenticated
using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ingest_jobs intentionally has RLS enabled and zero policies: deny-all for
-- every client role, accessible only to service_role.
