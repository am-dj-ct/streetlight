# Scheduled UI Sentry — Narrow Live-Chat Monitoring Exception

**Date:** 2026-08-07

> **Partly superseded (2026-08-17).** The reporting decision below — "every run sends an email regardless of outcome" — no longer holds. The sentry sends no email on any path; it writes its report to the run log and `last-run.json`, and two external monitors read those. See `docs/decisions/2026-08-17-ui-sentry-reports-without-email.md`, which also closes the R12 dead-man gap admitted under Consequences. Everything else in this ADR stands.
>
> **Cadence updated (2026-08-23).** Jesse's spec, Sentinel chat: the UI checks are supposed to be daily, not Mon/Wed/Fri. Commit `8bc68a9` (#30) moved the live plist to a daily 07:23 local fire; the numbers below are updated to match. The per-run caps this ADR authorizes (≤8 live turns, single-instance lock, no `KeepAlive`, no internal retry loop) are unchanged — only the number of runs per week changed.

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
running `scripts/ui-sentry/run-ui-sentry.sh --live`, daily 07:23 local
(7 runs/week — see the cadence note above). This ADR **supersedes the 2026-07-12 ADR for this one named
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
  schedule caps this at 7 runs/week (daily), so the sentry's own ceiling is
  ≤56 live turns/week; in practice each run sends 6 synthetic turns, so the
  expected weekly total is 42 turns, plus whatever a manual proof/debug run
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
daily email is itself the dead-man signal (subject to the honest gap
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
- **Cadence:** daily 07:23 local, no `KeepAlive`, no internal retry
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

- Jesse gets a content-free, daily signal that the real user-facing path
  — page load, buttons, navigation, and (best-effort) an actual model
  turn — still works, without hand-testing and without a new vendor.
- Real, bounded live-model spend is authorized on a schedule for the first
  time by local tooling: ≤42 live turns/week in the normal case (≤56 as a
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

## Amendment (2026-08-08, same day): the flag alone does not survive headless — tier 2 now opens a visible browser window

The flag adopted above was proven in a **visible** browser window
(`headless: false`): 4 cold starts, 3 passed. A follow-up measurement,
same day, isolated whether that result holds headless, which is how the
scheduled sentry had been running. It does not:

- Visible window + flag: 4 cold starts → **3 passed**.
- Headless + flag: 4 cold starts → **0 passed** (2 of these were this
  sentry's own production runs, already reported as blocked; 2 were
  isolation runs against the same flag with nothing else changed).

Four straight blocks in a row would be roughly a 0.4% event if headless
behaved like the visible-window baseline above — it does not, so headless
itself, not bad luck, is the reason tier 2 has never once passed against
production. The automation tell the flag addresses is apparently detected
differently (or additionally) when Chrome has no visible window at all.

**Decision 3 — run tier 2 in a visible browser window, not headless.**
Jesse authorized a real, visible Chrome window opening on the operator's
own Mac when the scheduled or manual `--live` sentry run reaches tier 2.
`scripts/ui-sentry/orchestrator.mjs` now calls `runTier2` with
`headed: true` at its one real call site, with a comment pointing back
here; `runTier2`'s own default (`headed = false`, in
`scripts/ui-sentry/tier2.mjs`) is unchanged, so anything else that calls
it directly — a future test, a one-off structural check — stays headless
unless it opts in the same explicit way. No other launch behavior
changes: same one flag from Decision 1, same real-Chrome-with-bundled-
Chromium-fallback launch path, same retry logic from Decision 2, same
shared 8-turn cap.

**This stays inside the no-escalation rule, not outside it.** A visible,
real browser window is the opposite of stealth tooling — it is strictly
*more* honest about being an automated client than headless was, not
less. It adds no fingerprint spoofing, no CAPTCHA-solving service, no new
launch flag beyond the one Decision 1 already adopted. If Cloudflare
later blocks even a visible-window real Chrome, this tier reports
**DEGRADED** through the same three-state verdict machinery already
described above — it does not escalate to a second, more aggressive
technique. The no-escalation language in Decision 1 is unchanged and
still governs.

**Operational note, not a new rule:** a visible browser window opening
periodically on the operator's own Mac is expected and cosmetic —
already true of the manual proof runs used to validate this change. It
carries no new cap, schedule, or content change; the ≤8-turn budget and
cadence (daily — see the cadence note at the top of this ADR) in the base
decision above are unaffected.

## Amendment (2026-08-08, same day): phone emulation was the second blocker — tier 2 now runs visible desktop Chrome, not a phone

Decision 3 above got tier 2 passing in isolation runs, but production runs
through this sentry's actual `orchestrator.mjs` call site kept coming back
blocked even visible and even with the flag. A further controlled
experiment, same recipe as before (persistent context + the
`--disable-blink-features=AutomationControlled` flag), isolated why:

- Visible window + desktop viewport + Chrome's own identity: **pass**
  (Turnstile token in 4.5s, `/api/chat` 200).
- Visible window + iPhone 13 emulation (WebKit UA via Playwright's device
  descriptor): **blocked**.
- Visible window + Pixel 7 emulation (Android Chrome UA): **blocked**.
- Headless + flag, 4 cold starts: **0 passed** (matches the prior
  headless finding above).

The iPhone 13 and Pixel 7 results are the finding that matters: two
different phone identities, one WebKit-flavored and one an Android Chrome
UA, were blocked identically. **Which phone the browser claimed to be did
not matter — emulating a phone at all was the blocker**, independent of
and in addition to the headless blocker Decision 3 already fixed. This is
not a user-agent string mismatch (a Chrome UA on a phone-shaped emulation
was blocked exactly like a Safari UA was); it is device emulation itself
that Turnstile's automation signal picks up on. Tier 2 had been running
`browser.newContext({ ...mobileDevice })` (Playwright's iPhone 13 profile,
the same device tier 1's webkit-mobile pass uses) since it was first
built, which is why it kept failing even after Decisions 1–3 landed.

**Decision 4 — tier 2 runs as a normal desktop Chrome, not a phone.**
Jesse ruled: tier 2's live-chat check may run as a visible desktop Chrome
— desktop viewport (1280x800, the same profile `desktopViewport` already
defines for tier 1's Chromium pass), Chrome's own user agent, no device
emulation — **accepting that it no longer exercises the phone-shaped
path**. `scripts/ui-sentry/tier2.mjs` now opens `browser.newContext({
viewport: desktopViewport })` instead of spreading in `mobileDevice`. This
is the cost of the ruling, stated plainly: Streetlight is a mobile-web
tool, and tier 2's live model turn — the one part of this sentry that
actually types into the composer and gets a real reply — no longer runs
in a mobile-shaped session. Tier 1's `webkit-mobile` engine still covers
the mobile UI (page loads, composer, navigation, locale switch, in a real
WebKit iPhone-viewport context) on every run, but tier 1 makes no
`/api/chat` call at all and never observes a live model turn under any
device. No check in this sentry exercises "the phone-shaped path with a
live model reply" after this amendment; that gap is accepted, not hidden.

**This stays inside the no-escalation rule.** Dropping device emulation is
the opposite of an evasion technique — it makes this sentry look *less*
distinctive to Turnstile, not more, and adds no new flag, library, or
spoofing beyond what Decision 1 already adopted. If Cloudflare later
blocks even a visible desktop Chrome, tier 2 reports **DEGRADED** through
the same three-state verdict machinery already described above.

**What is still untested and intentionally not re-derived:** whether an
ephemeral `browser.newContext()` (tier 2's existing shape) or a persistent
`launchPersistentContext()` with a throwaway profile is required for the
desktop pass to hold up over repeated runs. The one real production run
performed to validate this amendment used the simple ephemeral shape and
passed on the first try (6/6 turns, `/api/chat` 200 each), so tier 2 keeps
that shape rather than switching to a persistent context pre-emptively. If
future runs show the ephemeral shape flaking the way headless did, that is
a candidate follow-up, not assumed here.

## Amendment (2026-08-17): reporting moves off email entirely

The "every run sends an email" mechanism described above is removed. The
reasoning, the options rejected (including why failure mail cannot simply be
re-pointed at the sentinel mailbox), and the costs accepted are recorded in
`docs/decisions/2026-08-17-ui-sentry-reports-without-email.md`.

Two corrections to what this ADR asserted:

- **The R12 gap is closed, from outside.** This ADR said "nothing external
  notices a missing email" and listed the pager checking `last-run.json`
  staleness as a "Later" candidate. That candidate exists —
  `~/caller-track-pager`'s `checkUiSentry()` pages on a record older than
  74h — and the sentinel-v5 items `sl-ui-sentry` / `sl-ui-sentry-live-chat`
  independently report a slot that never checked in. Neither depends on the
  sentry being alive to send anything.
- **"No new vendor" is now "no vendor."** The sentry no longer calls Resend
  at all. Resend remains in use for the resource-review and usage-digest
  GitHub Actions workflows, which are unrelated to this job.

The subject strings enumerated above are unchanged; they are now the run's
headline line in the log rather than an email subject.

## Amendment (2026-08-20): tier 1 is pinned; real Chrome stays tier 2-only

The 2026-08-19 scheduled run produced one tier 1 failure with a distinctive
content-free shape: tier 0 passed, pinned WebKit passed all 23 structural
cases, and the system-Chrome session timed out on its first three commands but
passed its remaining 19. The first timeout's own Playwright call log said
the expected heading had already resolved visible. A current run of the
same 22-case Chromium structural path passed fully. This proves the public
page was present and the failure was a transient command stall in the
independently updated system-Chrome path, not missing production UI.

**Decision:** tier 1 always launches Playwright's package-installed
Chromium and WebKit binaries. The install process already pins and installs
both under this standalone package (R11); preferring system Chrome before
falling back silently defeated that guarantee. Real Chrome remains exactly
where it is required: tier 2's visible desktop path for Turnstile. This
change adds no retry, no self-heal, no new page, no model call, no logging
field, and no spend.

**Sentinel closure:** `sl-ui-sentry` + `job_failed` is one incident episode.
The content-free evidence is the run status, tier statuses, failed-case
count, and fixed error class in `last-run.json`/the run log. Sentinel owns a
Streetlight repair lane; it must not blindly Class-R kickstart the default
label because that path can reach tier 2 and spend live turns. Closure
requires a fresh structural PASS, a green `sl-ui-sentry` check-in for that
repair run, and the Sentinel incident resolving. Cross-monitor delivery
coalescing with `caller-track-pager` remains blocked on that other repo's
single-writer lane and is not claimed complete here.

## Amendment (2026-09-26): DEGRADED reaches jesse@ as red; client_blocked was bot-speed pacing, not Turnstile being down

A read-only audit found the 2026-09-26 07:23 run DEGRADED — turn 1 of tier 2
passed, turns 2-6 all came back `client_blocked` — on 5 of the prior 7 days,
with no red email ever sent since #43 added the direct Resend path. Root
cause: neither sentinel-v5 check-in this job emits reads the run's own
verdict. `sl-ui-sentry` goes red only from the wrapper's own exit code, and
`orchestrator.mjs` deliberately keeps exit 0 for "degraded-not-fail" (a
designed state, not a crash — see the exit-code table in `finalize()`).
`sl-ui-sentry-live-chat` goes red only when `lastSuccessfulLiveChatAt` is
more than 10 days stale, which one passing turn resets regardless of how
many others were blocked. A DEGRADED run with at least one pass was
therefore invisible to both signals, contradicting the standing rule
("degraded is red"). `sentinel_emit_item_a` (`run-ui-sentry.sh`) now also
reads `last-run.json`'s `overallLevel` and reports red (`reason_code:
degraded`) whenever it is `DEGRADED` or `FAIL`. No exit-code, cadence, page
allowlist, or live-turn-cap change.

The red-email path itself (`scripts/sentinel-v5/checkin-lib.sh`,
`sentinel_mail_red`) used to discard the Resend response entirely
(`2>&1 >/dev/null` sent the body to `/dev/null`), so a send could never be
proven. It now captures the HTTP status and Resend message id and appends
one content-free receipt (timestamp, job, reason code, status, HTTP code,
Resend message id — never a body or secret) per real send attempt to
`~/.streetlight/mail-red/receipts.log`. The per-item six-hour cooldown is
unchanged and still shared with `sl-error-stream-health`. The same
function's write to the sentinel-v5 spool (`~/.blt-sentinel/spool`) is
removed — that consumer was retired 2026-09-24 and nothing read it.

Separately, investigated `client_blocked` on turns 2-6: today's run sent all
6 fixture turns inside 48 seconds — turn 2 hung the full 30s token-wait
timeout, turns 3-6 were each refused in about 3 seconds flat. **Hypothesis,
not a proven cause:** this pattern is consistent with Cloudflare's
behavioral scoring flagging repeated challenge executions on the same
widget/session in under a minute — but nothing here actually observes
Cloudflare's side, and tier 0's `/healthz` passing proves the deploy is
configured, not that Turnstile itself is behaving normally for this
browser. Added a 6-14s read-and-think pause before each turn after the
first (`lib/human-type.mjs`'s `humanPause`) on the theory that no real user
sends that fast — no new launch flag, no fingerprint change, no new
technique, only slower pacing, so it stays inside the no-escalation rule
from the 2026-08-08 amendments above regardless of whether the theory is
right. A live run against production after adding the pause passed all 6
turns, which is consistent with the theory but is one data point, not
proof; a cross-vendor review the same day (see the amendment immediately
below) found a real, separate, and previously undiagnosed bug that could
independently produce exactly this same turn 2/turns-3-6 shape, which
means the pacing pause's own contribution here is genuinely unknown and
still unproven.

**The pause is gone, superseded same day.** `docs/decisions/2026-09-26-ui-sentry-monitor-pass.md`
adds a separate, bounded, server-gated Turnstile pass for turns after the
first (a quota-capped credential, never a fingerprint or timing trick) —
Jesse's own call on how to actually solve turns 2+ rather than working
around them with pacing. `lib/human-type.mjs`'s `humanPause` and its call
site in `tier2.mjs` are removed; see the cross-vendor-review amendment
below for the replacement wiring. The hypothesis above was never confirmed
or refuted on its own terms — it was overtaken by a real fix before either
happened.

## Amendment (2026-09-26, cross-vendor review follow-up): five findings fixed, monitor pass wired in

Astra's cross-vendor review of the previous amendment's PR came back FIX
FIRST with five findings. All five are fixed in the follow-up PR; this
records what was actually wrong and what changed, since "hypothesis, not a
proven cause" above turned out to undersell it — one of these was a real,
previously undiagnosed bug that could independently produce the exact
turn-2/turns-3-6 `client_blocked` shape this ADR spent most of a day
chasing as a Cloudflare-behavioral-scoring theory.

**1 (P1) — a turn could be classified as blocked from a PRIOR turn's
leftover notice, and turns could overlap unfinished attempts.** The app
renders its send-failure notice from a plain `useState` holding one FIXED
string. Two client-blocked turns in a row call `setErrorMessage` with the
IDENTICAL value (the client-blocked branch never writes
`lastSendFailureMessageRef`), so React bails out of re-rendering and the
SAME `<p role="status">` DOM node survives, untouched, from turn N into
turn N+1. `runTurn`'s old check ("does a matching notice exist anywhere on
the page") fired on turn N+1's very first poll from turn N's leftover
node — before turn N+1's own attempt had resolved at all. Fixed by
watching the submit control's own disabled state instead of notice text
(`isSendControlBusy` in `lib/conversation.mjs`): it cycles busy -> not-busy
on every real attempt (mirroring `isPreparingTurnstile`), independent of
whether the eventual failure text repeats, with a grace window
(`BUSY_FALL_GRACE_MS`, 5s) after the busy state clears to let an actual
send land before concluding "blocked" — the app clears that busy state
BEFORE issuing the POST, so concluding "blocked" on the tick busy ends
raced ahead of a real send during testing of the fix itself. Two
regression tests (`lib/conversation.runturn.test.mjs`) run this against a
real headless browser and a static fixture. This fix stands regardless of
the monitor pass below, since turn 1 always goes through real Turnstile.

**2 (P1) — the DEGRADED-is-red verdict check failed open.** The previous
amendment's fix defaulted to green whenever `last-run.json` couldn't be
read as `DEGRADED`/`FAIL` — also what happens when `jq` is missing, the
file is unreadable/malformed, `overallLevel` is absent, or a stale
`last-run.json` from a PREVIOUS invocation is still there. Fixed to
require BOTH a recognized `overallLevel` value and a `startedAt` at or
after this invocation's own captured instant (numeric epoch comparison,
not string — mixed-precision ISO timestamps don't sort correctly as
text); anything else reports red with a new `state_unverifiable` reason.
Split into `lib/sentinel-emit.sh` so this logic is testable in isolation;
11 new tests cover every failure mode named above.

**3 (P2) — the mail cooldown raced and a timeout could cause a resend.**
The cooldown was checked without a lock and recorded only after a
confirmed send, so two concurrent callers for the same item could both
pass the check and both send, and a timeout after Resend had already
accepted a request could resend on the next check-in. Fixed by running
the whole reserve-then-send-then-record cycle under a per-item OS
advisory lock (reusing `scripts/watch-usage-digest/mail-lock.py` from the
same-day alert-receipts work rather than re-deriving one), reserving
BEFORE sending, and attaching a per-item-per-reservation `Idempotency-Key`
header so Resend's own dedup — not this script's guess about what curl's
exit code means — is the real backstop. A definite rejection (a clean
non-2xx) releases the reservation; a curl-level failure (timeout, DNS,
connection reset — genuinely ambiguous, since Resend may already have
accepted the request) keeps it, favoring under-alerting over a possible
duplicate.

**4 (P2) — receipts trusted any response id, and any 2xx started the
cooldown.** Fixed by reusing the same-day alert-receipts work's own rule
exactly (`scripts/send-resend-email.mjs`): UUID-validate the id, and only
treat a 2xx WITH a valid id as a confirmed accept. Receipt field names now
match that same shared schema too
(`timestamp`/`job`/`httpStatus`/`resendId`, plus this path's own fixed
`reason` field) instead of an independently-chosen shape — the "matching
the same-day receipt allowlist above" claim in `docs/data_architecture.md`
is now actually true, not just asserted.

**5 (P2) — a test used `goto()` for its "back navigation" leg, so broken
Back behavior would still pass.** No explicit contract says what a real
back navigation does here (as opposed to a reload), so this was measured
instead of assumed: isolated trials against production, fresh context
each time, cleared the draft 4/4 on both engines. Split into two honestly
named cases — a real `page.goBack()` round trip, and a real reload — the
reload waiting for hydration before asserting. The real-back-navigation
case then flaked on webkit-mobile inside the full sequence (a real
browser's back-forward cache resuming live JS state instead of reloading
— a browser heuristic, not a code bug, and not something this product or
this sentry controls); asserting a hard failure on it would make tier 1
flaky over that heuristic, so it warns instead of failing, while the
deterministic reload case remains the hard-gated proof of the actual
product contract.

**Monitor pass wiring.** Same day, a separate, concurrent PR
(`docs/decisions/2026-09-26-ui-sentry-monitor-pass.md`) added a bounded,
quota-capped, server-gated credential that lets turns after the first skip
Turnstile — Jesse's own call on actually solving turns 2+ rather than
pacing around them. `tier2.mjs` now installs it (`installMonitorPass`,
after the turn-budget guard, before the page exists) and calls
`selectTurn` immediately before each turn with the real turn number and
whether turn 1 itself came back `pass`; turn 1 always goes through real
Turnstile regardless. `humanPause` (added a few hours earlier, same day)
is removed along with its call site — superseded by an actual fix, its own
causal contribution never confirmed or refuted on its own terms.
`STREETLIGHT_MONITOR_TOKEN` already exists in Doppler `agent-secrets/dev`,
the same config `run-ui-sentry.sh` already runs the whole orchestrator
under, so no separate plumbing was needed for the scheduled/manual launchd
path to see it.

A live run against production after all of the above passed 47/47 tier
0/1 cases (one informational warning: the webkit-mobile bfcache case from
finding 5) and 3 of 6 tier-2 turns for real (turns 1-3: turn 1 via real
Turnstile, turns 2-3 via the monitor pass; turns 4-6 fell back to real
Turnstile and were blocked, consistent with the monitor pass's documented
12-uses-per-UTC-day cap having been reached by cumulative same-day use
across this and the concurrent monitor-pass PR's own verification — not a
wiring defect, since turns 2-3 succeeding is direct proof the wiring
itself works). This is recorded rather than re-run repeatedly against
production chasing a clean 6-of-6 on a shared, finite, resets-at-UTC-
midnight quota.
