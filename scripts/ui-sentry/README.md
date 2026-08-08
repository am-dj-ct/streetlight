# Streetlight UI sentry

A scheduled, real-browser check of production `https://streetlight.help`,
run 3x/week (Mon/Wed/Fri 07:23 local) from this Mac. It walks the site the
way a person would — page loads, buttons, navigation, scrolling, locale
switch — and best-effort exercises a short live-model conversation, then
emails Jesse a content-free pass/fail report so he doesn't have to test by
hand.

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
  engines), then tier 2, then sends the report email — all inside one
  `doppler run` invocation so `RESEND_API_KEY` reaches the mailer (R14) and
  every possible ending (pass, fail, crash, signal) goes through the same
  finalizer: atomic state write, bounded-timeout email with retries,
  correct exit code (R13).
- `tier0.mjs` — browser preflight, site-up gate (3x bounded `fetch` at the
  root URL), `/healthz` gate.
- `tier1.mjs` — structural checks, no model spend, run once per engine
  (Chromium desktop viewport, WebKit iPhone viewport). Must pass or tier 2
  is skipped.
- `tier2.mjs` — best-effort live conversation (real Chrome channel, 6 synthetic
  turns, hard-capped at 8 by request-boundary interception).
- `lib/` — shared helpers (browser/session setup, human-like typing, the
  conversation send/reply state machine, chat-response classification,
  `/healthz` fetch, atomic state I/O, the bounded email sender, the
  content-free report builder).
- `fixtures/tier2-prompts.mjs` — the six synthetic benefits/shelter-arc
  prompts. Never real user content.
- `run-ui-sentry.sh` — the scheduled entry point (caffeinate, single-instance
  lock, doppler wrapping, browser-presence check).
- `install.sh` — setup-time only: `npm ci`, browser install, copies the
  plist. Never loads the launchd job (see the PR's commissioning checklist).
- `com.streetlight.ui-sentry.plist` — Mon/Wed/Fri 07:23 local, no
  `KeepAlive`, no `RunAtLoad`.

## Running manually

```
cd scripts/ui-sentry
./install.sh          # first time only, or after a dependency bump
./run-ui-sentry.sh --live
```

Manual runs share the exact same turn budget, single-instance lock, and
email path as the scheduled run (R17) — there is no separate "test mode."

## State

Everything lives under `~/.streetlight/ui-sentry/`, never inside the repo
working tree:

- `last-run.json` — status, timestamps, tier results, turn budget used,
  `lastSuccessfulLiveChatAt`, `consecutiveBlockedRuns`, email
  accepted/status, exit code. Content-free — see the ADR for the exact
  schema this allowlists.
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
  next scheduled day is the recovery path. See the ADR for the honest
  dead-man-detection gap this leaves (R12) — this sentry's own email cannot
  prove anything if the Mac, launchd, or Doppler itself is what died.

## What this does not do (v1, deliberate)

- No self-heal, no auto-remediation of any kind. This job detects and
  emails; a human decides what runs next.
- No dry-run form submission on the report-problem page (structural checks
  only, never submitted).
- No exploratory-agent session.

See the PR body's "Later" list for why these are deliberate follow-ups, not
gaps.
