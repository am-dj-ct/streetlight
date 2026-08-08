#!/usr/bin/env bash
# Streetlight UI sentry wrapper. Modeled on caller-track's
# scripts/refresh/run-nightly-refresh.sh and scripts/ui-health/run-all.sh:
# set -uo pipefail, state root outside the repo, doppler-wrapped secrets at
# runtime only, a single scheduled fire per invocation (no internal retry
# loop — an auto-retry once hid a real first-attempt failure in
# caller-track, and a separate restart loop there burned ~$52 of metered
# traffic; this wrapper has neither, and the plist carries no KeepAlive).
#
# Almost all of the real logic (tier 0/1/2, browser preflight, the email
# send) lives in orchestrator.mjs, run once, doppler-wrapped, so
# RESEND_API_KEY reaches the mailer and the email always goes through the
# same one finalizer path (R13/R14) — including for a site-down or
# missing-browser failure. This wrapper's job is armor around that single
# invocation: caffeinate, the state root, the single-instance lock, and
# nothing that could itself become a second place logic lives.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT_PATH="$SCRIPT_DIR/$(basename "${BASH_SOURCE[0]}")"

# R8: runs under /usr/bin/caffeinate -i so a live-model turn never gets cut
# off by the Mac sleeping mid-run. Re-exec once under caffeinate, guarded by
# an env marker so this can't recurse. Must re-exec with the resolved
# ABSOLUTE path — caffeinate execs its argument via a bare PATH lookup, and
# a relative "$0" like "run-ui-sentry.sh" (no "/" in it) is not found on
# PATH even though the shell itself was happily invoked with it.
if [ "${UI_SENTRY_CAFFEINATED:-0}" != "1" ] && command -v caffeinate >/dev/null 2>&1; then
  export UI_SENTRY_CAFFEINATED=1
  exec /usr/bin/caffeinate -i "$SCRIPT_PATH" "$@"
fi

STATE_ROOT="${UI_SENTRY_STATE_ROOT:-$HOME/.streetlight/ui-sentry}"
LOCK_DIR="$STATE_ROOT/run.lock"

mode="${1:-}"
if [ "$mode" != "--live" ]; then
  echo "usage: run-ui-sentry.sh --live" >&2
  exit 2
fi

mkdir -p "$STATE_ROOT/logs"

# PATH preflight. launchd's default minimal PATH for a GUI agent
# (/usr/bin:/bin:/usr/sbin:/sbin) does not include Homebrew, where both
# `doppler` and `node` live on this Mac — and the plist now sets
# EnvironmentVariables.PATH to compensate (same pattern as the sibling
# com.callertrack.ui-health.plist), but a future edit could drop that, or a
# manual invocation could run under a shell with its own broken PATH. Fail
# loudly here rather than dying silently before orchestrator.mjs — which is
# the only place that would otherwise write state and send the email — ever
# starts.
missing_tools=()
command -v doppler >/dev/null 2>&1 || missing_tools+=("doppler")
command -v node >/dev/null 2>&1 || missing_tools+=("node")

if [ "${#missing_tools[@]}" -gt 0 ]; then
  STAMP_ISO="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  reason="PATH is missing required tool(s): ${missing_tools[*]} (PATH=$PATH)"
  echo "$STAMP_ISO ui-sentry: $reason" >&2

  # This failure happens BEFORE the doppler-wrapped orchestrator.mjs ever
  # starts, so the normal one-finalizer-path (R13) can't run. Do the closest
  # bash-only equivalent: write a content-free state file directly (no node
  # needed), then attempt the email with whatever is actually on PATH.
  # RESEND_API_KEY is only ever sourced via doppler, which is exactly what's
  # missing here, so this email attempt will normally fail closed — that's
  # expected, not a bug in this fallback. The nonzero exit below is what
  # actually surfaces the failure (launchd's stderr log).
  state_tmp="$STATE_ROOT/.last-run.json.tmp-$$"
  cat > "$state_tmp" <<STATE_JSON
{
  "status": "FAIL",
  "startedAt": "$STAMP_ISO",
  "finishedAt": "$STAMP_ISO",
  "exitCode": 5,
  "baseUrl": null,
  "tier0": { "status": "fail", "reason": "path_misconfigured", "cases": [] },
  "tier1": null,
  "tier2": null,
  "consecutiveBlockedRuns": null,
  "lastSuccessfulLiveChatAt": null,
  "escalatedFromBlocked": false,
  "crashError": "$reason",
  "overallLevel": "FAIL",
  "emailAccepted": null,
  "emailHttpStatus": null
}
STATE_JSON
  mv "$state_tmp" "$STATE_ROOT/last-run.json"

  if command -v curl >/dev/null 2>&1 && [ -n "${RESEND_API_KEY:-}" ] && [ -n "${RESOURCE_REVIEW_EMAIL_TO:-}" ]; then
    curl -s -o /dev/null --max-time 15 -X POST "https://api.resend.com/emails" \
      -H "Authorization: Bearer $RESEND_API_KEY" \
      -H "Content-Type: application/json" \
      -d "{\"from\":\"${RESOURCE_REVIEW_EMAIL_FROM:-Streetlight UI Sentry <onboarding@resend.dev>}\",\"to\":[\"$RESOURCE_REVIEW_EMAIL_TO\"],\"subject\":\"Streetlight UI sentry: FAIL (PATH misconfigured)\",\"text\":\"$reason\"}" \
      || true
  fi

  echo "$STAMP_ISO ui-sentry: cannot proceed without doppler/node on PATH — exiting" >&2
  exit 5
fi

# Single-instance lock (R17: manual runs share the same caps and must not
# overlap a scheduled fire, or vice versa). mkdir is atomic; a stray lock
# older than 2 hours is treated as abandoned (a real run never takes that
# long) rather than wedging the job forever.
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  lock_age_seconds=999999
  if [ -d "$LOCK_DIR" ]; then
    lock_mtime="$(stat -f %m "$LOCK_DIR" 2>/dev/null || echo 0)"
    lock_age_seconds=$(( $(date +%s) - lock_mtime ))
  fi
  if [ "$lock_age_seconds" -lt 7200 ]; then
    echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) ui-sentry: another run holds the lock ($LOCK_DIR, ${lock_age_seconds}s old) — exiting without a run" >&2
    exit 3
  fi
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) ui-sentry: stale lock (${lock_age_seconds}s old) — reclaiming" >&2
  rmdir "$LOCK_DIR" 2>/dev/null || true
  mkdir "$LOCK_DIR"
fi
trap 'rmdir "$LOCK_DIR" 2>/dev/null || true' EXIT

cd "$SCRIPT_DIR"

if [ ! -d node_modules ]; then
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) ui-sentry: node_modules missing — run install.sh first (never installed at scheduled-run time, R11)" >&2
  exit 4
fi

# Browsers live inside this package's own node_modules (install.sh installs
# them with the matching PLAYWRIGHT_BROWSERS_PATH=0), independent of the
# shared ~/Library/Caches/ms-playwright other tools on this machine use.
export PLAYWRIGHT_BROWSERS_PATH=0

# One doppler-wrapped call runs tests AND sends the email (R14).
doppler run --project agent-secrets --config dev -- node orchestrator.mjs
exit $?
