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

# sentinel_doppler_run <project> <config> -- <command...>
#
# Doppler-wrapped command runner for streetlight's sentinel-v5 jobs, added
# 2026-09-04 after com.streetlight.error-stream-health went red three times
# in one day (10:05, 10:34, 13:47) with "Doppler Error: Exceeded rate limit
# of 240 requests within 60 seconds" — every scheduled job on this Mac calls
# `doppler run` on start, and a fan-out of many jobs/lanes trips the shared
# per-minute cap. A 429 says the shared limit is busy, not that this job's
# secrets or health check are broken, so it must not turn into a red
# job_failed check-in on its own.
#
# Behavior:
#   - Each project/config gets its own local Doppler fallback file under
#     $SENTINEL_DOPPLER_FALLBACK_DIR (default: ~/.streetlight/doppler-fallback),
#     named "<project>-<config>.fallback". Doppler itself encrypts/decrypts
#     this file; this function never reads or logs its contents.
#   - If that file exists and was written within the last
#     SENTINEL_DOPPLER_FALLBACK_TTL_SECONDS (default 21600 = 6h), the command
#     runs straight off the cache via `doppler run --fallback-only`: zero
#     network calls, so zero rate-limit exposure.
#   - Otherwise this makes one live `doppler run --fallback <path> -- ...`
#     call, which both runs the command and refreshes the fallback file on
#     success.
#   - If that live call fails specifically because Doppler is rate-limited
#     (429 / "exceeded rate limit" in its stderr) AND a fallback file of ANY
#     age already exists, this retries once via `--fallback-only` off that
#     file instead of surfacing the 429 as a failure. Only a rate limit with
#     NO usable fallback at all is a real failure — there is no way to reach
#     secrets at all in that case, so callers should still treat it as red.
#   - Any other failure (bad token, missing project, network down, etc.) is
#     never masked — it propagates with doppler's real exit code and stderr,
#     the same as a bare `doppler run` would.
#
# Sets SENTINEL_DOPPLER_RUN_STATUS to one of: cache_fresh, live_ok,
# rate_limited_used_fallback, rate_limited_no_fallback, live_failed — for a
# caller that wants to log which path was taken. This function itself never
# aborts the caller (same contract as the two above): callers read its
# return code, exactly like a bare `doppler run`.
SENTINEL_DOPPLER_FALLBACK_DIR="${SENTINEL_DOPPLER_FALLBACK_DIR:-$HOME/.streetlight/doppler-fallback}"
SENTINEL_DOPPLER_FALLBACK_TTL_SECONDS="${SENTINEL_DOPPLER_FALLBACK_TTL_SECONDS:-21600}"
SENTINEL_DOPPLER_BIN="${SENTINEL_DOPPLER_BIN:-doppler}"
SENTINEL_DOPPLER_RUN_STATUS=""

# sentinel_doppler_fallback_age_seconds <file> — prints the file's age in
# seconds, or -1 if it does not exist / its mtime cannot be read. BSD stat
# (-f %m, this Mac) first, GNU stat (-c %Y, Linux CI) as a fallback — see
# blt-hub's deploy/lib/doppler-cached-run.sh for why the order matters: the
# reverse order silently misparses on the other platform instead of erroring.
sentinel_doppler_fallback_age_seconds() {
  local file="$1" mtime
  if [ -f "$file" ]; then
    mtime="$(stat -f %m "$file" 2>/dev/null || stat -c %Y "$file" 2>/dev/null || true)"
    if [ -n "$mtime" ]; then
      echo $(( $(date -u +%s) - mtime ))
      return 0
    fi
  fi
  echo -1
}

sentinel_doppler_run() {
  local project="$1" config="$2"
  shift 2 2>/dev/null || true
  if [ "${1:-}" = "--" ]; then shift; fi

  mkdir -p "$SENTINEL_DOPPLER_FALLBACK_DIR" 2>/dev/null || true
  local fallback_file="$SENTINEL_DOPPLER_FALLBACK_DIR/${project}-${config}.fallback"
  local age rc errfile err
  age="$(sentinel_doppler_fallback_age_seconds "$fallback_file")"

  if [ "$age" -ge 0 ] && [ "$age" -lt "$SENTINEL_DOPPLER_FALLBACK_TTL_SECONDS" ]; then
    SENTINEL_DOPPLER_RUN_STATUS="cache_fresh"
    "$SENTINEL_DOPPLER_BIN" run --fallback-only --fallback "$fallback_file" \
      --project "$project" --config "$config" -- "$@"
    return $?
  fi

  # Cache missing or stale: one live call, isolated stderr so a rate-limit
  # message can be told apart from the wrapped command's own output.
  errfile="$(mktemp 2>/dev/null || true)"
  if [ -n "$errfile" ]; then
    "$SENTINEL_DOPPLER_BIN" run --fallback "$fallback_file" \
      --project "$project" --config "$config" -- "$@" 2>"$errfile"
    rc=$?
    err="$(cat "$errfile" 2>/dev/null || true)"
    rm -f "$errfile" 2>/dev/null || true
  else
    "$SENTINEL_DOPPLER_BIN" run --fallback "$fallback_file" \
      --project "$project" --config "$config" -- "$@"
    rc=$?
    err=""
  fi

  if [ "$rc" -eq 0 ]; then
    SENTINEL_DOPPLER_RUN_STATUS="live_ok"
    [ -n "$err" ] && printf '%s\n' "$err" >&2
    return 0
  fi

  if printf '%s' "$err" | grep -qiE '429|exceeded rate limit|rate.?limit'; then
    local fallback_age
    fallback_age="$(sentinel_doppler_fallback_age_seconds "$fallback_file")"
    if [ "$fallback_age" -ge 0 ]; then
      SENTINEL_DOPPLER_RUN_STATUS="rate_limited_used_fallback"
      sentinel_log_fallback_failure "doppler_rate_limited:$project:$config" \
        "fallback_age_seconds=$fallback_age"
      "$SENTINEL_DOPPLER_BIN" run --fallback-only --fallback "$fallback_file" \
        --project "$project" --config "$config" -- "$@"
      return $?
    fi
    SENTINEL_DOPPLER_RUN_STATUS="rate_limited_no_fallback"
    [ -n "$err" ] && printf '%s\n' "$err" >&2
    return "$rc"
  fi

  SENTINEL_DOPPLER_RUN_STATUS="live_failed"
  [ -n "$err" ] && printf '%s\n' "$err" >&2
  return "$rc"
}
