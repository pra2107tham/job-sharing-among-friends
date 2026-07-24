# Job Sharing Among Friends

A private, group-based place where a small circle of friends dumps job links, screenshots
and JD text for each other — in under five seconds, from wherever they found it.

The problem it solves: during an active job hunt you see dozens of roles a week across
LinkedIn, WhatsApp, Telegram, email and job boards. Forwarding the relevant ones to each
friend, one by one, is tedious enough that people stop doing it after the first month —
exactly when the hunt gets hard. The fix is to make sharing a single gesture that
broadcasts to everyone at once, and to make the receiving side a searchable, trackable
list instead of a chat scrollback.

## Planning docs

| # | Doc | Scope | Status |
|---|-----|-------|--------|
| 1 | [Job sharing app & website](docs/01-job-sharing-app.md) | Mobile (iOS + Android) + web app for capturing and broadcasting jobs to groups | **Current priority** |
| 2 | [Job application agent](docs/02-job-application-agent.md) | Autonomous agent that tailors a resume and applies on the user's behalf | Later, separate branch |
| 3 | [Integration plan](docs/03-integration.md) | How 1 and 2 merge into one product | After both exist |

Read them in order. Doc 1 is the one being built now; docs 2 and 3 exist so that
decisions made today (data model, job identity, email extraction) don't have to be
undone later.

## Working name

`JobDrop` is used throughout as a placeholder. Not a final decision.
