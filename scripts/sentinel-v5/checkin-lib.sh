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
# Direct email on red (2026-09-25). The Sentinel layer that used to read the
# spool was retired 2026-09-24, so a red check-in written only to the spool
# reaches nobody. Every red now also sends one plain email to jesse@ via
# Resend, at most once per item per 6 hours, using the same Doppler helper
# the jobs already use. Failures are logged to the fallback log and never
# change the caller's exit code.
SENTINEL_MAIL_RED_TO="${SENTINEL_MAIL_RED_TO:-jesse@balancedlivingtherapy.com}"
SENTINEL_MAIL_RED_FROM="${SENTINEL_MAIL_RED_FROM:-Streetlight <notifications@alerts.ctpipeline.com>}"
SENTINEL_MAIL_RED_STATE_DIR="${SENTINEL_MAIL_RED_STATE_DIR:-$HOME/.streetlight/mail-red}"
SENTINEL_MAIL_RED_COOLDOWN_SECONDS="${SENTINEL_MAIL_RED_COOLDOWN_SECONDS:-21600}"
SENTINEL_MAIL_RED_DISABLED="${SENTINEL_MAIL_RED_DISABLED:-}"
# Subject prefix hook, empty by default (no production behavior change) —
# lets a manual verification send mark itself "[TEST] " without touching the
# real subject text any other caller gets.
SENTINEL_MAIL_RED_SUBJECT_PREFIX="${SENTINEL_MAIL_RED_SUBJECT_PREFIX:-}"
# The OS advisory-lock helper #45 already ships for exactly this purpose
# (scripts/watch-usage-digest/mail-lock.py — fcntl.flock, bounded wait, no
# stale lock survives a crash). Reused rather than re-derived (cross-vendor
# review, 2026-09-26) — see sentinel_mail_red below for why a marker file
# alone isn't enough.
SENTINEL_MAIL_LOCK_PY="${SENTINEL_MAIL_LOCK_PY:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../watch-usage-digest/mail-lock.py}"
# This file's own absolute path, for the self-re-invocation the lock wraps
# (mail-lock.py execs a COMMAND under the lock; re-invoking this same file
# with a private flag is the same shape watch.mjs already uses for its own
# locked send step).
SENTINEL_CHECKIN_LIB_SELF="${SENTINEL_CHECKIN_LIB_SELF:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")}"
# Receipts (Jesse's order: "save the receipts"). One append-only, JSON-lines
# file, content-free by construction. Field names and shape deliberately
# match #45's shared receipt schema (scripts/send-resend-email.mjs /
# scripts/watch-usage-digest/watch.mjs) — timestamp, job, httpStatus (or
# null), resendId (or null; UUID-validated, never trusted as-is from the
# response body) — plus this path's own extra fixed `reason` field and an
# `outcome` field (confirmed/uncertain/rejected/pre_send_failure — see
# sentinel_mail_red_attempt) added in the 3rd cross-vendor review so the
# distinction that decides whether the cooldown started is actually visible
# in the record, not just inferred from httpStatus. No message body,
# header value, or secret, ever. Written for every real send ATTEMPT (not
# for a call skipped by the cooldown or by SENTINEL_MAIL_RED_DISABLED,
# neither of which sent anything).
SENTINEL_MAIL_RED_RECEIPTS_FILE="${SENTINEL_MAIL_RED_RECEIPTS_FILE:-$SENTINEL_MAIL_RED_STATE_DIR/receipts.log}"
sentinel_record_mail_receipt() {
  local item="$1" reason="$2" http_status="$3" resend_id="$4" outcome="$5"
  mkdir -p "$(dirname "$SENTINEL_MAIL_RED_RECEIPTS_FILE")" 2>/dev/null || true
  python3 - "$SENTINEL_MAIL_RED_RECEIPTS_FILE" "$item" "$reason" "$http_status" "$resend_id" "$outcome" <<'PY' 2>/dev/null || \
    sentinel_log_fallback_failure "mail-red-receipt:$item" "receipt write failed"
import datetime
import json
import sys

receipts_file, job, reason, http_status, resend_id, outcome = sys.argv[1:7]
record = {
    "timestamp": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "job": job,
    "reason": reason,
    "httpStatus": int(http_status) if http_status.isdigit() else None,
    # Already UUID-validated (lowercased) by the caller before this is
    # ever called — never re-derived from raw response text here.
    "resendId": resend_id or None,
    "outcome": outcome or None,
}
with open(receipts_file, "a") as fh:
    fh.write(json.dumps(record, sort_keys=True) + "\n")
PY
  return 0
}

# sentinel_mail_red_attempt — the actual reserve-then-send-then-record
# cycle for ONE item. Never called directly except (a) by sentinel_mail_red
# below, running it under mail-lock.py's OS lock, and (b) by this file's own
# direct-invocation entry point at the bottom, which is how mail-lock.py's
# `subprocess.call(command)` actually re-enters this cycle inside the lock
# it just acquired (see sentinel_mail_red's header for why a lock, not just
# the marker file, is needed at all).
#
# Simplified outcome model (3rd cross-vendor review, 2026-09-26 — the
# previous cross-invocation pending-key/bounded-retry design was itself
# where the new bugs kept coming from: a retry rebuilt the payload with a
# new timestamp under the SAME key, which gets a Resend conflict instead of
# a dedup, not a safety net; an unverifiable 2xx was being treated as a
# definite rejection even though delivery may already have happened; and
# the Doppler status read right after the send lived inside a
# `raw="$(...)"` command-substitution subshell, so the global variable
# assignment inside `sentinel_doppler_run` never actually reached this
# scope — every read of it here saw a stale, usually-empty value,
# regardless of what Doppler actually did). Coordinator decision, same day:
# stop building cross-invocation idempotent retry machinery; simplify to
# send at most once per invocation, plus a single immediate in-process
# retry of a genuine network error using the identical payload and key
# (built once, before the loop) — no pending key ever written to disk, no
# multi-attempt loop, no cross-invocation state at all. Every attempt ends
# in exactly one of —
#   - PRE_SEND_FAILURE: nothing could have reached Resend. Either Doppler
#     itself never handed back secrets (curl never ran — a rate-limit
#     refusal with no fallback available, or any other Doppler-layer
#     failure, identified by its own "Doppler Error" stderr marker, not
#     just SENTINEL_DOPPLER_RUN_STATUS's coarser "live_failed" bucket alone
#     — that bucket also covers the WRAPPED command's own nonzero exit,
#     since sentinel_doppler_run execs it directly, and treating live_failed
#     alone as proof curl never ran was tried and found wrong: an in-process
#     probe with curl itself exiting nonzero reported the exact same
#     live_failed status as a genuine Doppler auth failure), or curl itself
#     never reached Resend at all (exit 6 = couldn't resolve host, 7 =
#     failed to connect — a DNS failure or no connection made, not a
#     timeout after sending). Released immediately: no cooldown, distinct
#     receipt reason, no retry — retrying a Doppler-layer problem here is
#     pointless (sentinel_doppler_run already has its own backoff at a
#     higher level), and retrying a DNS/connect failure gains nothing a
#     single immediate retry of a genuine network error doesn't already
#     cover.
#   - REJECTED: curl completed and Resend gave a clean 4xx. Definite
#     refusal of this exact payload. Released: no cooldown.
#   - CONFIRMED: a clean 2xx AND a UUID-validated id. Cooldown starts.
#   - UNCERTAIN: everything else that isn't one of the three above — a 2xx
#     with no valid id, a 5xx, or any curl-level failure that isn't
#     provably a pre-send failure (a timeout or dropped connection AFTER
#     the request may have gone out, which curl's exit code alone cannot
#     distinguish from one before). Treated as POSSIBLY SENT: the cooldown
#     starts anyway. A rare missed duplicate-detection window is
#     acceptable; an actual duplicate email is not. A network-level
#     failure (curl rc != 0, not a definite pre-send failure) gets exactly
#     one immediate in-process retry with the SAME payload and key before
#     landing here; a real HTTP response (2xx-without-id or 5xx) does not
#     retry at all, since Resend already has the payload.
sentinel_mail_red_attempt() {
  local item="$1" reason="$2" at="$3" subject_prefix="${4:-}"

  local marker="$SENTINEL_MAIL_RED_STATE_DIR/$item.last-sent" now last
  now="$(date +%s)"
  last="$(cat "$marker" 2>/dev/null || echo 0)"
  case "$last" in *[!0-9]*|"") last=0 ;; esac
  if [ $((now - last)) -lt "$SENTINEL_MAIL_RED_COOLDOWN_SECONDS" ]; then
    return 0
  fi

  # Built once for this invocation only — never persisted to disk, never
  # reused by a later invocation. $$ added so two invocations landing in
  # the same wall-clock second still get different keys.
  local idempotency_key="${item}-${now}-$$"

  local payload
  payload="$(mktemp 2>/dev/null || true)"
  if [ -z "$payload" ]; then
    sentinel_log_fallback_failure "mail-red:$item" "mktemp unavailable"
    return 0
  fi
  if ! python3 - "$payload" "$item" "$reason" "$at" "$SENTINEL_MAIL_RED_TO" "$SENTINEL_MAIL_RED_FROM" "$subject_prefix" <<'PY' 2>/dev/null
import json, sys
payload, item, reason, at, to, sender, subject_prefix = sys.argv[1:8]
json.dump({
    "from": sender,
    "to": [to],
    "subject": f"{subject_prefix}Streetlight watcher RED: {item} ({reason})",
    "text": (
        f"Watcher {item} reported red at {at} (reason: {reason}).\n\n"
        "Logs: ~/.streetlight/  (error-stream-health/, ui-sentry/)\n"
        "Repo: ~/streetlight\n\n"
        "Sent at most once per item every 6 hours."
    ),
}, open(payload, "w"))
PY
  then
    rm -f "$payload" 2>/dev/null || true
    sentinel_log_fallback_failure "mail-red:$item" "payload build failed"
    return 0
  fi

  local outcome="" http_status="" resend_id="" last_diag=""
  local attempt=1

  while :; do
    # stdout/stderr go to real files, and sentinel_doppler_run is called
    # directly rather than inside `raw="$(...)"` — a command substitution
    # always forks a subshell in bash, and a subshell's variable changes
    # (including SENTINEL_DOPPLER_RUN_STATUS, set as a side effect inside
    # sentinel_doppler_run) never propagate back to the caller. Redirecting
    # to files instead keeps this whole call in the CURRENT shell, so the
    # status read right after actually reflects what just happened
    # (review #6 — the previous version's "capture immediately" comment
    # was capturing a value that had never actually changed here).
    local raw_file errfile rc doppler_status raw body resend_id_raw err
    raw_file="$(mktemp 2>/dev/null || true)"
    errfile="$(mktemp 2>/dev/null || true)"
    SENTINEL_MAIL_PAYLOAD="$payload" SENTINEL_MAIL_IDEMPOTENCY_KEY="$idempotency_key" sentinel_doppler_run "agent-secrets" "dev" -- sh -c \
        'curl -s --max-time 20 -w "\n%{http_code}" -X POST https://api.resend.com/emails -H "Authorization: Bearer $RESEND_API_KEY" -H "content-type: application/json" -H "Idempotency-Key: $SENTINEL_MAIL_IDEMPOTENCY_KEY" -d "@$SENTINEL_MAIL_PAYLOAD"' \
        >"${raw_file:-/dev/null}" 2>"${errfile:-/dev/null}"
    rc=$?
    doppler_status="$SENTINEL_DOPPLER_RUN_STATUS"

    raw=""
    [ -n "$raw_file" ] && raw="$(cat "$raw_file" 2>/dev/null || true)"
    [ -n "$raw_file" ] && rm -f "$raw_file" 2>/dev/null || true
    err=""
    [ -n "$errfile" ] && err="$(cat "$errfile" 2>/dev/null || true)"
    [ -n "$errfile" ] && rm -f "$errfile" 2>/dev/null || true

    http_status="${raw##*$'\n'}"
    body="${raw%$'\n'*}"
    case "$http_status" in *[!0-9]*|"") http_status="" ;; esac

    resend_id_raw=""
    if [ -n "$body" ]; then
      resend_id_raw="$(printf '%s' "$body" | python3 -c '
import json, sys
try:
    data = json.load(sys.stdin)
    value = data.get("id", "")
    print(value if isinstance(value, str) else "")
except Exception:
    print("")
' 2>/dev/null || true)"
    fi

    # UUID-validate before trusting it for anything: reuse #45's exact
    # rule (send-resend-email.mjs) instead of accepting whatever happens to
    # be in the response body's "id" field.
    resend_id=""
    if [ -n "$resend_id_raw" ]; then
      local resend_id_lower
      resend_id_lower="$(printf '%s' "$resend_id_raw" | tr 'A-Z' 'a-z')"
      if [[ "$resend_id_lower" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]]; then
        resend_id="$resend_id_lower"
      fi
    fi

    # rate_limited_no_fallback is a SOUND signal on its own: it is only
    # ever set when sentinel_doppler_run itself matched a doppler-specific
    # rate-limit message and had no fallback to retry from, so curl could
    # not have run. live_failed is NOT sound the same way — it is set for
    # ANY nonzero exit that isn't rate-limit-shaped, which includes the
    # WRAPPED command's OWN failure: sentinel_doppler_run execs curl
    # directly, so curl's own nonzero exit becomes sentinel_doppler_run's
    # exit code too, indistinguishable from a real Doppler-layer refusal
    # by exit code alone (found the hard way: an in-process probe with
    # curl exiting 28 reported doppler_status=live_failed, identical to a
    # genuine Doppler auth failure, and treating that live_failed value
    # alone as proof curl never ran was wrong — it silently ate the single
    # retry this exact case is supposed to get). Doppler's OWN CLI prefixes
    # its own errors with "Doppler Error" (confirmed against its real
    # output; the exact text quoted in this file's rate-limit header
    # comment), which curl's stderr never would — checking for that marker
    # specifically, not just the coarser live_failed bucket, is what
    # actually tells the two layers apart.
    case "$doppler_status" in
      rate_limited_no_fallback)
        outcome="pre_send_failure"
        last_diag="doppler_status=$doppler_status rc=$rc ${err:+stderr=$err}"
        break
        ;;
      live_failed)
        if printf '%s' "$err" | grep -qi '^Doppler Error'; then
          outcome="pre_send_failure"
          last_diag="doppler_status=$doppler_status rc=$rc ${err:+stderr=$err}"
          break
        fi
        # Not a Doppler-layer marker — fall through to the curl-rc checks
        # below, which is what actually decides this one.
        ;;
    esac

    if [ "$rc" -ne 0 ]; then
      case "$rc" in
        6 | 7)
          # Couldn't resolve host (6) / failed to connect (7): curl never
          # reached Resend at all — as definite as a Doppler refusal, not
          # an ambiguous "may have reached" case, so no retry either.
          outcome="pre_send_failure"
          last_diag="curl_rc=$rc (dns_or_connect_failure) ${err:+stderr=$err}"
          break
          ;;
      esac
      # Any other curl-level failure (timeout, connection reset, etc.) —
      # cannot tell whether the request reached Resend before it failed.
      outcome="uncertain"
      last_diag="curl_rc=$rc ${err:+stderr=$err}"
      if [ "$attempt" -eq 1 ]; then
        attempt=$((attempt + 1))
        continue
      fi
      break
    fi

    if [ -n "$http_status" ] && [ "$http_status" -ge 400 ] && [ "$http_status" -lt 500 ]; then
      outcome="rejected"
      last_diag="http_status=$http_status"
      break
    fi

    if [ -n "$http_status" ] && [ "$http_status" -ge 200 ] && [ "$http_status" -lt 300 ] && [ -n "$resend_id" ]; then
      outcome="confirmed"
      break
    fi

    # A 2xx with no valid id, a 5xx, or any other real HTTP response that
    # is not a clean 4xx: Resend may already have queued this. Treated as
    # sent — never retried.
    outcome="uncertain"
    last_diag="http_status=${http_status:-none} resend_id_valid=$([ -n "$resend_id" ] && echo yes || echo no)"
    break
  done

  case "$outcome" in
    confirmed | uncertain)
      printf '%s' "$now" > "$marker" 2>/dev/null || true
      ;;
    pre_send_failure | rejected)
      sentinel_log_fallback_failure "mail-red:$item" "$outcome: $last_diag"
      ;;
  esac

  sentinel_record_mail_receipt "$item" "$reason" "${http_status:-}" "$resend_id" "$outcome"

  rm -f "$payload" 2>/dev/null || true
  return 0
}

# sentinel_mail_red — public entry point. Runs sentinel_mail_red_attempt
# under a per-item OS advisory lock (review #3): the cooldown check and the
# reservation write above happen ONLY while holding this lock, so two
# concurrent callers for the SAME item (a scheduled fire racing a manual
# proof run, or two jobs that happen to share an item) can never both pass
# the cooldown check before either one has recorded a reservation — the
# second one blocks, then sees the first's fresh reservation and skips.
# The marker file alone (the previous version's only guard) cannot do this:
# two processes can both read it as stale in the same instant.
sentinel_mail_red() {
  local item="$1" reason="$2" at="$3"
  [ -n "$SENTINEL_MAIL_RED_DISABLED" ] && return 0
  mkdir -p "$SENTINEL_MAIL_RED_STATE_DIR" 2>/dev/null || true

  if ! command -v python3 >/dev/null 2>&1; then
    # Every step in this path (the lock, the payload builder, the receipt
    # writer, the id validator) already depends on python3 — missing it
    # means nothing here can run at all, lock or no lock.
    sentinel_log_fallback_failure "mail-red:$item" "python3 unavailable — cannot lock or send"
    return 0
  fi

  local lock_dir="$SENTINEL_MAIL_RED_STATE_DIR/locks/$item"
  mkdir -p "$lock_dir" 2>/dev/null || true

  python3 "$SENTINEL_MAIL_LOCK_PY" "$lock_dir" \
    bash "$SENTINEL_CHECKIN_LIB_SELF" --mail-red-attempt "$item" "$reason" "$at" "$SENTINEL_MAIL_RED_SUBJECT_PREFIX" \
    || sentinel_log_fallback_failure "mail-red:$item" "mail_lock_failed_or_timed_out"
  return 0
}
# sentinel_checkin no longer writes to the sentinel-v5 spool
# (~/.blt-sentinel/spool) — that consumer layer was retired 2026-09-24 and
# nothing reads it any more (standing rule: strip Sentinel check-in code
# when touching a job). What the red-email path actually needs from a
# check-in is kept: on red, send (or skip under cooldown) the direct email
# above. `slot` is accepted for call-site compatibility with existing
# callers (run-ui-sentry.sh, run-error-stream-health.sh) but is otherwise
# unused now that nothing validates a claimed cron slot against a registry.
sentinel_checkin() {
  local item="$1" check_status="$2" reason_code="$3" at="$4" slot="$5"
  if [ "$check_status" = "red" ]; then
    sentinel_mail_red "$item" "$reason_code" "$at" || true
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
#     file instead of surfacing the 429 as a failure. The timestamped local
#     ledger then keeps later scheduled runs on fallback-only for one hour,
#     so a five-minute job cannot add twelve more live calls to the same
#     vendor incident. Only a rate limit with
#     NO usable fallback at all is a real failure — there is no way to reach
#     secrets at all in that case, so callers should still treat it as red.
#   - Any other failure (bad token, missing project, network down, etc.) is
#     never masked — it propagates with doppler's real exit code and stderr,
#     the same as a bare `doppler run` would.
#
# Sets SENTINEL_DOPPLER_RUN_STATUS to one of: cache_fresh, live_ok,
# rate_limited_used_fallback, rate_limit_backoff_used_fallback,
# rate_limited_no_fallback, live_failed — for a
# caller that wants to log which path was taken. This function itself never
# aborts the caller (same contract as the two above): callers read its
# return code, exactly like a bare `doppler run`.
SENTINEL_DOPPLER_FALLBACK_DIR="${SENTINEL_DOPPLER_FALLBACK_DIR:-$HOME/.streetlight/doppler-fallback}"
SENTINEL_DOPPLER_FALLBACK_TTL_SECONDS="${SENTINEL_DOPPLER_FALLBACK_TTL_SECONDS:-21600}"
SENTINEL_DOPPLER_RATE_LIMIT_BACKOFF_SECONDS="${SENTINEL_DOPPLER_RATE_LIMIT_BACKOFF_SECONDS:-3600}"
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

# The existing timestamped fallback ledger is also the durable evidence of a
# Doppler 429. Reuse that evidence for a bounded retry delay instead of making
# another live request every five minutes while the shared vendor limit is
# still busy. This reads only the fixed prefix and timestamp we wrote; secret
# output is never parsed or echoed.
sentinel_doppler_rate_limit_age_seconds() {
  local project="$1" config="$2" line iso epoch now
  if [ ! -f "$SENTINEL_FALLBACK_LOG" ]; then echo -1; return 0; fi
  line="$(grep -E "^\[[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z\] doppler_rate_limited:${project}:${config}:" "$SENTINEL_FALLBACK_LOG" 2>/dev/null | tail -n 1 || true)"
  iso="${line#\[}"
  iso="${iso%%\]*}"
  [ -n "$line" ] && [ -n "$iso" ] || { echo -1; return 0; }
  epoch="$(date -u -j -f '%Y-%m-%dT%H:%M:%SZ' "$iso" +%s 2>/dev/null || date -u -d "$iso" +%s 2>/dev/null || true)"
  [ -n "$epoch" ] || { echo -1; return 0; }
  now="$(date -u +%s)"
  echo $(( now - epoch ))
}

sentinel_doppler_run() {
  local project="$1" config="$2"
  shift 2 2>/dev/null || true
  if [ "${1:-}" = "--" ]; then shift; fi

  mkdir -p "$SENTINEL_DOPPLER_FALLBACK_DIR" 2>/dev/null || true
  local fallback_file="$SENTINEL_DOPPLER_FALLBACK_DIR/${project}-${config}.fallback"
  local age rc errfile err rate_limit_age
  age="$(sentinel_doppler_fallback_age_seconds "$fallback_file")"

  if [ "$age" -ge 0 ] && [ "$age" -lt "$SENTINEL_DOPPLER_FALLBACK_TTL_SECONDS" ]; then
    SENTINEL_DOPPLER_RUN_STATUS="cache_fresh"
    "$SENTINEL_DOPPLER_BIN" run --fallback-only --fallback "$fallback_file" \
      --project "$project" --config "$config" -- "$@"
    return $?
  fi

  rate_limit_age="$(sentinel_doppler_rate_limit_age_seconds "$project" "$config")"
  if [ "$age" -ge 0 ] && [ "$rate_limit_age" -ge 0 ] \
    && [ "$rate_limit_age" -lt "$SENTINEL_DOPPLER_RATE_LIMIT_BACKOFF_SECONDS" ]; then
    SENTINEL_DOPPLER_RUN_STATUS="rate_limit_backoff_used_fallback"
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

# --- Direct-invocation entry point ----------------------------------------
# Never triggered by a normal `source checkin-lib.sh` (BASH_SOURCE[0] is
# this file's own path there, but $0 is whatever sourced it, or "bash" for
# a `bash -c 'source ...'` one-liner — they only match when this file is
# executed directly). sentinel_mail_red above uses exactly this to have
# mail-lock.py's `subprocess.call(command)` re-enter the reserve/send/record
# cycle from INSIDE the lock it just acquired, the same self-re-invocation
# shape scripts/watch-usage-digest/watch.mjs already uses for its own
# locked send step.
if [ "${BASH_SOURCE[0]}" = "$0" ] && [ "${1:-}" = "--mail-red-attempt" ]; then
  shift
  sentinel_mail_red_attempt "$@"
  exit $?
fi
