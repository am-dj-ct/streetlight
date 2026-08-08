# Scheduled UI Sentry — Narrow Live-Chat Monitoring Exception

**Date:** 2026-08-07

## Context

The 2026-07-12 ADR (`docs/decisions/2026-07-12-operator-owned-local-health-polling.md`)
permits an operator-owned local dashboard to poll `/healthz` and GitHub Actions
metadata only. `docs/data_architecture.md`'s operator-monitoring exception
(~L1085) is explicit that such a monitor "must not call chat, TTS, usage, or
other user-connected routes."

That boundary exists because a monitor that can call `/api/chat` is a new way
for the tool to reach a live model on a schedule, outside a person's own
decision to start a conversation, and a new place spend and abuse-control
behavior could leak if built carelessly.

The gap it leaves: nothing exercises the real, end-to-end user path — a
person loading the site in a real mobile browser, typing, and getting a
model response — on a schedule. `/healthz` proves the deploy is configured;
it does not prove the composer accepts input, the referral sheet opens, or a
live turn actually completes. Jesse currently finds out about a broken
user-facing path by hand-testing or by a user report. A cross-vendor plan
review (2026-08-07) proposed a narrowly-scoped scheduled UI check as the
fix, with 17 specific resolutions (R1–R17) constraining exactly what it may
do; this ADR ratifies the resulting build.

## Decision

Add `com.streetlight.ui-sentry` — a `launchd` job on the operator's own Mac,
running `scripts/ui-sentry/run-ui-sentry.sh --live`, Mon/Wed/Fri 07:23 local
(≤3 runs/week). This ADR **supersedes the 2026-07-12 ADR for this one named
sentry only** — the 2026-07-12 boundary still applies to every other local
monitor; it does not become general permission for local tooling to call
chat routes. Any other monitor must still stay inside the 2026-07-12
boundary or get its own dated ADR.

### What this sentry is allowed to do, precisely

- **Pages it may load:** `/`, `/conversation/[entryId]`, `/find-human`,
  `/report-problem`, `/about`, `/privacy` — the same pages a real visitor
  reaches through the public UI. No admin surface exists to reach (`docs/forbidden.md`:
  "No admin panel").
- **`/healthz`:** read-only GET, same contract as the 2026-07-12 ADR already
  allows.
- **`/api/chat` turn budget:** at most 8 live turns per run, enforced at the
  request boundary (a `context.route` interceptor aborts any POST past the
  cap before it reaches the network — not just counted after the fact). The
  schedule caps this at 3 runs/week, so the sentry's own ceiling is ≤24
  live turns/week; in practice each run sends 6 synthetic turns, so the
  expected weekly total is 18 turns, plus whatever a manual proof/debug run
  adds. Every `/api/chat` turn is ~3 model calls (main response, classifier,
  follow-up suggestions) — this is real, non-zero spend, authorized here
  specifically because it is capped, scheduled, and disclosed, not because
  it is free.
- **Content:** synthetic fixture prompts only, written for this sentry
  (`scripts/ui-sentry/fixtures/tier2-prompts.mjs`), never real user content.
  The tier 2 helper (`lib/conversation.mjs`) returns only counts, booleans,
  HTTP statuses, and timings — it never holds a variable containing typed
  text or a model reply that gets logged, persisted, or emailed.
- **Reporting is content-free**, matching the existing recall-suite
  precedent (`docs/data_architecture.md:754` — "prints only synthetic case
  names and category results, not prompt or response content"). The
  Resend email payload contains only: a fixed subject
  (`Streetlight UI sentry: PASS | DEGRADED (chat blocked) | FAIL`), and a
  plain-text body built from case names, HTTP statuses, latencies,
  durations, and the on-disk log path. No `from`/`to` fields carry anything
  beyond the operator's own configured addresses.
- **Cadence:** Mon/Wed/Fri 07:23 local, no `KeepAlive`, no internal retry
  loop. A manual run (`run-ui-sentry.sh --live`, the same entry point,
  same caps) is permitted for proof and debugging and shares the same
  turn budget and single-instance lock as the scheduled fire — there is no
  separate, less-bounded "test mode."
- **No new vendor.** Email goes through the repo's existing
  `scripts/send-resend-email.mjs` / Resend integration, already in use for
  the resource-review and usage-digest emails.
- **`last-run.json` schema** (state root `~/.streetlight/ui-sentry/`, never
  in the repo working tree):
  `{ status, startedAt, finishedAt, durationMs, exitCode, logPath, baseUrl,
  tier0: { status, reason, cases[] }, tier1: { status, engines[] } | null,
  tier2: { status, turns[], turnBudgetUsed, turnBudgetCap,
  lastSuccessfulLiveChatAt } | null, consecutiveBlockedRuns,
  lastSuccessfulLiveChatAt, escalatedFromBlocked, crashError,
  emailAccepted, emailHttpStatus }`. Every field is a status code, count,
  timestamp, or timing — never a message body, model reply, or classifier
  input/output text.
- **Artifact retention:** trace and video are off everywhere. Screenshots
  are only-on-failure in tier 1 (structural pages only, no live-chat
  content ever on screen at that point) and hard-off in tier 2 always. Any
  screenshot stays local under the state root; nothing is uploaded.

### What this does not authorize

- No self-heal, no auto-remediation triggered by a failure. The sentry
  detects and emails; a human decides what runs next (explicit exclusion,
  learned from caller-track's `auto-debug.sh` re-triggering 25+ times on a
  standing failure and burning ~$90).
- No new header, secret, or code path that weakens Turnstile, the per-IP
  rate limit, the daily spend cap, or the soft-pause switch. The sentry is
  a client of the existing abuse controls, same as any browser — a
  Turnstile-blocked automated browser is the documented expected outcome
  (`scripts/prod-validation/validate-live.mjs`), reported honestly as
  `DEGRADED`, never worked around.
- No dry-run submission of the report-problem form, and no exploratory
  agent session — both listed as deliberate v1 follow-ups in the PR body,
  not built here.
- Does not become general permission for other local tooling to call chat
  routes. Anything beyond this one named sentry needs its own ADR.

## Consequences

- Jesse gets a content-free, 3x/week signal that the real user-facing path
  — page load, buttons, navigation, and (best-effort) an actual model
  turn — still works, without hand-testing and without a new vendor.
- Real, bounded live-model spend is authorized on a schedule for the first
  time by local tooling: ≤18 live turns/week in the normal case (≤24 as a
  hard ceiling), each turn ~3 model calls. This is disclosed here precisely
  so it is never a surprise line on a bill.
- **Honest gap (R12):** if this Mac, `launchd`, or Doppler itself dies
  silently, nothing external notices a missing email — the every-run email
  is the dead-man signal only while the sending side is alive to send it.
  This ADR does not claim otherwise. A candidate fix (the existing pager
  checking `last-run.json` staleness) is listed in the PR body's "Later"
  section, not built here.
- Any expansion beyond the exact scope above — more pages, a higher turn
  budget, a different cadence, any content in the report — requires another
  dated ADR, the same discipline the 2026-07-12 ADR established.
