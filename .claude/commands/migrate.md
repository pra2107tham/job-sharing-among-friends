---
description: Create a new SQL migration, apply it locally, and re-run the RLS suite
argument-hint: <short_snake_case_name>
---

Create a new migration named `$1`.

1. Find the highest-numbered file in `supabase/migrations/` and use the next number,
   zero-padded to four digits: `NNNN_$1.sql`.
2. Write the migration. Non-negotiables:
   - Any new table gets `alter table <t> enable row level security;` in **this same file**.
   - Any new table that clients read or write gets policies and the matching
     `grant` — PostgREST checks table privileges _and_ RLS.
   - Policies test columns of the row under evaluation where possible; membership
     checks go through the `SECURITY DEFINER` helpers in `0009_rls_helpers.sql`.
     Re-read the "Rules that are easy to get wrong" section of CLAUDE.md before writing
     a policy.
   - Never modify an existing migration file.
3. Update `packages/contracts/src/database.ts` to match — it is hand-maintained and drifts
   silently otherwise. Row types must be `type` aliases, not `interface`, or supabase-js
   resolves the whole schema to `never`.
4. Add or extend assertions in `supabase/tests/rls.test.sql` for any new policy. A new
   policy without a test does not count as done.
5. Run `pnpm db:test` and report the actual output.
6. Run `pnpm typecheck`.
