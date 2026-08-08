#!/usr/bin/env bash
# Setup-time only: installs dependencies and the pinned browsers (R11 —
# never at scheduled-run time), copies the launchd plist into place, and
# prints (never runs) the commands to load it. Loading the job is post-merge
# commissioning (see the PR body's commissioning checklist) — this script
# never calls launchctl.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "==> npm ci (scripts/ui-sentry — standalone package, not part of the app build)"
npm ci

echo "==> Installing pinned bundled browsers (chromium, webkit)"
# Isolated into this package's own node_modules (PLAYWRIGHT_BROWSERS_PATH=0)
# rather than the shared ~/Library/Caches/ms-playwright — keeps this
# scheduled job's browser binaries independent of whatever else on the
# machine happens to be installing/using Playwright at the same time.
PLAYWRIGHT_BROWSERS_PATH=0 npx playwright install chromium webkit

PLIST_SRC="$SCRIPT_DIR/com.streetlight.ui-sentry.plist"
PLIST_DEST="$HOME/Library/LaunchAgents/com.streetlight.ui-sentry.plist"

echo "==> Copying plist to $PLIST_DEST"
mkdir -p "$HOME/Library/LaunchAgents"
cp "$PLIST_SRC" "$PLIST_DEST"

cat <<'EOF'

Setup done. This script does NOT load the launchd job — that is post-merge
commissioning, done once from the main checkout (see the PR's commissioning
checklist). When ready:

  launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.streetlight.ui-sentry.plist
  launchctl kickstart -k gui/$(id -u)/com.streetlight.ui-sentry

Then verify:
  - Fresh state: cat ~/.streetlight/ui-sentry/last-run.json
  - Fresh log:   ls -t ~/.streetlight/ui-sentry/logs | head -1
  - Email delivered to the inbox in RESOURCE_REVIEW_EMAIL_TO (or the
    orchestrator's default) within a few minutes.
  - Repeat once with the screen locked (screen lock is fine; logging out
    of the GUI session kills GUI launchd agents, so stay logged in).
EOF
