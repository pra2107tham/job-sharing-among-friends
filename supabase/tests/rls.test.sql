-- RLS test suite.
--
-- These assertions are the reason the schema can be trusted. Each one runs as
-- the `authenticated` role with request.jwt.claims set, which is exactly how
-- PostgREST executes a client query.
--
-- Three failure modes, tested separately, which must not be conflated:
--   * reads            — RLS filters silently: a denied read is ZERO ROWS
--   * insert           — WITH CHECK raises 42501: assert_denied
--   * update / delete  — USING matches nothing and does NOT raise: assert_noop
--
-- Conflating the last two is how an RLS test suite ends up green while the
-- policies are wrong.

\set ON_ERROR_STOP on
\timing off

select tests.become_admin();

drop table if exists tests.ctx;
create table tests.ctx (k text primary key, v uuid);
-- Scratch table for passing ids between blocks; not subject to RLS.
grant select, insert on tests.ctx to authenticated;

-- ============================================================ fixtures ======
do $$
declare
  alice uuid; bob uuid; carol uuid; g1 uuid;
begin
  alice := tests.mk_user('alice');
  bob   := tests.mk_user('bob');
  carol := tests.mk_user('carol');

  insert into tests.ctx values ('alice', alice), ('bob', bob), ('carol', carol);

  -- Alice creates the group through the real policy path. RETURNING is
  -- deliberate: it exercises the SELECT policy against the new row, which is
  -- what supabase-js does on .insert().select().single().
  perform tests.become(alice);
  insert into groups (name, created_by) values ('2024 Grads', alice) returning id into g1;
  -- ...and adds Bob as an admin would.
  insert into group_members (group_id, user_id) values (g1, bob);
  perform tests.become_admin();

  insert into tests.ctx values ('g1', g1);

  -- The creator trigger must have made Alice an admin.
  perform tests.assert(
    is_group_admin(g1, alice), 'group creator should be an admin');
  perform tests.assert_eq(
    (select count(*) from group_members where group_id = g1), 2::bigint,
    'group should have two members');
end
$$;

-- ================================================ group visibility ==========
do $$
declare
  alice uuid := (select v from tests.ctx where k = 'alice');
  carol uuid := (select v from tests.ctx where k = 'carol');
  g1    uuid := (select v from tests.ctx where k = 'g1');
begin
  perform tests.become(alice);
  perform tests.assert_eq((select count(*) from groups), 1::bigint,
    'member should see their group');

  -- No recursion here is the point: group_members policy calls a SECURITY
  -- DEFINER helper. If it queried group_members directly this raises 42P17.
  perform tests.assert_eq((select count(*) from group_members where group_id = g1), 2::bigint,
    'member should see the member list');

  perform tests.become(carol);
  perform tests.assert_eq((select count(*) from groups), 0::bigint,
    'non-member must see no groups (filtered, not errored)');
  perform tests.assert_eq((select count(*) from group_members), 0::bigint,
    'non-member must see no memberships');

  perform tests.assert_denied(
    format('insert into group_members (group_id, user_id) values (%L, %L)', g1, carol),
    'non-member must not be able to add themselves to a group');

  perform tests.become_admin();
  raise notice 'ok  group visibility';
end
$$;

-- ========================================================= messages =========
do $$
declare
  alice uuid := (select v from tests.ctx where k = 'alice');
  bob   uuid := (select v from tests.ctx where k = 'bob');
  carol uuid := (select v from tests.ctx where k = 'carol');
  g1    uuid := (select v from tests.ctx where k = 'g1');
begin
  perform tests.become(alice);
  insert into messages (group_id, sender_id, kind, body)
  values (g1, alice, 'text', 'anyone seen backend roles in blr?');

  perform tests.become(bob);
  perform tests.assert_eq((select count(*) from messages), 1::bigint,
    'group member should read group messages');

  perform tests.become(carol);
  perform tests.assert_eq((select count(*) from messages), 0::bigint,
    'non-member must not read group messages');

  perform tests.assert_denied(
    format('insert into messages (group_id, sender_id, kind, body) values (%L, %L, %L, %L)',
           g1, carol, 'text', 'let me in'),
    'non-member must not post to a group');

  -- Impersonation: Bob is a member, but cannot post as Alice.
  perform tests.become(bob);
  perform tests.assert_denied(
    format('insert into messages (group_id, sender_id, kind, body) values (%L, %L, %L, %L)',
           g1, alice, 'text', 'not really alice'),
    'member must not post as another user');

  perform tests.become_admin();
  raise notice 'ok  messages';
end
$$;

-- ================================== job visibility follows the share ========
do $$
declare
  alice uuid := (select v from tests.ctx where k = 'alice');
  bob   uuid := (select v from tests.ctx where k = 'bob');
  carol uuid := (select v from tests.ctx where k = 'carol');
  g1    uuid := (select v from tests.ctx where k = 'g1');
  job   uuid;
  msg   uuid;
begin
  perform tests.become(alice);
  insert into job_posts (source_type, raw_input, canonical_url, url_hash, title, company,
                         apply_emails, first_shared_by)
  values ('link', 'https://boards.greenhouse.io/acme/jobs/123?utm_source=li',
          'https://boards.greenhouse.io/acme/jobs/123',
          encode(digest('https://boards.greenhouse.io/acme/jobs/123', 'sha256'), 'hex'),
          'Backend Engineer', 'Acme', array['hr@acme.test'], alice)
  returning id into job;

  insert into messages (group_id, sender_id, kind, job_post_id)
  values (g1, alice, 'job', job) returning id into msg;

  insert into shares (job_post_id, sharer_id, group_id, message_id, client_share_id)
  values (job, alice, g1, msg, gen_random_uuid());

  insert into tests.ctx values ('job', job);

  perform tests.become(bob);
  perform tests.assert_eq((select count(*) from job_posts), 1::bigint,
    'a job shared into my group should be visible to me');

  perform tests.become(carol);
  perform tests.assert_eq((select count(*) from job_posts), 0::bigint,
    'a job shared into a group I am not in must be invisible');
  perform tests.assert_eq((select count(*) from shares), 0::bigint,
    'non-member must not see shares');

  perform tests.become_admin();
  raise notice 'ok  job visibility';
end
$$;

-- ======================================== job_status is owner-only ==========
-- docs/03-integration.md §3.2: nobody ever sees what someone else applied to.
do $$
declare
  alice uuid := (select v from tests.ctx where k = 'alice');
  bob   uuid := (select v from tests.ctx where k = 'bob');
  job   uuid := (select v from tests.ctx where k = 'job');
begin
  perform tests.become(alice);
  insert into job_status (user_id, job_post_id, status) values (alice, job, 'applied');

  perform tests.assert(
    (select applied_at from job_status where user_id = alice) is not null,
    'applied_at should be stamped automatically');

  -- Bob is in the same group and can see the job itself, but not her status.
  perform tests.become(bob);
  perform tests.assert_eq((select count(*) from job_status), 0::bigint,
    'PRIVACY: a group member must not see another user''s application status');

  perform tests.assert_denied(
    format('insert into job_status (user_id, job_post_id, status) values (%L, %L, %L)',
           alice, job, 'rejected'),
    'must not write application status on behalf of another user');

  perform tests.become_admin();
  raise notice 'ok  job_status privacy';
end
$$;

-- ============================================ DM requires approval ==========
do $$
declare
  alice uuid := (select v from tests.ctx where k = 'alice');
  carol uuid := (select v from tests.ctx where k = 'carol');
  lo uuid := least((select v from tests.ctx where k = 'alice'),
                   (select v from tests.ctx where k = 'carol'));
  hi uuid := greatest((select v from tests.ctx where k = 'alice'),
                      (select v from tests.ctx where k = 'carol'));
  conn uuid;
  tid uuid;
begin
  perform tests.become(alice);

  -- No connection yet: the thread itself must be refused.
  perform tests.assert_denied(
    format('insert into dm_threads (user_a, user_b, connection_id) values (%L, %L, %L)',
           lo, hi, gen_random_uuid()),
    'DM thread must not be creatable without an accepted connection');

  insert into connections (requester_id, addressee_id) values (alice, carol)
  returning id into conn;

  -- Still pending — not good enough.
  perform tests.assert_denied(
    format('insert into dm_threads (user_a, user_b, connection_id) values (%L, %L, %L)',
           lo, hi, conn),
    'a pending connection must not allow a DM thread');

  -- Carol accepts.
  perform tests.become(carol);
  update connections set status = 'accepted', responded_at = now() where id = conn;

  perform tests.become(alice);
  insert into dm_threads (user_a, user_b, connection_id) values (lo, hi, conn)
  returning id into tid;

  insert into messages (thread_id, sender_id, kind, body)
  values (tid, alice, 'text', 'hey, saw a role for you');

  perform tests.become(carol);
  perform tests.assert_eq((select count(*) from messages where thread_id = tid), 1::bigint,
    'the other party should read the DM');

  -- Blocking must stop the conversation even though the thread still exists.
  update connections set status = 'blocked' where id = conn;

  perform tests.become(alice);
  perform tests.assert_denied(
    format('insert into messages (thread_id, sender_id, kind, body) values (%L, %L, %L, %L)',
           tid, alice, 'text', 'still here'),
    'a blocked connection must stop further DMs');

  perform tests.become_admin();
  raise notice 'ok  DM approval gate';
end
$$;

-- =============================== enrichment is server-owned =================
do $$
declare
  alice uuid := (select v from tests.ctx where k = 'alice');
  job   uuid := (select v from tests.ctx where k = 'job');
  n int;
begin
  perform tests.become(alice);

  -- No client UPDATE policy on job_posts, so this matches no rows rather than
  -- raising. Zero rows affected is the assertion.
  update job_posts set title = 'Staff Engineer (self-promoted)' where id = job;
  get diagnostics n = row_count;
  perform tests.assert_eq(n, 0, 'clients must not be able to update job_posts');

  -- ingest_jobs is granted to nobody: even reads are refused.
  perform tests.assert_denied(
    'select count(*) from ingest_jobs',
    'ingest_jobs must be unreachable by clients');

  perform tests.become_admin();
  raise notice 'ok  enrichment ownership';
end
$$;

-- ================================================= join by code =============
do $$
declare
  carol uuid := (select v from tests.ctx where k = 'carol');
  g1    uuid := (select v from tests.ctx where k = 'g1');
  code  text := (select join_code from groups where id = g1);
  preview record;
begin
  perform tests.become(carol);

  -- Carol cannot see the group, but the RPC lets her preview it.
  perform tests.assert_eq((select count(*) from groups), 0::bigint,
    'precondition: carol is not a member yet');

  select * into preview from preview_group_by_code(code);
  perform tests.assert_eq(preview.name, '2024 Grads', 'preview should resolve the group name');
  perform tests.assert_eq(preview.member_count, 2::bigint, 'preview should count members');

  perform tests.assert_eq(join_group_by_code(code), g1, 'join should return the group id');
  perform tests.assert_eq((select count(*) from groups), 1::bigint,
    'after joining, the group becomes visible');
  -- Scoped to the group: Carol also has a DM thread with Alice by this point.
  perform tests.assert_eq((select count(*) from messages where group_id = g1), 2::bigint,
    'after joining, group history becomes visible');

  perform tests.assert_raises(
    'select join_group_by_code(''deadbeefdead'')',
    'an unknown join code must be rejected');

  perform tests.become_admin();
  raise notice 'ok  join by code';
end
$$;

-- ==================================================== profiles ==============
do $$
declare
  alice uuid := (select v from tests.ctx where k = 'alice');
  bob   uuid := (select v from tests.ctx where k = 'bob');
begin
  perform tests.become(bob);
  -- Bob shares a group with Alice, so he sees her profile.
  perform tests.assert(
    exists (select 1 from profiles where id = alice),
    'group-mates should see each other''s profiles');

  -- An UPDATE blocked by RLS matches zero rows rather than raising.
  perform tests.assert_noop(
    format('update profiles set display_name = ''hacked'' where id = %L', alice),
    'must not edit another user''s profile');

  perform tests.become_admin();
  raise notice 'ok  profiles';
end
$$;

select tests.become_admin();
\echo 'ALL RLS ASSERTIONS PASSED'
