#!/usr/bin/env bash
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# The supervisor owns a durable five-minute ledger and a whole-run deadline.
if [ "${1:-}" != "--worker" ]; then
  exec python3 "$SCRIPT_DIR/slots.py" "$SCRIPT_DIR/run-error-stream-health.sh"
fi
STATE_ROOT="${STREETLIGHT_ERROR_STREAM_HEALTH_STATE_ROOT:-$HOME/.streetlight/error-stream-health}"
ARTIFACT="${STREETLIGHT_ERROR_STREAM_HEALTH_ARTIFACT:-$HOME/.blt-hub/source-health/streetlight-error-stream-health.json}"
STATE_FILE="${STREETLIGHT_ERROR_STREAM_HEALTH_STATE_FILE:-$STATE_ROOT/state.json}"

# Exit codes consumed by slots.py. The slot supervisor is the only owner of
# Sentinel check-ins and red-page decisions for this job.
RUNTIME_UNAVAILABLE_EXIT=20
ARTIFACT_UNREADABLE_EXIT=21
HEALTH_RUNNER_FAILED_EXIT=22
SECRET_PROVIDER_FAILED_EXIT=23
SECRET_RATE_LIMITED_EXIT=24

mkdir -p "$STATE_ROOT"
STREETLIGHT_SENTINEL_FALLBACK_LOG="$STATE_ROOT/sentinel-v5-fallback.log"
export STREETLIGHT_SENTINEL_FALLBACK_LOG STREETLIGHT_ERROR_STREAM_HEALTH_ARTIFACT="$ARTIFACT" \
  STREETLIGHT_ERROR_STREAM_HEALTH_STATE_FILE="$STATE_FILE"

if ! command -v doppler >/dev/null 2>&1 || ! command -v node >/dev/null 2>&1; then
  echo "error-stream-health: required runtime unavailable" >&2
  exit "$RUNTIME_UNAVAILABLE_EXIT"
fi

# shellcheck source=../sentinel-v5/checkin-lib.sh
. "$SCRIPT_DIR/../sentinel-v5/checkin-lib.sh"

artifact_identity() {
  stat -f '%i:%m:%z' "$ARTIFACT" 2>/dev/null \
    || stat -c '%i:%Y:%s' "$ARTIFACT" 2>/dev/null \
    || printf 'missing'
}
artifact_before="$(artifact_identity)"

# sentinel_doppler_run (checkin-lib.sh) serves this off a local fallback
# file when it is fresher than 6h, and falls back to it on a 429 too — see
# its header for why: this job hit Doppler's shared 240-req/60s rate limit
# three times on 2026-09-04 and reported status error each time even though
# the secrets it needed hadn't changed in hours.
run_exit=0
sentinel_doppler_run "agent-secrets" "dev" -- node "$SCRIPT_DIR/run-health.mjs" || run_exit=$?

artifact_after="$(artifact_identity)"
if [ "$run_exit" -ne 0 ] && [ "$artifact_after" = "$artifact_before" ]; then
  case "${SENTINEL_DOPPLER_RUN_STATUS:-}" in
    rate_limited_no_fallback) failure_reason="secret_rate_limited"; failure_exit="$SECRET_RATE_LIMITED_EXIT" ;;
    live_failed) failure_reason="secret_provider_failed"; failure_exit="$SECRET_PROVIDER_FAILED_EXIT" ;;
    *) failure_reason="health_runner_failed"; failure_exit="$HEALTH_RUNNER_FAILED_EXIT" ;;
  esac
  echo "error-stream-health: status=error reason=$failure_reason upstream_status=null upstream_latency_ms=null attempts=0 consecutive_failures=unknown action=defer" >&2
  exit "$failure_exit"
fi

watcher_result="$(node "$SCRIPT_DIR/watcher.mjs" "$ARTIFACT" 2>/dev/null)" || {
  echo "error-stream-health: watcher could not read its artifact" >&2
  exit "$ARTIFACT_UNREADABLE_EXIT"
}

IFS=$'\t' read -r checkin_status reason_code watcher_action watcher_exit artifact_status \
  failure_reason upstream_status upstream_latency attempts consecutive_failures <<< "$watcher_result"

if [ "$artifact_status" = "error" ]; then
  echo "error-stream-health: status=$artifact_status reason=$failure_reason upstream_status=$upstream_status upstream_latency_ms=$upstream_latency attempts=$attempts consecutive_failures=$consecutive_failures action=$watcher_action" >&2
fi

exit "$watcher_exit"
