#!/usr/bin/env bash
# Sourceable sentinel-v5 check-in helpers for streetlight's bash job wrappers
# (ported from caller-track's scripts/sentinel-v5/checkin-lib.sh, same
# sourceable-function pattern).
#
# Usage, at the very top of a wrapper (both `at` and `slot` MUST be captured
# TOGETHER, before the job body runs — spec v5.9 §3.2, r3 #25; and NEVER
# recomputed at completion — see checkin.mjs's header for why a
# completion-time `at` breaks slot-claim validation on long jobs):
#
#   source "$(dirname "${BASH_SOURCE[0]}")/../sentinel-v5/checkin-lib.sh"
#   sentinel_capture_invocation sl-ui-sentry   # sets SENTINEL_AT, SENTINEL_SLOT
#   ... job body ...
#   if [ "$rc" = "0" ]; then
#     sentinel_checkin sl-ui-sentry green ok "$SENTINEL_AT" "$SENTINEL_SLOT"
#   else
#     sentinel_checkin sl-ui-sentry red job_failed "$SENTINEL_AT" "$SENTINEL_SLOT"
#   fi
#
# Both functions never fail the CALLER: a producer-side error (spool
# unwritable, unknown item, jq/node missing, etc.) never propagates a
# nonzero return — under `set -e`/`set -uo pipefail` (active in this repo's
# wrappers), a real failure inside these functions must never abort the REAL
# job they are trying to observe.
#
# Both functions append the producer's stderr to a local fallback log
# instead of discarding it (mirroring caller-track's self-heal-fallback.log
# pattern), so a genuine producer-side failure (unwritable spool, node
# crash, etc. — not a validation rejection, which spool-producer.mjs already
# handles in-band, e.g. oversize replacement) still leaves a trace somewhere
# a human or a future health check can notice.
SENTINEL_FALLBACK_LOG="${SENTINEL_FALLBACK_LOG:-${STREETLIGHT_SENTINEL_FALLBACK_LOG:-$HOME/.streetlight/ui-sentry/sentinel-v5-fallback.log}}"

SENTINEL_CHECKIN_MJS="${SENTINEL_CHECKIN_MJS:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/checkin.mjs}"

sentinel_log_fallback_failure() {
  local context="$1" detail="$2"
  mkdir -p "$(dirname "$SENTINEL_FALLBACK_LOG")" 2>/dev/null || true
  printf '[%s] %s: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$context" "$detail" >> "$SENTINEL_FALLBACK_LOG" 2>/dev/null || true
}

# sentinel_capture_invocation <item> — sets SENTINEL_AT and SENTINEL_SLOT as a
# side effect (bash has no clean multi-value return). On any failure (node
# missing, item not in the registry fragment, jq missing), falls back to
# plain wall-clock "now" for both — an unresolvable slot will likely record
# red(slot_mismatch) consumer-side rather than the job's real status, which
# is far better than crashing the job this is only trying to observe.
sentinel_capture_invocation() {
  local item="$1"
  local json err errfile
  # mktemp, not a predictable shared /tmp filename: a fixed name under /tmp
  # is guessable and symlink-attackable even when pid-scoped. No
  # predictable-name fallback either — if mktemp itself fails, stderr just
  # isn't captured for this call (json capture below still proceeds without
  # a diagnostic detail), rather than falling back to the exact predictable
  # path this exists to avoid.
  errfile="$(mktemp 2>/dev/null || true)"
  if [ -n "$errfile" ]; then
    json="$(node "$SENTINEL_CHECKIN_MJS" --capture-invocation --item "$item" 2>"$errfile")" || {
      err="$(cat "$errfile" 2>/dev/null || true)"
      sentinel_log_fallback_failure "capture-invocation:$item" "${err:-unknown error}"
      json=""
    }
    rm -f "$errfile" 2>/dev/null || true
  else
    json="$(node "$SENTINEL_CHECKIN_MJS" --capture-invocation --item "$item" 2>/dev/null)" || {
      sentinel_log_fallback_failure "capture-invocation:$item" "failed (mktemp unavailable, no stderr detail captured)"
      json=""
    }
  fi
  SENTINEL_AT=""
  SENTINEL_SLOT=""
  if [ -n "$json" ] && command -v jq >/dev/null 2>&1; then
    SENTINEL_AT="$(printf '%s' "$json" | jq -r '.at // empty' 2>/dev/null || true)"
    SENTINEL_SLOT="$(printf '%s' "$json" | jq -r '.slot // empty' 2>/dev/null || true)"
  fi
  if [ -z "$SENTINEL_AT" ] || [ -z "$SENTINEL_SLOT" ]; then
    if [ -n "$json" ]; then
      sentinel_log_fallback_failure "capture-invocation:$item" "jq missing or malformed output: $json"
    fi
    SENTINEL_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    SENTINEL_SLOT="$SENTINEL_AT"
  fi
  return 0
}

# sentinel_checkin <item> <green|red|yellow> <reason_code> <at> <slot>
#
# Note: the second local is named `check_status`, not `status` — zsh treats
# `status` as a read-only special parameter (a synonym for `$?`), so
# assigning a local named `status` fails hard if this file is ever sourced
# under zsh (e.g. interactively) rather than through one of this repo's own
# `#!/usr/bin/env bash` wrappers.
sentinel_checkin() {
  local item="$1" check_status="$2" reason_code="$3" at="$4" slot="$5"
  local err
  if ! err="$(node "$SENTINEL_CHECKIN_MJS" \
    --item "$item" \
    --status "$check_status" \
    --reason-code "$reason_code" \
    --at "$at" \
    --slot "$slot" \
    2>&1 >/dev/null)"; then
    sentinel_log_fallback_failure "checkin:$item:$check_status" "${err:-unknown error}"
  fi
  return 0
}
