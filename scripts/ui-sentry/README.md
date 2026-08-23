# Streetlight UI sentry

A scheduled, real-browser check of production `https://streetlight.help`,
run 3x/week (Mon/Wed/Fri 07:23 local) from this Mac. It walks the site the
way a person would — page loads, buttons, navigation, scrolling, locale
switch — and best-effort exercises a short live-model conversation, then
records a content-free pass/fail report so Jesse doesn't have to test by
hand.

**It sends no email.** The report is written to this run's log and to
`last-run.json`; the verdict reaches a human through the two monitors that
read those files (see Reporting below). Removing the old every-run email is
ADR `docs/decisions/2026-08-17-ui-sentry-reports-without-email.md`.

Standalone package (own `package.json`, own lockfile), same pattern as
`scripts/prod-validation/`. The app build does not depend on it.

## Design note: plain scripts, not the `playwright test` runner

Tier 2's three-state verdict (pass / blocked / fail) and the single
content-free `last-run.json` report don't map cleanly onto the pass/fail
test-runner model, so `tier0.mjs` / `tier1.mjs` / `tier2.mjs` are plain async
functions that drive Playwright's browser launchers directly — the same
pattern `scripts/prod-validation/validate-live.mjs` already uses.
`playwright.config.mjs` still exists and is real (it's imported directly by
the tier scripts for the desktop/mobile device/viewport definitions), but
nothing here runs through `npx playwright test`.

## Layout

- `orchestrator.mjs` — the one entry point. Runs tier 0, then tier 1 (both
  engines), then tier 2, then writes the report — all inside one
  `doppler run` invocation (R14), and every possible ending (pass, fail,
  crash, signal) goes through the same finalizer: report written to the run
  log, atomic state write, correct exit code (R13).
- `tier0.mjs` — browser preflight, site-up gate (3x bounded `fetch` at the
  root URL), `/healthz` gate.
- `tier1.mjs` — structural checks, no model spend, run once per engine
  (Chromium desktop viewport, WebKit iPhone viewport). Must pass or tier 2
  is skipped.
- `tier2.mjs` — best-effort live conversation (real Chrome channel, 6 synthetic
  turns, hard-capped at 8 by request-boundary interception).
- `lib/` — shared helpers (browser/session setup, human-like typing, the
  conversation send/reply state machine, chat-response classification,
  `/healthz` fetch, atomic state I/O, the content-free report builder).
- `fixtures/tier2-prompts.mjs` — the six synthetic benefits/shelter-arc
  prompts. Never real user content.
- `run-ui-sentry.sh` — the scheduled entry point (caffeinate, single-instance
  lock, doppler wrapping, browser-presence check).
- `install.sh` — setup-time only: `npm ci`, browser install, copies the
  plist. Never loads the launchd job (see the PR's commissioning checklist).
- `com.streetlight.ui-sentry.plist` — Mon/Wed/Fri 07:23 local, no
  `KeepAlive`, no `RunAtLoad`.

Tier 2 adds `x-streetlight-synthetic: ui-sentry` only alongside an
`Authorization: Bearer` value from `OPS_READ_TOKEN`. Production excludes a
turn from usage totals only when that bearer token passes the normal ops-auth
check; the marker alone is never trusted. Missing credentials fail the sentry
closed before a live chat request is sent.

## Tier 1 browser pin

Tier 1 always uses the Chromium and WebKit binaries installed by this
standalone package. It never prefers the separately updated system Chrome.
That keeps structural results bound to the reviewed Playwright lockfile;
real Chrome is reserved for tier 2 because Turnstile behavior requires it.

On 2026-08-19 the system-Chrome tier 1 produced three early command
timeouts even though its first expected element was already visible. The
same session passed its remaining 19 checks, pinned WebKit passed all 23,
and a current structural rerun passed. That was a browser-command false
failure, not a missing production page. Pinning tier 1 removes that drift
without adding a retry or weakening a real structural failure.

## Running manually

```
cd scripts/ui-sentry
./install.sh          # first time only, or after a dependency bump
./run-ui-sentry.sh --live
```

Manual runs share the exact same turn budget, single-instance lock, and
reporting path as the scheduled run (R17) — there is no separate "test
mode."

## State

Everything lives under `~/.streetlight/ui-sentry/`, never inside the repo
working tree:

- `last-run.json` — status, timestamps, tier results, turn budget used,
  `lastSuccessfulLiveChatAt`, `consecutiveBlockedRuns`, exit code.
  Content-free — see the ADR for the exact schema this allowlists. This is
  the file `~/caller-track-pager`'s `checkUiSentry()` pages on, so its
  status and `finishedAt` are load-bearing.
- `logs/<timestamp>.log` — one file per run, content-free structured lines
  only (case names, HTTP statuses, timings — never typed prompts or model
  replies).
- `run.lock/` — single-instance marker directory, removed on exit.
- `launchd.out.log` / `launchd.err.log` — launchd's own stdout/stderr
  capture, for anything that happens before the wrapper's own logging is
  live.

Playwright artifacts: trace and video are off everywhere. Screenshots are
only-on-failure in tier 1 and hard-off in tier 2 (R7). Any tier 1 failure
screenshot is written under the state root, never uploaded anywhere.

## Reporting: headlines and the persistent-blocked escalation

Every run writes a report; nothing is emailed. Two independent monitors read
what the run wrote, and between them they are the whole alerting surface:

- **`~/caller-track-pager`'s `checkUiSentry()`** reads `last-run.json` and
  pages (Pushover) on `status: FAIL` or a record older than 74h — so a
  missed Mon/Wed/Fri fire is caught by staleness, which is what the old
  "absence of the email is the dead-man signal" was reaching for.
- **sentinel-v5 check-ins** `sl-ui-sentry` (green/`ok` or red/`job_failed`
  from this run's exit code) and `sl-ui-sentry-live-chat` (green/`ok` or
  red/`degraded` from the age of `lastSuccessfulLiveChatAt`). Both are live
  registry items with digest escalation and a 45-minute grace window, so a
  slot that never checks in is itself reported.

### Sentinel incident closure contract

For `sl-ui-sentry` + `job_failed`, the one content-free incident lifecycle
is:

1. **DETECT:** the red check-in or missed slot opens the Sentinel incident;
   `last-run.json.status`, tier statuses, failed-case count, and fixed error
   class are the diagnostic evidence. Never copy page or chat content.
2. **OWN:** Sentinel assigns a Streetlight repair lane. Class R must not
   blindly kickstart the normal label because that default path can reach
   tier 2 and spend live-model turns.
3. **REPAIR:** fix the source cause in review. A deliberately authorized
   structural verification uses `UI_SENTRY_SKIP_TIER2=1` on the same locked
   wrapper path; it makes no `/api/chat` calls.
4. **COALESCE:** keep one incident keyed by item and failure episode. The
   local pager and Sentinel currently lack a shared delivery key, so direct
   cross-monitor notification coalescing remains a caller-track-pager
   follow-up outside this repo's single-writer boundary.
5. **VERIFY:** close only after a fresh structural run is PASS, its
   `sl-ui-sentry` check-in is green for the repair run, and the Sentinel
   incident is resolved. A passing ad hoc browser probe alone is not enough.

The headline line — written first into the run log, and the same string the
email subject used to be — is one of:

- `Streetlight UI sentry: PASS`
- `Streetlight UI sentry: DEGRADED (chat blocked)` — tier 2 came back
  uniformly Turnstile-blocked (see Turn budget section below), 1st or 2nd
  consecutive run.
- `Streetlight UI sentry: DEGRADED (chat blocked, N consecutive)` — the
  steady state once the 3-run escalation threshold has already fired once
  (see below); N is the running consecutive-blocked count.
- `Streetlight UI sentry: FAIL (chat blocked 3 runs running)` — sent
  **exactly once**, the run where 3 consecutive blocked runs is first
  reached.
- `Streetlight UI sentry: PASS (chat recovered)` — the first run after a
  live turn actually succeeds, following an active blocked-streak
  escalation. Only used when the rest of that run is otherwise clean; a
  concurrent unrelated failure is reported normally instead, never masked
  by recovery framing.
- `Streetlight UI sentry: FAIL` / `FAIL (site down)` — tier 0 or tier 1
  failed for a reason unrelated to the blocked-streak state.
- `Streetlight UI sentry: <level> (structural only, tier 2 skipped)` — a
  `--skip-tier2` run (see below); `<level>` reflects tier 0/1 only.

**Why this shape, not a flat 3-consecutive-blocked-always-escalates rule:**
a structurally blocked chat path (Turnstile withholding a token from every
automated turn) is a known, standing condition once it's been flagged once
— re-sending `FAIL` on every run thereafter trains the reader to stop
opening the one alert that's actually supposed to matter. The escalation
fires once, `last-run.json`'s `blockedEscalationActive` flag remembers that
it fired, subsequent blocked runs go back to a steady, still-visibly-
abnormal `DEGRADED (chat blocked, N consecutive)`, and the flag only clears
(with a recovery-flavored subject) the moment a live turn actually
succeeds. See the ADR's Reporting section for the full state-machine
rationale.

## Structural-only runs (`--skip-tier2`)

`--skip-tier2` (equivalently `UI_SENTRY_SKIP_TIER2=1`) runs tier 0 and tier
1 only — no `/api/chat` calls, no model spend — and reports normally with a
headline tagged `(structural only, tier 2 skipped)`. It
does not touch the persistent blocked-streak state
(`consecutiveBlockedRuns`, `blockedEscalationActive`) — a run that made no
observation about the chat path must not reset or otherwise disturb that
tracking. Used for post-merge commissioning (R9: verify the launchd path
end to end without spending on every check) and for re-verifying a tier
0/1 fix without burning live turns.

```
UI_SENTRY_SKIP_TIER2=1 ./run-ui-sentry.sh --live
```

## PATH preflight

launchd's default minimal PATH for a GUI agent
(`/usr/bin:/bin:/usr/sbin:/sbin`) does not include Homebrew, where both
`doppler` and `node` live on this Mac (`/opt/homebrew/bin`). The plist sets
`EnvironmentVariables.PATH` to compensate (same pattern as the sibling
`~/Library/LaunchAgents/com.callertrack.ui-health.plist`), and
`run-ui-sentry.sh` also preflights `doppler`/`node` on PATH itself before
doing anything else, in case that plist setting is ever dropped or a manual
invocation runs under a shell with its own broken PATH. If either is
missing: the wrapper writes a content-free `last-run.json` directly (no
node required), emits both sentinel check-ins (item A red), and exits
nonzero so the failure is also visible in `launchd.err.log`.

## Turn budget and abuse controls

Tier 2 sends at most 6 real turns, hard-capped at 8 by a
`context.route("**/api/chat", …)` interceptor that aborts any POST past the
cap before it reaches the network (R17). The schedule caps this at 3
runs/week — see the ADR for the full weekly ceiling this implies.

## Requirements to run

- Mac on AC power. The wrapper re-execs itself under
  `/usr/bin/caffeinate -i` so a live turn is never cut off by sleep, but
  caffeinate only prevents idle sleep — it does not override a low-battery
  forced sleep.
- User logged into the GUI session. Screen lock is fine (the R9
  commissioning checklist proves a run with the screen locked); logging out
  of the GUI session kills GUI `launchd` agents entirely.
- Missed fire: `StartCalendarInterval` does not queue or catch up a missed
  fire (Mac asleep/off at 07:23). The job simply does not run that day; the
  next scheduled day is the recovery path. This sentry cannot report on its
  own death — if the Mac, launchd, or Doppler is what failed, nothing here
  runs at all. That gap (R12) is covered from outside: the pager's 74h
  staleness check on `last-run.json`, and the sentinel's grace window on a
  slot that never checked in.

## What this does not do (v1, deliberate)

- No self-heal, no auto-remediation of any kind. This job detects and
  records; a human decides what runs next.
- No dry-run form submission on the report-problem page (structural checks
  only, never submitted).
- No exploratory-agent session.

See the PR body's "Later" list for why these are deliberate follow-ups, not
gaps.
