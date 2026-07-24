-- Realtime publication.
--
-- Supabase Realtime streams changes from the `supabase_realtime` publication and
-- re-applies RLS per subscriber, so adding a table here does not widen access.
--
-- Only the tables the UI must react to live are included. job_posts is in
-- because enrichment mutates a card in place after the optimistic send
-- (doc 1 §4.3) and the card has to upgrade itself without a refetch.

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end
$$;

do $$
declare
  t text;
begin
  foreach t in array array['messages', 'shares', 'job_posts', 'group_members', 'reactions']
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end
$$;

-- Realtime needs the full old row to evaluate RLS on updates and deletes.
alter table messages replica identity full;
alter table shares replica identity full;
alter table job_posts replica identity full;
