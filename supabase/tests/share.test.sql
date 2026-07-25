-- M1/M2 surface: group_overview, feed_items, share_job, mark_group_read.
--
-- The views are the risky part. A view without `security_invoker = true`
-- executes as its owner and quietly bypasses RLS on every table it reads, so
-- these assertions exist mainly to catch that regression.

\set ON_ERROR_STOP on

select tests.become_admin();

drop table if exists tests.sctx;
create table tests.sctx (k text primary key, v uuid);
grant select, insert on tests.sctx to authenticated;

-- =========================================================== fixtures ======
do $$
declare
  amy uuid; ben uuid; cal uuid; g1 uuid; g2 uuid;
begin
  amy := tests.mk_user('amy');
  ben := tests.mk_user('ben');
  cal := tests.mk_user('cal');

  perform tests.become(amy);
  insert into groups (name, created_by) values ('Backend crew', amy) returning id into g1;
  insert into groups (name, created_by) values ('Remote only', amy) returning id into g2;
  insert into group_members (group_id, user_id) values (g1, ben);
  perform tests.become_admin();

  insert into tests.sctx values ('amy', amy), ('ben', ben), ('cal', cal), ('g1', g1), ('g2', g2);
end
$$;

-- ================================================= share_job fan-out =======
do $$
declare
  amy uuid := (select v from tests.sctx where k = 'amy');
  ben uuid := (select v from tests.sctx where k = 'ben');
  cal uuid := (select v from tests.sctx where k = 'cal');
  g1  uuid := (select v from tests.sctx where k = 'g1');
  csid uuid := gen_random_uuid();
  r record;
  r2 record;
begin
  perform tests.become(amy);

  select * into r from share_job(
    p_client_share_id := csid,
    p_source_type := 'link',
    p_raw_input := 'https://boards.greenhouse.io/acme/jobs/9?utm_source=whatsapp',
    p_canonical_url := 'https://boards.greenhouse.io/acme/jobs/9',
    p_url_hash := 'hash-acme-9',
    p_note := 'remote, worth a shot'
  );

  -- Amy is in two groups, so one gesture produced two deliveries.
  perform tests.assert_eq(r.group_count, 2, 'share should fan out to every group the sharer is in');
  perform tests.assert_eq(r.deduped, false, 'first share of a URL is not a dedupe');
  insert into tests.sctx values ('job1', r.job_post_id);

  perform tests.assert_eq(
    (select count(*) from messages where job_post_id = r.job_post_id), 2::bigint,
    'each delivery is a message in its group');

  -- Idempotency: the same client_share_id must not double-post. This is the
  -- offline queue replaying, or the user double-tapping.
  select * into r2 from share_job(
    p_client_share_id := csid,
    p_source_type := 'link',
    p_raw_input := 'https://boards.greenhouse.io/acme/jobs/9?utm_source=whatsapp',
    p_canonical_url := 'https://boards.greenhouse.io/acme/jobs/9',
    p_url_hash := 'hash-acme-9'
  );
  perform tests.assert_eq(r2.job_post_id, r.job_post_id, 'replay returns the same job');
  perform tests.assert_eq(
    (select count(*) from messages where job_post_id = r.job_post_id), 2::bigint,
    'replaying a share must not create more messages');

  -- Enrichment was queued exactly once.
  perform tests.become_admin();
  perform tests.assert_eq(
    (select count(*) from ingest_jobs where job_post_id = r.job_post_id), 1::bigint,
    'a new link job queues exactly one unfurl');
  perform tests.assert_eq(
    (select kind from ingest_jobs where job_post_id = r.job_post_id), 'unfurl',
    'link shares queue an unfurl');

  -- Ben shares the same URL. One job row, two sharers.
  perform tests.become(ben);
  select * into r2 from share_job(
    p_client_share_id := gen_random_uuid(),
    p_source_type := 'link',
    p_raw_input := 'https://boards.greenhouse.io/acme/jobs/9',
    p_canonical_url := 'https://boards.greenhouse.io/acme/jobs/9',
    p_url_hash := 'hash-acme-9'
  );
  perform tests.assert_eq(r2.job_post_id, r.job_post_id, 'same URL must collapse to one job_post');
  perform tests.assert_eq(r2.deduped, true, 'second share of a URL is a dedupe');
  perform tests.assert_eq(r2.group_count, 1, 'ben is only in one group');

  perform tests.become_admin();
  perform tests.assert_eq(
    (select count(*) from ingest_jobs where job_post_id = r.job_post_id), 1::bigint,
    'a deduped share must not queue a second unfurl');

  -- Cal is in no groups: the share is accepted but delivered nowhere, and the
  -- client needs to be able to tell.
  perform tests.become(cal);
  select * into r2 from share_job(
    p_client_share_id := gen_random_uuid(),
    p_source_type := 'link',
    p_raw_input := 'https://example.test/job/1',
    p_canonical_url := 'https://example.test/job/1',
    p_url_hash := 'hash-example-1'
  );
  perform tests.assert_eq(r2.group_count, 0, 'a user with no groups shares to nobody');

  perform tests.become_admin();
  raise notice 'ok  share_job fan-out, dedupe and idempotency';
end
$$;

-- ============================== share_job cannot target foreign groups ======
do $$
declare
  cal uuid := (select v from tests.sctx where k = 'cal');
  g1  uuid := (select v from tests.sctx where k = 'g1');
  r record;
begin
  perform tests.become(cal);

  -- Cal is not in g1. Passing it explicitly must not deliver anything — this is
  -- the check that matters most, because share_job is SECURITY DEFINER and so
  -- runs with RLS bypassed.
  select * into r from share_job(
    p_client_share_id := gen_random_uuid(),
    p_source_type := 'link',
    p_raw_input := 'https://example.test/sneaky',
    p_canonical_url := 'https://example.test/sneaky',
    p_url_hash := 'hash-sneaky',
    p_group_ids := array[g1]
  );
  perform tests.assert_eq(r.group_count, 0, 'SECURITY DEFINER share must not post into a group the caller is not in');

  perform tests.become_admin();
  perform tests.assert_eq(
    (select count(*) from messages m where m.group_id = g1 and m.sender_id = cal), 0::bigint,
    'no message may exist in a group the sender does not belong to');

  raise notice 'ok  share_job authorisation';
end
$$;

-- ==================================================== group_overview =======
do $$
declare
  amy uuid := (select v from tests.sctx where k = 'amy');
  ben uuid := (select v from tests.sctx where k = 'ben');
  cal uuid := (select v from tests.sctx where k = 'cal');
  g1  uuid := (select v from tests.sctx where k = 'g1');
begin
  -- The regression this guards: a view without security_invoker returns every
  -- group in the database to everyone.
  perform tests.become(cal);
  perform tests.assert_eq((select count(*) from group_overview), 0::bigint,
    'group_overview must not leak groups to a non-member');

  perform tests.become(ben);
  perform tests.assert_eq((select count(*) from group_overview), 1::bigint,
    'ben sees only his group');
  perform tests.assert_eq(
    (select member_count from group_overview where id = g1), 2::bigint,
    'member_count should count the group');

  -- Ben has unread messages from Amy's share, and none of his own.
  perform tests.assert(
    (select unread_count from group_overview where id = g1) > 0,
    'ben should have unread messages from amy');

  perform mark_group_read(g1);
  perform tests.assert_eq(
    (select unread_count from group_overview where id = g1), 0::bigint,
    'marking read should clear the unread count');

  perform tests.become(amy);
  perform tests.assert_eq((select count(*) from group_overview), 2::bigint,
    'amy sees both her groups');
  -- g1 holds two messages: amy's share and ben's. If own messages counted she
  -- would have 2, so exactly 1 is the assertion that own messages are excluded.
  perform tests.assert_eq(
    (select unread_count from group_overview where id = g1), 1::bigint,
    'amy has one unread (ben''s share); her own message must not count');

  perform tests.become(cal);
  perform tests.assert_raises(
    format('select mark_group_read(%L)', g1),
    'a non-member must not be able to mark a group read');

  perform tests.become_admin();
  raise notice 'ok  group_overview';
end
$$;

-- ======================================================= feed_items ========
do $$
declare
  amy uuid := (select v from tests.sctx where k = 'amy');
  ben uuid := (select v from tests.sctx where k = 'ben');
  cal uuid := (select v from tests.sctx where k = 'cal');
  job1 uuid := (select v from tests.sctx where k = 'job1');
begin
  perform tests.become(cal);
  -- Cal shared one job into zero groups, so nothing reaches the feed.
  perform tests.assert_eq((select count(*) from feed_items), 0::bigint,
    'feed_items must not leak jobs from groups you are not in');

  perform tests.become(amy);
  perform tests.assert_eq((select count(*) from feed_items), 1::bigint,
    'the same job in two groups is ONE feed card, not two');
  perform tests.assert_eq(
    (select group_count from feed_items where job_post_id = job1), 2,
    'the card should say how many of my groups it landed in');
  perform tests.assert_eq(
    (select sharer_count from feed_items where job_post_id = job1), 2,
    'amy and ben both shared it');
  perform tests.assert_eq(
    (select note from feed_items where job_post_id = job1), 'remote, worth a shot',
    'the sharer note should survive to the card');

  -- Ben is in one group, so the same job counts once for him.
  perform tests.become(ben);
  perform tests.assert_eq(
    (select group_count from feed_items where job_post_id = job1), 1,
    'group_count is per-viewer, counting only groups they can see');

  perform tests.become_admin();
  raise notice 'ok  feed_items';
end
$$;

select tests.become_admin();
\echo 'ALL SHARE/FEED ASSERTIONS PASSED'
