#!/usr/bin/env bash
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE_ROOT="${STREETLIGHT_ERROR_STREAM_HEALTH_STATE_ROOT:-$HOME/.streetlight/error-stream-health}"
ARTIFACT="${STREETLIGHT_ERROR_STREAM_HEALTH_ARTIFACT:-$HOME/.blt-hub/source-health/streetlight-error-stream-health.json}"
ITEM="sl-error-stream-health"

mkdir -p "$STATE_ROOT"
STREETLIGHT_SENTINEL_FALLBACK_LOG="$STATE_ROOT/sentinel-v5-fallback.log"
export STREETLIGHT_SENTINEL_FALLBACK_LOG STREETLIGHT_ERROR_STREAM_HEALTH_ARTIFACT="$ARTIFACT"

# shellcheck source=../sentinel-v5/checkin-lib.sh
. "$SCRIPT_DIR/../sentinel-v5/checkin-lib.sh"
sentinel_capture_invocation "$ITEM" || true
: "${SENTINEL_AT:=$(date -u +%Y-%m-%dT%H:%M:%SZ)}"
: "${SENTINEL_SLOT:=$SENTINEL_AT}"

if ! command -v doppler >/dev/null 2>&1 || ! command -v node >/dev/null 2>&1; then
  sentinel_checkin "$ITEM" red job_failed "$SENTINEL_AT" "$SENTINEL_SLOT" || true
  echo "error-stream-health: required runtime unavailable" >&2
  exit 1
fi

doppler run --project agent-secrets --config dev -- node "$SCRIPT_DIR/run-health.mjs"
health_exit=$?

case "$health_exit" in
  0) sentinel_checkin "$ITEM" green ok "$SENTINEL_AT" "$SENTINEL_SLOT" || true ;;
  2) sentinel_checkin "$ITEM" red degraded "$SENTINEL_AT" "$SENTINEL_SLOT" || true ;;
  *) sentinel_checkin "$ITEM" red job_failed "$SENTINEL_AT" "$SENTINEL_SLOT" || true ;;
esac

exit "$health_exit"

