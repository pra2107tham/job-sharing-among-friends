# Job Sharing Among Friends

A private, group-based place where a small circle of friends dumps job links, screenshots
and JD text for each other — in under five seconds, from wherever they found it.

The problem it solves: during an active job hunt you see dozens of roles a week across
LinkedIn, WhatsApp, Telegram, email and job boards. Forwarding the relevant ones to each
friend, one by one, is tedious enough that people stop doing it after the first month —
exactly when the hunt gets hard. The fix is to make sharing a single gesture that
broadcasts to everyone at once, and to make the receiving side a searchable, trackable
list instead of a chat scrollback.

## Status

**M0-M2 are built.** End to end, the loop works: sign in, create a group, send the invite
link, paste a job link, and it fans out to every group you're in — deduped, enriched, and
collapsed into one feed card.

- **M0** monorepo, Postgres schema with row level security and a suite that proves it,
  Google/Apple auth, app shell bundling for iOS, Android and web
- **M1** groups, invite links, join-by-code, group chat with realtime and unread counts
- **M2** the share pipeline: idempotent broadcast, offline outbox, URL canonicalisation and
  dedupe, the enrichment worker, job cards and the unified feed

- **M3** the Android bubble (drag a link onto a floating circle from any app), the Android
  share sheet, and the iOS Share Extension. See
  [doc 5](docs/05-native-capture.md) — the wiring is verified in CI, but the Kotlin and
  Swift have never been compiled, because that needs an Android SDK and a Mac.

Not built yet: image/OCR shares (M4), the tracker (M5), notifications (M6).

```bash
pnpm install
pnpm db:test        # migrations + RLS/share assertions against a local Postgres
pnpm test           # URL rules, JD parsing, ingest integration
pnpm typecheck && pnpm lint
cd apps/mobile && pnpm start
```

Sign-in needs a Supabase project and Google OAuth client IDs — see
[docs/04-setup.md](docs/04-setup.md). Those values live in your `.env` and never in git or
a chat window; `pnpm doctor` checks them for you and prints no secrets.

## Planning docs

| #   | Doc                                                       | Scope                                                                          | Status                 |
| --- | --------------------------------------------------------- | ------------------------------------------------------------------------------ | ---------------------- |
| 1   | [Job sharing app & website](docs/01-job-sharing-app.md)   | Mobile (iOS + Android) + web app for capturing and broadcasting jobs to groups | **Current priority**   |
| 2   | [Job application agent](docs/02-job-application-agent.md) | Autonomous agent that tailors a resume and applies on the user's behalf        | Later, separate branch |
| 3   | [Integration plan](docs/03-integration.md)                | How 1 and 2 merge into one product                                             | After both exist       |

Read them in order. Doc 1 is the one being built now; docs 2 and 3 exist so that
decisions made today (data model, job identity, email extraction) don't have to be
undone later.

## Working name

`JobDrop` is used throughout as a placeholder. Not a final decision.
