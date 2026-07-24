-- Extensions.
--
-- pg_trgm is not used yet. It is installed now because job dedupe (doc 1 §8)
-- needs fuzzy title/company matching for image- and text-sourced jobs that have
-- no URL to hash, and adding an extension later is a production migration we can
-- avoid for free today.

create extension if not exists pgcrypto with schema public;   -- gen_random_uuid, digest
create extension if not exists citext with schema public;     -- case-insensitive handles/emails
create extension if not exists pg_trgm with schema public;    -- fuzzy dedupe (M2)

-- Every table in this schema is reachable through PostgREST, so `public` must
-- never be writable by API roles directly; access is granted per-table below.
grant usage on schema public to anon, authenticated, service_role;
