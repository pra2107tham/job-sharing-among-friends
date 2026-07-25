-- Server-side dedupe.
--
-- Until now the client canonicalised the URL and computed url_hash before
-- calling share_job. That works for the in-app composer, but M3 adds two more
-- capture surfaces written in Kotlin and Swift, and reimplementing the
-- canonicalisation rules (doc 1 §8) three times in three languages guarantees
-- they drift — and drift here means duplicate cards, which is the exact thing
-- dedupe exists to prevent.
--
-- So native surfaces send raw_input with no hash, and the ingest worker becomes
-- the authority: it canonicalises, hashes, and if that hash already belongs to
-- another job_post, merges into it. The client-side hash stays as a fast path
-- for the JS composer, and the worker corrects it if it disagrees.

-- Move everything pointing at `dupe` over to `keep`, then delete `dupe`.
-- Only ever called by the worker (service_role); no grant to authenticated.
create or replace function merge_job_posts(dupe uuid, keep uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if dupe = keep then
    return;
  end if;

  if not exists (select 1 from job_posts where id = keep) then
    raise exception 'merge target % does not exist', keep using errcode = 'P0002';
  end if;

  -- job_status is keyed (user_id, job_post_id), so a user who already tracked
  -- both rows would collide. Their status on the surviving row is the one that
  -- counts — it is the job they will keep seeing.
  delete from job_status s
  where s.job_post_id = dupe
    and exists (
      select 1 from job_status k where k.job_post_id = keep and k.user_id = s.user_id
    );
  update job_status set job_post_id = keep where job_post_id = dupe;

  update shares set job_post_id = keep where job_post_id = dupe;
  update messages set job_post_id = keep where job_post_id = dupe;
  update job_attachments set job_post_id = keep where job_post_id = dupe;

  -- Any enrichment still queued for the dupe is pointless once it is gone.
  delete from ingest_jobs where job_post_id = dupe;

  delete from job_posts where id = dupe;
end;
$$;

revoke execute on function merge_job_posts(uuid, uuid) from public;

-- Find the job that already owns a canonical URL hash, if any. Lets the worker
-- ask "is this a duplicate?" without granting it a table scan.
create or replace function job_post_by_url_hash(p_url_hash text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from job_posts where url_hash = p_url_hash limit 1;
$$;

revoke execute on function job_post_by_url_hash(text) from public;
