# JobDrop — working notes for Claude

Private group job-sharing app. Friends drop job links, screenshots and JD text; it fans
out to every group they're in and gets tracked per person. Product plan is in
[`docs/01-job-sharing-app.md`](docs/01-job-sharing-app.md) — read it before changing
behaviour, not just structure.

Current milestone: **M0 foundations, done.** Next is M1 (groups + chat).

## Layout

```
apps/mobile/          Expo app — iOS, Android and web from one codebase
packages/contracts/   shared types, zod schemas, design tokens  ← the only cross-half import
packages/api-client/  typed Supabase client + query helpers
supabase/migrations/  SQL, applied in filename order
supabase/tests/       RLS test suite + local auth-schema stub
scripts/db.sh         local Postgres harness (no Docker needed)
docs/                 the three planning docs
```

## Commands

```bash
pnpm install           # isolated pnpm linker — see .npmrc before changing it
pnpm typecheck         # turbo, all packages
pnpm lint              # eslint, whole workspace
pnpm db:start          # local Postgres 16 cluster on :54329
pnpm db:reset          # drop, recreate, apply auth stub + all migrations
pnpm db:test           # reset, then run the RLS suite  ← run this after touching SQL
pnpm db:psql           # psql into the local db

cd apps/mobile
pnpm start             # dev server
npx expo export --platform web|ios|android    # verifies a real bundle
```

## Rules that are easy to get wrong

**Every new table gets `enable row level security` in the same migration that creates it.**
Supabase serves every table through PostgREST. A table without RLS is a public API. If a
table is server-only (like `ingest_jobs`), still enable RLS and give it no policies —
that's deny-all.

**Never edit a migration that has been applied anywhere.** Add a new numbered one. The
exception was M0 itself, before anything was deployed.

**Policies must test columns of the row under evaluation, not re-query the table.** This
bit three times during M0. `INSERT ... RETURNING` — which is what
`supabase.from(x).insert().select()` compiles to — evaluates the SELECT policy against the
new row _before_ it is in the statement's snapshot and before AFTER triggers have run. So
a policy like `using (is_group_member(id))` denies the creator their own new row. Write
`using (created_by = auth.uid() or is_group_member(id))`. See the comments in
`supabase/migrations/0010_rls_policies.sql`.

**Policies must not query `group_members`, `dm_threads` or `shares` directly.** Use the
`SECURITY DEFINER` helpers in `0009_rls_helpers.sql`. A policy on a table that reads that
same table recurses infinitely (error 42P17).

**RLS fails in three different ways and tests must not conflate them:**

| Operation                                                                                  | Denied looks like                |
| ------------------------------------------------------------------------------------------ | -------------------------------- |
| SELECT                                                                                     | zero rows, no error              |
| INSERT                                                                                     | raises 42501                     |
| UPDATE / DELETE                                                                            | **zero rows affected, no error** |
| Use `tests.assert_denied` for inserts and `tests.assert_noop` for updates/deletes. Getting |
| this wrong produces a green suite over broken policies.                                    |

**`job_status` is owner-only, permanently.** Nobody sees what anyone else applied to or was
rejected from. Group-visible signals, if they ever ship, are aggregate views on top —
the policy does not loosen (`docs/03-integration.md` §3.2).

**`job_posts` is the shared spine.** The Phase 2 application agent points
`applications.job_post_id` at it. Don't fork it, don't truncate `description`, keep
`apply_url` and `apply_emails[]` first-class.

**Missing module during a bundle?** Add it to `apps/mobile/package.json` at the version in
`node_modules/expo/bundledNativeModules.json`. Don't switch pnpm linkers — `.npmrc`
explains why `node-linker=hoisted` breaks this layout.

**Verify with a real bundle.** `npx expo export --platform ios` catches resolution and
babel problems that `tsc` cannot.

## Decisions and why

| Decision                                              | Reason                                                                                                                                                                           |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Expo/React Native, not Flutter                        | EAS Build compiles iOS in the cloud (no Mac needed); `expo-share-intent` already implements the iOS Share Extension, the hardest part of Phase 1                                 |
| Google + Apple auth, no phone OTP                     | Phone needs a paid SMS provider and Indian DLT registration before anyone can log in; Apple is mandatory for App Store review once Google is offered                             |
| Google via `expo-auth-session`, not the native module | Works in Expo Go and on web with one code path. Swap to `@react-native-google-signin` at M3, when the share extension forces a dev build anyway — contained to `src/lib/auth.ts` |
| Web output `single`, not `static`                     | Every screen is behind auth; nothing to prerender, and static rendering executes app modules at build time                                                                       |
| Session in SecureStore, chunked                       | It holds a refresh token. SecureStore caps values at 2048 bytes, hence the chunking in `src/lib/session-storage.ts`                                                              |
| Expo web instead of a separate Next.js app            | Doc 1's desktop triage UI is an M8 concern; two UIs at M0 is waste                                                                                                               |
| Reanimated + Gesture Handler present at M0            | Not used yet — NativeWind's native runtime imports Reanimated                                                                                                                    |

## The Android bubble (M3), so nobody re-litigates it

The floating bubble is Kotlin regardless of framework — a foreground service holding
`SYSTEM_ALERT_WINDOW` and inflating a view via `WindowManager`. Write it as plain Android
views, not React-in-the-overlay: it must appear instantly, work when the app is dead, and
send via Room + WorkManager without booting a JS runtime (doc 1 §4.3 budgets 300ms).

**iOS cannot do this.** No app may draw over other apps. The iOS path is the Share
Extension plus an App Intent bound to the Action Button / Back Tap. Don't spend time
looking for a way around it.

## Style

- TypeScript strict, no `any` (lint-enforced).
- No raw hex or magic spacing in components — import from `@jobdrop/contracts` tokens.
  Raw values live in `tokens.json` because `tailwind.config.js` is Node and can't read `.ts`.
- Screens use NativeWind `className` with `dark:` variants. `useTheme()` is for values that
  must cross into React Navigation.
- Comments explain _why_. The schema and RLS files are the ones worth commenting heavily.

## Not on this branch

No Phase 2 agent code (browser automation, resume tailoring). It lives on
`claude/job-application-agent` and merges per `docs/03-integration.md`.
