#!/usr/bin/env bash
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE_ROOT="${STREETLIGHT_ERROR_STREAM_HEALTH_STATE_ROOT:-$HOME/.streetlight/error-stream-health}"
ARTIFACT="${STREETLIGHT_ERROR_STREAM_HEALTH_ARTIFACT:-$HOME/.blt-hub/source-health/streetlight-error-stream-health.json}"
STATE_FILE="${STREETLIGHT_ERROR_STREAM_HEALTH_STATE_FILE:-$STATE_ROOT/state.json}"
ITEM="sl-error-stream-health"

mkdir -p "$STATE_ROOT"
STREETLIGHT_SENTINEL_FALLBACK_LOG="$STATE_ROOT/sentinel-v5-fallback.log"
export STREETLIGHT_SENTINEL_FALLBACK_LOG STREETLIGHT_ERROR_STREAM_HEALTH_ARTIFACT="$ARTIFACT" \
  STREETLIGHT_ERROR_STREAM_HEALTH_STATE_FILE="$STATE_FILE"

# shellcheck source=../sentinel-v5/checkin-lib.sh
. "$SCRIPT_DIR/../sentinel-v5/checkin-lib.sh"
sentinel_capture_invocation "$ITEM" || true
: "${SENTINEL_AT:=$(date -u +%Y-%m-%dT%H:%M:%SZ)}"
: "${SENTINEL_SLOT:=$SENTINEL_AT}"
run_started_epoch="$(date +%s)"

if ! command -v doppler >/dev/null 2>&1 || ! command -v node >/dev/null 2>&1; then
  sentinel_checkin "$ITEM" red job_failed "$SENTINEL_AT" "$SENTINEL_SLOT" || true
  echo "error-stream-health: required runtime unavailable" >&2
  exit 1
fi

# sentinel_doppler_run (checkin-lib.sh) serves this off a local fallback
# file when it is fresher than 6h, and falls back to it on a 429 too — see
# its header for why: this job hit Doppler's shared 240-req/60s rate limit
# three times on 2026-09-04 and reported status error each time even though
# the secrets it needed hadn't changed in hours.
run_exit=0
sentinel_doppler_run "agent-secrets" "dev" -- node "$SCRIPT_DIR/run-health.mjs" || run_exit=$?

watcher_result="$(node "$SCRIPT_DIR/watcher.mjs" "$ARTIFACT" 2>/dev/null)" || {
  sentinel_checkin "$ITEM" red job_failed "$SENTINEL_AT" "$SENTINEL_SLOT" || true
  echo "error-stream-health: watcher could not read its artifact" >&2
  exit 1
}

IFS=$'\t' read -r checkin_status reason_code watcher_action watcher_exit artifact_status \
  failure_reason upstream_status upstream_latency attempts consecutive_failures <<< "$watcher_result"

artifact_mtime="$(stat -f %m "$ARTIFACT" 2>/dev/null || stat -c %Y "$ARTIFACT" 2>/dev/null || echo 0)"
if [ "$run_exit" -ne 0 ] && [ "$artifact_mtime" -lt "$run_started_epoch" ]; then
  case "${SENTINEL_DOPPLER_RUN_STATUS:-}" in
    rate_limited_no_fallback) failure_reason="secret_rate_limited" ;;
    live_failed) failure_reason="secret_provider_failed" ;;
    *) failure_reason="health_runner_failed" ;;
  esac
  echo "error-stream-health: status=error reason=$failure_reason upstream_status=null upstream_latency_ms=null attempts=0 consecutive_failures=unknown action=escalate" >&2
  sentinel_checkin "$ITEM" red job_failed "$SENTINEL_AT" "$SENTINEL_SLOT" || true
  exit 1
fi

if [ "$artifact_status" = "error" ]; then
  echo "error-stream-health: status=$artifact_status reason=$failure_reason upstream_status=$upstream_status upstream_latency_ms=$upstream_latency attempts=$attempts consecutive_failures=$consecutive_failures action=$watcher_action" >&2
fi

sentinel_checkin "$ITEM" "$checkin_status" "$reason_code" "$SENTINEL_AT" "$SENTINEL_SLOT" || true
exit "$watcher_exit"
