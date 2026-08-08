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
  Resend email payload contains only a subject line and a plain-text body
  built from case names, HTTP statuses, latencies, durations, and the
  on-disk log path. No `from`/`to` fields carry anything beyond the
  operator's own configured addresses.

### Reporting: subject lines and the persistent-blocked escalation

Every run sends an email regardless of outcome — the absence of the
Mon/Wed/Fri email is itself the dead-man signal (subject to the honest gap
below). The subject is one of `PASS`, `DEGRADED (chat blocked)`,
`DEGRADED (chat blocked, N consecutive)`, `FAIL (chat blocked 3 runs
running)`, `PASS (chat recovered)`, `FAIL` / `FAIL (site down)`, or
`<level> (structural only, tier 2 skipped)` for a `--skip-tier2` run.

Turnstile withholding a token from every automated live-chat attempt is a
known, standing condition for this sentry's environment, not necessarily a
fresh emergency each run (see the proof run in the PR: 6/6 turns
client-blocked, zero real spend, both headed and headless real Chrome
tried). The original design re-escalated to `FAIL` on every run once 3
consecutive blocked runs was reached and never reset except on an actual
pass — meaning a structurally blocked chat path would have sent `FAIL`
forever, which trains the reader to stop opening the one alert that's
actually supposed to matter (a cross-vendor review, 2026-08-08, flagged
this as merge-blocking).

Revised behavior: the subject escalates to `FAIL (chat blocked 3 runs
running)` **exactly once** — the run that first crosses the
3-consecutive-blocked threshold. `last-run.json`'s `blockedEscalationActive`
flag remembers that it fired. Every subsequent run while still blocked
reports a steady `DEGRADED (chat blocked, N consecutive)` instead — still
emailed every run, still visibly abnormal, not re-alarming. The flag clears,
and a `PASS (chat recovered)` subject fires, the moment a live turn
actually succeeds; that recovery framing is suppressed if the same run has
an unrelated concurrent failure, so "good news" text never masks a real
problem.

This narrows what "the report is content-free" means in practice, not what
it protects: the escalation state machine only ever operates on booleans
and counts (`consecutiveBlockedRuns`, `blockedEscalationActive`) already in
the allowlisted `last-run.json` schema below — no new field carries content.
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
  lastSuccessfulLiveChatAt } | null, tier2Skipped, consecutiveBlockedRuns,
  lastSuccessfulLiveChatAt, blockedEscalationActive, blockedNarrative,
  crashError, emailAccepted, emailHttpStatus }`. Every field is a status
  code, count, boolean, timestamp, or timing — never a message body, model
  reply, or classifier input/output text. `blockedEscalationActive` and
  `blockedNarrative` are the persistent-blocked escalation state described
  above; `tier2Skipped` marks a `--skip-tier2` structural-only run.
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

## Amendment (2026-08-08): the tier 2 live-chat check never passed, one flag plus one retry

Since this sentry went live, tier 2 (the live-chat turn, tested against
production `streetlight.help`) had never once passed — every automated
attempt came back Turnstile-blocked, the "known, standing condition"
described above. A controlled experiment on 2026-08-08 isolated why and
what, if anything, is safe to do about it.

**What the experiment found.** A persistent browser profile and a
"warmed" profile (aged cookies/storage, prior real navigation history) did
**nothing** — both were blocked identically to a bare control. The
blocker is not fingerprint novelty or a cold profile; it is the
automation tell itself. Launching Chromium with
`--disable-blink-features=AutomationControlled` on an otherwise plain,
throwaway profile passed: a Turnstile token minted in ~4s, `/api/chat`
returned 200, a real model reply came back. Four further cold repeat runs
with the same flag gave 3 passes and 1 block — the flag works but is
**not deterministic**.

**Decision 1 — adopt exactly one flag, with a hard no-escalation rule.**
`scripts/ui-sentry/tier2.mjs` now launches both the real-Chrome path and
the bundled-Chromium fallback with `--disable-blink-features=AutomationControlled`
and nothing else. Jesse's ruling, verbatim in intent: no stealth
libraries, no fingerprint spoofing, no CAPTCHA-solving services. This
sentry is a client of Turnstile, the same as any browser — it does not
get to out-engineer the abuse control it is here to verify still works.
If Cloudflare tightens automation detection further and this flag stops
being enough, the sentry reports **DEGRADED** honestly, the same
blocked/fail verdict machinery this ADR already describes — it does not
grow a second, more aggressive flag to compensate. That ceiling is
enforced by review discipline, not by code; a future session tempted to
"improve" this into stealth tooling should read this paragraph first.

**Decision 2 — one retry, only when the first attempt was fully
blocked.** One attempt in four still comes back blocked even with the
flag, and a single-attempt check would flap between `pass` and
`DEGRADED` on pure Turnstile luck, not on anything actually wrong with
the site. Jesse approved a second, complete attempt (fresh browser, fresh
context) before tier 2 calls itself degraded. This is affordable
specifically because a fully-blocked attempt never receives a Turnstile
token, and without a token the page never makes a single `/api/chat`
POST — a blocked attempt costs zero model spend, so retrying it costs
nothing extra. The retry is narrow on purpose: it fires only when the
first attempt's own three-state verdict is `blocked` (every turn
client-withheld). A `fail` verdict is never retried — `fail` can mean
turns that already reached `/api/chat` and spent real money, and
re-running a run that already spent would be exactly the kind of money
trap this sentry's every other design choice has avoided. The existing
three-state verdict and its "mixed pass/blocked = fail" rule are
unchanged; the retry sits outside that logic, deciding only whether to
run it a second time, never how a single attempt is scored.

**The turn cap is shared, not doubled.** `installTurnBudgetGuard` now
takes an optional shared budget object; `tier2.mjs` creates one budget
per run and passes the same object into both attempts' guards, so the
request-boundary cap (R17) accumulates across attempts instead of
resetting. Worst case after this change is unchanged from before it:
**8 `/api/chat` POSTs allowed through per run**, no matter how the 8 are
split between a blocked-then-retried first attempt and a second one, with
every request past the cap aborted before it reaches the network exactly
as today. The per-run cap in the "What this sentry is allowed to do,
precisely" section above, and in `docs/data_architecture.md`'s Deliberate
Absences entry for this sentry, still reads correctly as written — this
amendment does not raise it.

**Consequence:** tier 2 now has a realistic chance of actually passing
against production, which the original design did not, while the
no-escalation rule and the shared, unraised turn cap mean this is a
resilience fix, not a bigger foothold against the site's own abuse
controls.
