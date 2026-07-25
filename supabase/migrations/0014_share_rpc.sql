-- The broadcast share (doc 1 §2, §4.3).
--
-- One call does everything: find-or-create the job, fan a message and a share
-- row into every group the caller belongs to, and queue the enrichment work.
-- Doing it in a single function rather than several client round trips is what
-- makes the share atomic — there is no state where a job exists but was never
-- delivered, or delivered to some groups and not others.
--
-- SECURITY DEFINER is required because it writes to ingest_jobs, which has RLS
-- enabled and no policies (deny-all to every client). That means this function
-- must do its own authorisation, and it does: groups are taken from the caller's
-- own group_members rows, never from the arguments alone.

create or replace function share_job(
  p_client_share_id uuid,
  p_source_type text,
  p_raw_input text,
  p_canonical_url text default null,
  p_url_hash text default null,
  p_content_hash text default null,
  p_note text default null,
  -- null means "all my groups", which is the default path. A caller may pass a
  -- subset; anything in it that the caller is not a member of is ignored rather
  -- than erroring, so a stale group id cannot fail an otherwise good share.
  p_group_ids uuid[] default null
)
returns table (job_post_id uuid, group_count int, deduped boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  v_job_id uuid;
  v_deduped boolean := false;
  v_count int := 0;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  if p_source_type not in ('link', 'image', 'text') then
    raise exception 'invalid source_type: %', p_source_type using errcode = '22023';
  end if;

  if p_client_share_id is null then
    raise exception 'client_share_id is required for idempotency' using errcode = '22023';
  end if;

  -- Idempotency. A double-tap, an offline retry and a resumed queue all arrive
  -- with the same client_share_id; the first one wins and the rest are no-ops.
  select s.job_post_id into v_job_id
  from shares s
  where s.sharer_id = uid and s.client_share_id = p_client_share_id
  limit 1;

  if v_job_id is not null then
    select count(*) into v_count
    from shares s
    where s.sharer_id = uid and s.client_share_id = p_client_share_id;
    return query select v_job_id, v_count, true;
    return;
  end if;

  -- Dedupe: the same job shared by two people collapses to one job_posts row.
  if p_url_hash is not null then
    select j.id into v_job_id from job_posts j where j.url_hash = p_url_hash;
  elsif p_content_hash is not null then
    select j.id into v_job_id from job_posts j where j.content_hash = p_content_hash;
  end if;

  v_deduped := v_job_id is not null;

  if not v_deduped then
    insert into job_posts (
      source_type, raw_input, canonical_url, url_hash, content_hash,
      apply_url, first_shared_by, parse_status
    )
    values (
      p_source_type, p_raw_input, p_canonical_url, p_url_hash, p_content_hash,
      case when p_source_type = 'link' then p_canonical_url end,
      uid, 'pending'
    )
    returning id into v_job_id;

    insert into ingest_jobs (job_post_id, kind)
    values (
      v_job_id,
      case p_source_type
        when 'link' then 'unfurl'
        when 'image' then 'ocr'
        else 'parse_text'
      end
    );
  end if;

  -- Fan out. Membership comes from group_members, so p_group_ids can only ever
  -- narrow the set, never widen it.
  with target as (
    select gm.group_id
    from group_members gm
    where gm.user_id = uid
      and (p_group_ids is null or gm.group_id = any (p_group_ids))
  ),
  msg as (
    insert into messages (group_id, sender_id, kind, body, job_post_id)
    select t.group_id, uid, 'job', nullif(p_note, ''), v_job_id
    from target t
    returning id, group_id
  )
  insert into shares (job_post_id, sharer_id, group_id, message_id, note, client_share_id)
  select v_job_id, uid, m.group_id, m.id, nullif(p_note, ''), p_client_share_id
  from msg m
  on conflict (sharer_id, client_share_id, group_id) do nothing;

  get diagnostics v_count = row_count;

  return query select v_job_id, v_count, v_deduped;
end;
$$;

revoke execute on function share_job(uuid, text, text, text, text, text, text, uuid[]) from public;
grant execute on function share_job(uuid, text, text, text, text, text, text, uuid[]) to authenticated;
