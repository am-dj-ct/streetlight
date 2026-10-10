# The usage digest reports the nightly UI/UX audit

**Date:** 2026-10-10
**Status:** Accepted; ships with the change that adds it.

Extends `2026-08-17-ui-sentry-reports-without-email.md`, which said nothing
about the sentry's result leaves the machine. One thing now does: a small,
content-free summary, published to a GitHub Actions repo variable so the
daily usage digest email can say whether the audit passed in full. The
no-email rule, the alerting monitors, the live-turn cap and the content-free
allowlist are unchanged.

## Context

The daily "Streetlight usage digest" email is built in GitHub's cloud. The UI
sentry runs on the operator's Mac, and its result exists only in
`~/.streetlight/ui-sentry/last-run.json`. Reading the digest, the operator
could not tell whether last night's audit passed, and a green digest said
nothing about the audit at all.

## Options considered

- Have the cloud digest run the audit. Rejected: tier 2 needs a visible real
  Chrome window to get a Turnstile token and spends model turns.
- Have the Mac email or push the result. Rejected: reintroduces the
  per-run mail this job was deliberately stripped of.
- Have the digest workflow read the Mac over the network. Rejected: opens an
  inbound path to the operator's machine.
- Publish a summary to a repo Actions variable (`UI_SENTRY_LAST_RESULT`) with
  `gh variable set`, using the GitHub account the operator already uses to
  run this repo's workflows and the digest watcher. Chosen: no new vendor, no
  new secret, no inbound path, and the digest already runs in the same repo.

## Decision

- `scripts/ui-sentry/run-ui-sentry.sh` publishes from an `EXIT` handler, so
  every ending (pass, fail, crash, PATH-preflight exit, node_modules-missing
  exit, lock-held exit) refreshes the variable from whatever `last-run.json`
  then says. Publishing is best-effort: bounded to 30 seconds, never changes
  the wrapper's exit code, and logs one content-free line to the run log and
  `~/.streetlight/ui-sentry/publish-result.log`. `UI_SENTRY_PUBLISH=0` skips it.
- The summary (`scripts/lib/ui-audit-summary.mjs`) holds only: overall status,
  the fixed headline string, finish time, exit code, per-tier status, check
  counts, up to 8 failed test case names, a fixed tier-0 reason token and a
  fixed failure class token. Case names are fixed strings written in the
  sentry's own code ("chromium-desktop: home loads"). Tokens that do not match
  a closed character set are dropped. It never carries page text, chat turns,
  error text, stack traces, host load, or file paths.
- The digest prints one line at the top. "PASSED IN FULL" requires status
  PASS and tiers 0, 1 and 2 all passed; tier 2 blocked, partial or skipped is
  "NOT A FULL PASS". A missing, unreadable or over-30-hour-old result prints
  "NO RESULT"; the line is never omitted.

## Consequences and limits

- The repo is public. Variable values are not readable by the public, but the
  digest body is uploaded as a workflow artifact and the audit line, including
  failed case names, travels with it. That is the same sensitivity class as
  the aggregate counts the artifact already carries and reveals only which
  fixed UI checks failed.
- The line reports the sentry's last run, not live site health. A Mac that is
  off or logged out produces "NO RESULT" after 30 hours rather than a false
  pass. This does not replace the pager's 74-hour staleness check or the
  sentinel check-ins.
- A run killed with SIGKILL does not publish; the previous result simply ages.
- The Mac's `gh` login must be able to set repo variables (needs `repo`
  scope and admin on the repo). If it loses that, the failure is in the
  publish log and the digest degrades to NO RESULT within 30 hours.
