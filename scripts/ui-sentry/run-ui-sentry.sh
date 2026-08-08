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

# Sentinel-v5 check-in wiring (shadow phase — see
# docs/decisions/2026-08-07-scheduled-ui-sentry-live-chat-check.md and
# config/sentinel-v5-registry-fragment.streetlight.json). This emits BOTH
# items every real invocation, alongside the existing per-run email — it is
# additive wiring, not a replacement for that email or for
# ~/caller-track-pager's checkUiSentry(). `at`/`slot` are captured TOGETHER
# right here, before any of the job body (PATH preflight, lock, tests) runs,
# per spec v5.9 §3.2 — never recomputed at completion. Both items share the
# exact same schedule (23 7 * * 1,3,5 America/Los_Angeles), so one capture
# (keyed off sl-ui-sentry) is reused for both check-ins from this run.
STREETLIGHT_SENTINEL_FALLBACK_LOG="$STATE_ROOT/sentinel-v5-fallback.log"
export STREETLIGHT_SENTINEL_FALLBACK_LOG

# The sentinel module is sourced/invoked defensively: under set -uo
# pipefail, an unset $SENTINEL_AT/$SENTINEL_SLOT after a failed `source` or
# a failed sentinel_capture_invocation (missing file, syntax error, node
# missing) is a HARD abort of this entire script — which would fail the
# real job the sentinel only exists to observe, exactly what "the producer
# must never fail the caller" forbids. `|| true` on both calls plus the
# `:=` defaults below guarantee SENTINEL_AT/SENTINEL_SLOT are always a
# non-empty string before anything downstream reads them, no matter how the
# sentinel module itself fails. If sentinel_checkin/sentinel_emit_item_*
# below end up undefined because sourcing failed, calling them is a
# "command not found" (exit 127) under set -u/pipefail without set -e —
# logged, not fatal — so a fully broken sentinel module degrades to zero
# check-ins this run, never to a failed job.
#
# `.` (source) is a POSIX "special builtin": on this Mac's shipped bash
# (3.2), a special builtin's own hard failure — file not found OR a syntax
# error inside the sourced file — terminates the shell immediately under
# errexit, even when the source command is the left side of `cmd || true`.
# That exemption only protects ordinary commands, not special builtins, so
# `|| true` alone does NOT make this line safe if this wrapper is ever
# invoked under `bash -e` (e.g. `bash -e run-ui-sentry.sh`) with the
# sentinel library missing or broken. Toggle errexit off around the source
# call itself (restoring it afterward only if it was already on) so the
# special-builtin fast-fail path can never trigger, then fall back to plain
# wall-clock defaults exactly as before.
_sentinel_had_errexit=0
case "$-" in *e*) _sentinel_had_errexit=1 ;; esac
set +e
# shellcheck source=./sentinel-v5/checkin-lib.sh
. "$SCRIPT_DIR/../sentinel-v5/checkin-lib.sh"
[ "$_sentinel_had_errexit" = "1" ] && set -e
sentinel_capture_invocation sl-ui-sentry || true
: "${SENTINEL_AT:=$(date -u +%Y-%m-%dT%H:%M:%SZ)}"
: "${SENTINEL_SLOT:=$SENTINEL_AT}"
UI_SENTRY_SENTINEL_AT="$SENTINEL_AT"
UI_SENTRY_SENTINEL_SLOT="$SENTINEL_SLOT"

# sentinel_emit_item_a <exit_code> — "the sentry ran": green/red from the
# job's own exit code (spec v5.9 fragment item A). Producer failures are
# already swallowed inside sentinel_checkin (log + return 0); this never
# affects this wrapper's own exit code.
sentinel_emit_item_a() {
  local exit_code="$1"
  if [ "$exit_code" = "0" ]; then
    sentinel_checkin sl-ui-sentry green ok "$UI_SENTRY_SENTINEL_AT" "$UI_SENTRY_SENTINEL_SLOT" || true
  else
    sentinel_checkin sl-ui-sentry red job_failed "$UI_SENTRY_SENTINEL_AT" "$UI_SENTRY_SENTINEL_SLOT" || true
  fi
}

# sentinel_emit_item_b — "live chat has succeeded recently": status comes
# ONLY from the age of lastSuccessfulLiveChatAt in last-run.json, NEVER from
# this run's exit code (fragment item B; expected RED on day one and
# continuously until Turnstile is solved — that is the point, not a bug).
# Threshold N = 10 days. Reads whatever last-run.json currently holds,
# including a previous run's value on a code path (e.g. node_modules
# missing) where this invocation never got to run the orchestrator.
SENTINEL_LIVE_CHAT_THRESHOLD_DAYS=10
sentinel_emit_item_b() {
  local state_file="$STATE_ROOT/last-run.json"
  local status reason
  # UI_SENTRY_LAST_SUCCESS_AT is deliberately NOT `local`: the PATH-missing
  # fallback path below (which calls this function before overwriting
  # last-run.json) reuses this exact value so the fallback write can carry a
  # real prior success forward instead of clobbering it with null.
  UI_SENTRY_LAST_SUCCESS_AT=""
  if [ -f "$state_file" ] && command -v jq >/dev/null 2>&1; then
    UI_SENTRY_LAST_SUCCESS_AT="$(jq -r '.lastSuccessfulLiveChatAt // empty' "$state_file" 2>/dev/null || true)"
  fi
  if [ -z "$UI_SENTRY_LAST_SUCCESS_AT" ]; then
    status="red"; reason="degraded"
  elif node -e '
      const last = new Date(process.argv[1]).getTime();
      const now = new Date(process.argv[2]).getTime();
      const thresholdMs = Number(process.argv[3]) * 86400000;
      if (!Number.isFinite(last) || !Number.isFinite(now)) process.exit(1);
      const ageMs = now - last;
      // A future-dated timestamp (age < 0) is garbage, not "very fresh" —
      // require the age to be non-negative as well as under the threshold,
      // or a bogus future value would read green for threshold-plus-however-
      // far-ahead days.
      process.exit((ageMs >= 0 && ageMs <= thresholdMs) ? 0 : 1);
    ' "$UI_SENTRY_LAST_SUCCESS_AT" "$UI_SENTRY_SENTINEL_AT" "$SENTINEL_LIVE_CHAT_THRESHOLD_DAYS" 2>/dev/null; then
    status="green"; reason="ok"
  else
    status="red"; reason="degraded"
  fi
  sentinel_checkin sl-ui-sentry-live-chat "$status" "$reason" "$UI_SENTRY_SENTINEL_AT" "$UI_SENTRY_SENTINEL_SLOT" || true
}

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
  # Item B must be computed and emitted BEFORE the fallback state write
  # below, not after: that write has no way to know this run's real
  # lastSuccessfulLiveChatAt (this fires before node/doppler are even known
  # to work). sentinel_emit_item_b (just below) already reads the PRIOR
  # last-run.json and leaves that value in UI_SENTRY_LAST_SUCCESS_AT as a
  # side effect — reuse it here so the fallback write CARRIES a real prior
  # success FORWARD instead of clobbering it with null. Overwriting a real
  # Friday timestamp with null on a Monday PATH-missing run would otherwise
  # make a later Wednesday run (which reads this file, not item B's
  # already-emitted check-in) see nothing and report red even though Friday
  # is still inside the freshness window. Item A still reports red/job_failed
  # for this invocation regardless, since the sentry itself did not run.
  sentinel_emit_item_a 5
  sentinel_emit_item_b

  if [ -n "$UI_SENTRY_LAST_SUCCESS_AT" ]; then
    last_success_json="\"$UI_SENTRY_LAST_SUCCESS_AT\""
  else
    last_success_json="null"
  fi

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
  "lastSuccessfulLiveChatAt": $last_success_json,
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
    # This invocation's own SENTINEL_AT/SENTINEL_SLOT were already captured
    # above, before the lock check, so this slot must still be accounted for
    # here — the run holding the lock captured its OWN (different) slot and
    # will never emit for this one. Silence here is how a scheduled slot
    # disappears from the spine. Mirrors the PATH-missing (exit 5) and
    # node_modules-missing (exit 4) bail-outs elsewhere in this file: the
    # sentry did not execute its job body for this slot, which is the same
    # red/job_failed condition those paths already report via
    # sentinel_emit_item_a's exit-code mapping. Item B is unaffected by any
    # of this — it always reads last-run.json's real prior value, lock or no
    # lock.
    sentinel_emit_item_a 3
    sentinel_emit_item_b
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
  # The orchestrator never ran this invocation, so last-run.json (if any)
  # still reflects a prior run's lastSuccessfulLiveChatAt — item B reads
  # whatever is actually there rather than assuming null.
  sentinel_emit_item_a 4
  sentinel_emit_item_b
  exit 4
fi

# Browsers live inside this package's own node_modules (install.sh installs
# them with the matching PLAYWRIGHT_BROWSERS_PATH=0), independent of the
# shared ~/Library/Caches/ms-playwright other tools on this machine use.
export PLAYWRIGHT_BROWSERS_PATH=0

# One doppler-wrapped call runs tests AND sends the email (R14).
doppler run --project agent-secrets --config dev -- node orchestrator.mjs
ui_sentry_exit_code=$?

# Both check-ins fire after the orchestrator's own finalizer has already
# written last-run.json (R13's one-finalizer-path), so item B reads this
# run's real lastSuccessfulLiveChatAt, not a stale value. This wrapper's own
# exit code is unaffected either way (sentinel_checkin never fails the
# caller).
sentinel_emit_item_a "$ui_sentry_exit_code"
sentinel_emit_item_b

exit "$ui_sentry_exit_code"
