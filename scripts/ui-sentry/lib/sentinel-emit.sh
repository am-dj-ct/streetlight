#!/usr/bin/env bash
# Sourceable sentinel-v5 emission helpers for run-ui-sentry.sh. Split out of
# the wrapper itself (2026-09-26, cross-vendor review) so they can be
# sourced and exercised in isolation by a test — run-ui-sentry.sh's own
# top-level code re-execs under caffeinate, parses argv, and touches the
# state-root/lock/PATH-preflight machinery the moment it loads, none of
# which a unit test for these two functions should have to survive.
#
# Depends on sentinel_checkin (scripts/sentinel-v5/checkin-lib.sh, sourced
# by the caller first) and these caller-set variables, exactly as
# run-ui-sentry.sh itself sets them before calling either function:
#   STATE_ROOT              - state root holding last-run.json
#   UI_SENTRY_SENTINEL_AT   - this invocation's captured `at`
#   UI_SENTRY_SENTINEL_SLOT - this invocation's captured `slot`

# sentinel_emit_item_a <exit_code> — "the sentry ran": green/red from the
# job's own exit code (spec v5.9 fragment item A), PLUS Jesse's ruling
# 2026-09-25 ("degraded is red"): a DEGRADED (or worse) run's own verdict
# must reach him as a red email, not just an outright crash. orchestrator.mjs
# deliberately keeps exit code 0 for "degraded-not-fail" (see its finalize()
# comment on exit codes) — DEGRADED is a real, designed status, not a bug —
# so a DEGRADED run used to look identical to a clean PASS to every consumer
# of this exit code, INCLUDING the sentinel check-in that is the only wired
# path to a red email since #43.
#
# Fails CLOSED, not open (cross-vendor review, 2026-09-26): the first cut of
# this fix read last-run.json's overallLevel and defaulted to green whenever
# that read didn't come back exactly "DEGRADED" or "FAIL" — which is also
# what happens when jq is missing, the file is unreadable or malformed, the
# field is absent (a schema drift), or the file is simply left over from a
# PREVIOUS invocation on some code path that reaches here without the
# orchestrator ever having run this time. Every one of those is "we don't
# actually know," and "we don't know" must never read as a silent green.
#
# A SECOND review round (same day) found the first cut of THIS fix was
# itself still fail-open in two ways, both reproduced directly:
#   - `jq -r '...' file 2>/dev/null || true` discards jq's own exit status.
#     jq parses a JSON document stream by default: a valid object followed
#     by trailing garbage (a truncated/corrupted write, two documents
#     concatenated) prints the valid document's fields to stdout and THEN
#     exits nonzero on the garbage — reproduced with
#     `{"overallLevel":"PASS",...}\nGARBAGE` printing "PASS" while exiting
#     5. Swallowing that exit code treated the garbage-contaminated file as
#     a clean read.
#   - The `startedAt` check only enforced a LOWER bound (not older than this
#     invocation) with no UPPER bound, so a corrupted or wildly future-dated
#     timestamp (reproduced with a year-2099 `startedAt`) passed it too.
#
# A THIRD review round (same day) found the second cut still had a gap: a
# file containing MULTIPLE valid JSON values — not a parse error at all, so
# the exit-status check above did not catch it — still read green.
# Reproduced with a fresh PASS document (a real, correctly RFC-formatted
# timestamp) immediately followed by a second, empty `{}` value. Without
# `-s`/slurp, jq processes each value in the stream separately and prints
# one line per value; the FIRST (valid) line's fields still ended up
# picked apart correctly by the shell parameter expansions below, with no
# signal at all that a second, malformed value was sitting right after it
# in the same file. Fixed two ways:
#   - `jq -s` (slurp) reads the WHOLE file as one array of however many
#     top-level JSON values it actually contains; `length != 1` rejects
#     anything but exactly one, closing this specific gap outright rather
#     than hoping a downstream check happens to catch whatever the extra
#     value contains.
#   - Every field read is type-checked (`type == "string"`) before it is
#     trusted at all, not just null-checked — a non-string value passing a
#     bare `// ""` fallback is the same class of gap as the multi-value one,
#     just for a single field instead of the whole document.
#   - orchestrator.mjs (the sole producer of a real last-run.json) now
#     stamps an `invocationId` into the state it writes, copied straight
#     from the UI_SENTRY_INVOCATION_ID env var run-ui-sentry.sh exports —
#     the exact same value as this invocation's own UI_SENTRY_SENTINEL_AT.
#     Requiring an EXACT match, not just "not older than," is a strictly
#     stronger claim than any timestamp-window check can make: a match
#     PROVES this file was written by THIS invocation's own orchestrator
#     run, not merely "some run that started after some instant," which
#     stays true no matter how tight or loose the window is.
#
# Five things all have to hold before a level is trusted:
#   1. jq parses the file as EXACTLY one JSON value — checked via jq's own
#      exit status AND an explicit slurped-length check, not the mere
#      presence of stdout output.
#   2. `overallLevel`, `startedAt`, and `invocationId` are all present with
#      the JSON type "string" — anything else, including null, a number, or
#      absent, is unverifiable.
#   3. `overallLevel` is exactly one of the three real values this schema
#      ever writes (PASS/DEGRADED/FAIL) — anything else is unverifiable.
#   4. `invocationId` matches THIS invocation's own UI_SENTRY_SENTINEL_AT
#      exactly.
#   5. `startedAt` is bounded on both sides: not older than THIS
#      invocation's own UI_SENTRY_SENTINEL_AT (orchestrator.mjs always
#      stamps `startedAt` before doing anything else, and this wrapper
#      always captures UI_SENTRY_SENTINEL_AT before the doppler-wrapped
#      orchestrator call even starts, so a genuine run can only produce a
#      `startedAt` at or after that instant), and not more than a small
#      skew (5 minutes — the same tolerance item B already uses below, for
#      the same clock-skew reason) ahead of the REAL current time read at
#      THIS check, catching a corrupted/future-dated value the lower bound
#      alone cannot. Kept alongside check 4, not replaced by it: two
#      independent checks that both have to hold is strictly safer than
#      either alone.
# All numeric epoch comparisons (via `node -e`), never string comparison:
# last-run.json's ISO timestamps carry milliseconds and
# UI_SENTRY_SENTINEL_AT's wall-clock fallback does not, and mixed precision
# ISO strings do not sort correctly as plain text (the `.` before
# milliseconds sorts before `Z`, so a millisecond-precision timestamp can
# look "earlier" than a same-instant second-precision one under a naive
# string compare).
#
# Anything that fails any of the four reports red with reason_code
# "state_unverifiable" — a distinct reason from both job_failed and
# degraded, so the mail body and any future dashboard can tell "the run
# itself failed," "the run finished but reported badly," and "we can't even
# tell what happened" apart.
#
# Producer failures are already swallowed inside sentinel_checkin (log and
# return 0); this never affects this wrapper's own exit code.
SENTINEL_STATE_FUTURE_TOLERANCE_MS=300000 # 5 minutes — same as item B's
sentinel_emit_item_a() {
  local exit_code="$1"
  if [ "$exit_code" != "0" ]; then
    sentinel_checkin sl-ui-sentry red job_failed "$UI_SENTRY_SENTINEL_AT" "$UI_SENTRY_SENTINEL_SLOT" || true
    return 0
  fi

  local state_file="${STATE_ROOT}/last-run.json"
  local run_level="" run_started_at="" run_invocation_id="" tsv jq_rc

  if [ -f "$state_file" ] && command -v jq >/dev/null 2>&1; then
    # ONE jq invocation for all three fields — a single atomic read of the
    # file, and a single exit-code check, rather than separate calls that
    # could in principle disagree if the file changed between them. `-s`
    # (slurp) plus the explicit `length != 1` is what catches a file
    # holding more than one JSON value (see the header above) — a plain
    # exit-status check alone does not, since multiple valid values are not
    # a parse error. `error(...)` makes jq exit nonzero with a message on
    # its own stderr (discarded here) for either failure shape.
    tsv="$(jq -re '
        if length != 1 then error("expected exactly one JSON value")
        else .[0]
          | if (.overallLevel | type) != "string"
              or (.startedAt | type) != "string"
              or (.invocationId | type) != "string"
            then error("field type invalid")
            else [.overallLevel, .startedAt, .invocationId] | @tsv
            end
        end
      ' -s "$state_file" 2>/dev/null)"
    jq_rc=$?
    if [ "$jq_rc" -eq 0 ] && [ -n "$tsv" ]; then
      run_level="${tsv%%$'\t'*}"
      local rest="${tsv#*$'\t'}"
      run_started_at="${rest%%$'\t'*}"
      run_invocation_id="${rest#*$'\t'}"
    fi
  fi

  case "$run_level" in
    PASS | DEGRADED | FAIL) : ;;
    *) run_level="" ;;
  esac

  local state_is_current=1
  if [ -z "$run_started_at" ] || [ -z "$run_invocation_id" ] \
    || [ -z "$UI_SENTRY_SENTINEL_AT" ] || [ "$run_invocation_id" != "$UI_SENTRY_SENTINEL_AT" ]; then
    state_is_current=0
  elif ! node -e '
      const startedAt = Date.parse(process.argv[1]);
      const invocationAt = Date.parse(process.argv[2]);
      const toleranceMs = Number(process.argv[3]);
      if (!Number.isFinite(startedAt) || !Number.isFinite(invocationAt)) process.exit(1);
      const notBeforeInvocation = startedAt >= invocationAt;
      // Upper bound against the REAL current time, not the captured
      // invocation instant — orchestrator work happens strictly after
      // invocation, so startedAt is expected to be a little later than
      // UI_SENTRY_SENTINEL_AT already; what this guards against is a
      // corrupted or wildly future-dated value (reproduced with a
      // year-2099 startedAt), which the lower-bound check alone cannot
      // catch since 2099 >= today satisfies it trivially.
      const notTooFarInFuture = startedAt <= Date.now() + toleranceMs;
      process.exit(notBeforeInvocation && notTooFarInFuture ? 0 : 1);
    ' "$run_started_at" "$UI_SENTRY_SENTINEL_AT" "$SENTINEL_STATE_FUTURE_TOLERANCE_MS" 2>/dev/null; then
    state_is_current=0
  fi

  if [ -z "$run_level" ] || [ "$state_is_current" != "1" ]; then
    sentinel_checkin sl-ui-sentry red state_unverifiable "$UI_SENTRY_SENTINEL_AT" "$UI_SENTRY_SENTINEL_SLOT" || true
  elif [ "$run_level" = "DEGRADED" ] || [ "$run_level" = "FAIL" ]; then
    sentinel_checkin sl-ui-sentry red degraded "$UI_SENTRY_SENTINEL_AT" "$UI_SENTRY_SENTINEL_SLOT" || true
  else
    sentinel_checkin sl-ui-sentry green ok "$UI_SENTRY_SENTINEL_AT" "$UI_SENTRY_SENTINEL_SLOT" || true
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
# Tolerance for the future-dated guard below, in ms. NOT related to job
# runtime — see the comment at its use for why this exists at all.
SENTINEL_LIVE_CHAT_FUTURE_TOLERANCE_MS=300000 # 5 minutes
sentinel_emit_item_b() {
  local state_file="${STATE_ROOT}/last-run.json"
  local status reason
  # UI_SENTRY_LAST_SUCCESS_AT is deliberately NOT `local`: the PATH-missing
  # fallback path in run-ui-sentry.sh (which calls this function before
  # overwriting last-run.json) reuses this exact value so the fallback
  # write can carry a real prior success forward instead of clobbering it
  # with null.
  UI_SENTRY_LAST_SUCCESS_AT=""
  if [ -f "$state_file" ] && command -v jq >/dev/null 2>&1; then
    # Same jq-exit-status discipline as sentinel_emit_item_a above: a
    # valid document followed by trailing garbage still prints usable text
    # before jq itself exits nonzero, so the exit code — not just stdout
    # being non-empty — decides whether this value is trusted.
    local jq_out jq_rc
    jq_out="$(jq -re '.lastSuccessfulLiveChatAt // empty' "$state_file" 2>/dev/null)"
    jq_rc=$?
    [ "$jq_rc" -eq 0 ] && UI_SENTRY_LAST_SUCCESS_AT="$jq_out"
  fi
  if [ -z "$UI_SENTRY_LAST_SUCCESS_AT" ]; then
    status="red"
    reason="degraded"
  elif node -e '
      const last = new Date(process.argv[1]).getTime();
      const thresholdMs = Number(process.argv[2]) * 86400000;
      const toleranceMs = Number(process.argv[3]);
      if (!Number.isFinite(last)) process.exit(1);
      // Freshness is judged against the REAL current time, not against
      // $UI_SENTRY_SENTINEL_AT — that is the invocation-time timestamp,
      // captured before the job body ran, and it MUST stay that way (it is
      // also what gets reported as this check-ins `at`/`slot`, per spec
      // v5.9 s3.2 — see sentinel_capture_invocations header). Using it as
      // "now" here made ageMs negative for every genuinely fresh success,
      // because last-run.jsons lastSuccessfulLiveChatAt is written minutes
      // AFTER invocation once the orchestrator actually runs — so a
      // successful run always computed a negative age and, combined with
      // the future-dated guard below, always reported red. That was the
      // bug: real freshness, not the guard, needed fixing.
      const now = Date.now();
      const ageMs = now - last;
      // Still reject a genuinely future-dated timestamp as garbage (a
      // future-dated last-run.json is corruption, not freshness), but allow
      // a small explicit tolerance rather than requiring ageMs >= 0
      // outright: a success recorded during this run is legitimately later
      // than the runs own invocation instant, and last-run.json is written
      // moments before this check runs against the real "now" above, so a
      // little clock skew between that write and this read should not flip
      // a real success to red. toleranceMs bounds how far into the future
      // we will still call "fresh enough" — comfortably above any realistic
      // clock skew, nowhere near the 10-day threshold.
      process.exit((ageMs >= -toleranceMs && ageMs <= thresholdMs) ? 0 : 1);
    ' "$UI_SENTRY_LAST_SUCCESS_AT" "$SENTINEL_LIVE_CHAT_THRESHOLD_DAYS" "$SENTINEL_LIVE_CHAT_FUTURE_TOLERANCE_MS" 2>/dev/null; then
    status="green"
    reason="ok"
  else
    status="red"
    reason="degraded"
  fi
  sentinel_checkin sl-ui-sentry-live-chat "$status" "$reason" "$UI_SENTRY_SENTINEL_AT" "$UI_SENTRY_SENTINEL_SLOT" || true
}
