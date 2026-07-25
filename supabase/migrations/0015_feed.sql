-- The unified feed (doc 1 §5.2).
--
-- One row per job, not per share: if the same role lands in three of your
-- groups it is one card that says "in 3 groups", not three cards. That
-- collapsing is the difference between a useful feed and a duplicate-riddled
-- one, and it has to happen in SQL — doing it client-side would break
-- pagination.
--
-- security_invoker again, so the shares/groups policies filter this to the
-- caller's own groups.

create view feed_items
with (security_invoker = true) as
select
  s.job_post_id,
  jp.title,
  jp.company,
  jp.location,
  jp.work_mode,
  jp.salary_text,
  jp.canonical_url,
  jp.apply_url,
  jp.apply_emails,
  jp.favicon_url,
  jp.og_image_url,
  jp.source_site,
  jp.source_type,
  jp.raw_input,
  jp.parse_status,
  jp.created_at as job_created_at,
  min(s.created_at) as first_shared_at,
  max(s.created_at) as last_shared_at,
  count(distinct s.group_id)::int as group_count,
  count(distinct s.sharer_id)::int as sharer_count,
  -- "via Ankit in 2024 Grads" — the earliest share is the one worth naming.
  (array_agg(p.display_name order by s.created_at))[1] as first_sharer_name,
  (array_agg(g.name order by s.created_at))[1] as first_group_name,
  (array_agg(s.note order by s.created_at) filter (where s.note is not null))[1] as note
from shares s
join groups g on g.id = s.group_id
join job_posts jp on jp.id = s.job_post_id
left join profiles p on p.id = s.sharer_id
-- Grouping by both primary keys lets us select any column of job_posts without
-- listing it here; Postgres tracks the functional dependency.
group by s.job_post_id, jp.id;

grant select on feed_items to authenticated;
