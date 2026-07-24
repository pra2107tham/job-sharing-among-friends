# Doc 3 — Integration: Sharing App + Application Agent

Status: planning. Executed only after Doc 1 ships to the friend circle and Doc 2 works
standalone for one user (the builder).
Branches merge order: `claude/job-sharing-app-*` → `main`, then
`claude/job-application-agent` rebased onto it.

---

## 1. The product this becomes

Separately, the two halves are useful. Together they close a loop:

> A friend drops a link → it's deduped and parsed into a real job record → you tap
> **Apply** on the card → the agent tailors your resume and submits → the status lands
> back on the same card in your tracker → when you interview, the group sees the signal
> that this company is actually responding.

The thing that makes this more than two apps in a trenchcoat is that **the group is a
better job source than a job board** — it's pre-filtered by people who know you — and the
agent removes the reason people don't act on what's shared.

## 2. The one decision that makes merging cheap

**`job_posts` is the shared spine.** Doc 1 creates and dedupes job records; Doc 2's
`applications.job_post_id` points at them. Build both against that table from day one and
integration is mostly UI work. Get this wrong — let the agent keep its own job table — and
merging means a migration and a dedupe reconciliation nobody wants to write.

Concretely, decisions to lock in _now_, during Phase 1:

| Decision                                                                      | Commitment                                                                                                                                                                                                                                                                  |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One `job_posts` row = one real-world job                                      | Enforced by `url_hash` unique index + fuzzy dedupe                                                                                                                                                                                                                          |
| `apply_url` and `apply_emails[]` are first-class columns                      | The agent's two entry points                                                                                                                                                                                                                                                |
| `description` always holds the full JD text                                   | The agent's tailoring input; don't truncate it                                                                                                                                                                                                                              |
| `job_status` (Doc 1, per-user) and `applications` (Doc 2) are separate tables | `job_status` is the user's manual intent; `applications` is a machine run. Agent runs _write into_ `job_status`, never the reverse                                                                                                                                          |
| Same Postgres instance, same auth/user ids                                    | No cross-service identity mapping                                                                                                                                                                                                                                           |
| Monorepo                                                                      | pnpm workspaces. Today: `apps/mobile` (Expo — iOS, Android and web from one codebase), `packages/contracts`, `packages/api-client`, `supabase/`. Phase 2 adds `services/agent`; `services/ingest` arrives with M2. A separate `apps/web` is deferred to M8 — see doc 1 §6.1 |

`packages/contracts` holds the shared types (job, profile, application status enum) and is
the only thing both halves import from each other. It exists as of M0 and deliberately has
no dependency beyond zod, so the agent service can consume it without pulling in React
Native.

One thing M0 settled that matters here: the row types in
`packages/contracts/src/database.ts` must be `type` aliases, not `interface`. Interfaces
do not get implicit index signatures, so supabase-js cannot match them against its
`GenericSchema` constraint and silently resolves every query to `never`.

## 3. Integration surfaces

### 3.1 In the app

- **Apply button on every job card.** Three states: `Apply` → `Applying…` (with a live
  progress line: "filling application… 4/9 fields") → `Applied ✓` / `Needs you`.
- **`Needs you` is a notification**, deep-linking to the paused run with the Browserbase
  live-view embedded — the user answers one question or clears a CAPTCHA and the run
  resumes. This handoff has to be excellent; it's where most runs will end early on.
- **Tracker becomes the agent's dashboard.** Doc 1's tracker already has
  `saved/applied/interviewing`; agent runs simply write `applied` with `applied_at`,
  the resume version used, and a replay link.
- **Bulk apply from the feed.** Select 5 cards → queue 5 runs. This is the moment the
  whole product justifies itself, and it only exists because sharing and applying live in
  the same place.
- **Email-apply uses Doc 1's extracted `apply_emails[]`** with the user's own Gmail. The
  extraction built in Phase 1 M4 is what makes this free.

### 3.2 Back into the group

Optional, off by default, and the part to be most careful with:

- **"3 people from this group applied"** on a card — aggregate only, never named unless the
  user opts in per group.
- **Response signal**: "2 people heard back from Zeta" — genuinely useful for deciding
  where to spend effort, and only possible because the tracker exists.
- **Never** share resumes, CTC, rejections, or per-person application lists into a group.
  Rejections in particular: the tracker holds them, the group never sees them, no
  exceptions and no opt-in. That is a hard line, not a setting.

Default posture: **the tracker is private.** Every group-visible signal is opt-in, aggregate,
and reversible.

## 4. Merge plan

1. **Freeze Phase 1** at a tagged release that the friend circle is actually using. Bugs
   only; no new sharing features during the merge.
2. **Rebase the agent branch** onto that tag. Expect conflicts only in schema migrations
   and `packages/contracts`.
3. **Schema reconciliation** — one migration that adds Doc 2's tables and the
   `applications.job_post_id` FK. If Doc 2 was developed against a stub job table, this is
   where the stub is dropped; keep the stub's shape identical to `job_posts` to make this a
   rename rather than a rewrite.
4. **Run the agent headless for the builder only**, behind a feature flag keyed on user id,
   against real shared jobs, for two weeks. This is the honest test: does the agent work on
   what friends actually share (LinkedIn links, WhatsApp-forwarded screenshots) versus the
   clean ATS URLs it was developed on? Expect it to be worse. Budget time for that.
5. **Open to 3 friends** in `review` mode (every submit approved by hand).
6. **General availability** with `review` default and `auto` as an explicit opt-in per user.

Feature flags needed: `agent_enabled`, `agent_auto_submit`, `group_application_signals`.

## 5. What has to be true before merging

- Phase 1 has sustained usage — say, 4+ active sharers and 20+ jobs/week for a month.
  If the sharing app hasn't found its footing, adding an agent won't save it; fix the
  sharing loop first.
- The agent's fact-trace validator has never let a fabricated claim through in manual review.
- Cost per application is measured and under budget at the projected volume.
- There's a clean answer to "what happens when the agent submits something wrong?" —
  full event log, replay, and a way for the user to see exactly what was sent.

## 6. Risks specific to the combination

| Risk                                                   | Why it matters here                                                                   | Mitigation                                                                                                   |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Agent makes sharing feel transactional                 | The group's value is people caring; automated bulk-apply can turn it into a spam feed | Keep sharing human; no auto-sharing of jobs the agent finds, ever                                            |
| Privacy leak of application data into groups           | Fastest way to destroy trust in a friend group                                        | Private by default, aggregate-only opt-ins, rejections never surfaced                                        |
| Real-world shared jobs are messier than ATS test cases | Agent success rate drops hard on LinkedIn/screenshot-sourced jobs                     | Route by confidence: only auto-apply when `apply_url` resolves to a known ATS; otherwise deep-link the human |
| Two codebases diverge before merging                   | Migration pain                                                                        | Shared `packages/contracts` + shared Postgres from day one                                                   |
| Scope creep kills Phase 1                              | The agent is more fun to build than notification batching                             | Hard rule: no agent code on the Phase 1 branch, and Phase 1 ships to real users before Phase 2 starts        |
