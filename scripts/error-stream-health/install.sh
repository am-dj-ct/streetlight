#!/usr/bin/env bash
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLIST_DEST="$HOME/Library/LaunchAgents/com.streetlight.error-stream-health.plist"
SENTINEL_REGISTRY="${SENTINEL_V5_REGISTRY_PATH:-$HOME/blt-hub/config/sentinel-v5-registry.json}"

if ! command -v jq >/dev/null 2>&1 || \
  ! jq -e '.items[] | select(.id == "sl-error-stream-health" and .enabled == true and .shadow == false)' \
    "$SENTINEL_REGISTRY" >/dev/null 2>&1; then
  echo "Refusing to install: sl-error-stream-health is not admitted in the authoritative Sentinel registry." >&2
  exit 2
fi

mkdir -p "$HOME/Library/LaunchAgents" "$HOME/.streetlight/error-stream-health" "$HOME/.blt-hub/source-health"
cp "$SCRIPT_DIR/com.streetlight.error-stream-health.plist" "$PLIST_DEST"

cat <<'EOF'
Installed the plist but did not load it. After merge, from the main checkout:

  launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.streetlight.error-stream-health.plist
  launchctl kickstart -k gui/$(id -u)/com.streetlight.error-stream-health

Verify a fresh count-only artifact at:
  ~/.blt-hub/source-health/streetlight-error-stream-health.json
and a sl-error-stream-health check-in for the same five-minute slot.
EOF
