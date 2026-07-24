---
description: Run the RLS suite and prove it still has teeth
---

Verify the row level security policies.

1. Run `pnpm db:test`. Report the real output — every section that printed `ok`, and any
   assertion that failed, verbatim.

2. Then run a mutation check, because a passing suite proves nothing on its own. Pick one
   policy that enforces a privacy boundary (`job_status_own` is the sharpest), and:
   - `pnpm db:reset`
   - drop and recreate that policy with `using (true)`
   - run `psql -f supabase/tests/rls.test.sql` directly against the local db
   - confirm the suite **fails** with the expected assertion
   - `pnpm db:reset` to restore

   If the suite still passes with the policy loosened, the test is not actually exercising
   it — fix the test before doing anything else.

3. Finally, list any table in `supabase/migrations/` that has RLS enabled but no policy,
   and confirm each one is intentionally server-only (currently: `ingest_jobs`).
