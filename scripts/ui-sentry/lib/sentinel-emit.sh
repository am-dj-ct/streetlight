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
# Two independent checks both have to pass before a level is trusted:
#   1. `overallLevel` is present and is exactly one of the three real values
#      this schema ever writes (PASS/DEGRADED/FAIL) — anything else,
#      including empty, is unverifiable.
#   2. `startedAt` in the file is not older than THIS invocation's own
#      UI_SENTRY_SENTINEL_AT — orchestrator.mjs always stamps `startedAt`
#      before doing anything else, and this wrapper always captures
#      UI_SENTRY_SENTINEL_AT before the doppler-wrapped orchestrator call
#      even starts, so a genuine run of THIS invocation can only produce a
#      `startedAt` at or after that instant. An earlier `startedAt` means
#      the file predates this invocation — stale state, not a report on
#      what just happened. Numeric epoch comparison (via `node -e`), not
#      string comparison: last-run.json's ISO timestamps carry milliseconds
#      and UI_SENTRY_SENTINEL_AT's wall-clock fallback does not, and mixed
#      precision ISO strings do not sort correctly as plain text (the `.`
#      before milliseconds sorts before `Z`, so a millisecond-precision
#      timestamp can look "earlier" than a same-instant second-precision
#      one under a naive string compare).
# Anything that fails either check reports red with reason_code
# "state_unverifiable" — a distinct reason from both job_failed and
# degraded, so the mail body and any future dashboard can tell "the run
# itself failed," "the run finished but reported badly," and "we can't even
# tell what happened" apart.
#
# Producer failures are already swallowed inside sentinel_checkin (log and
# return 0); this never affects this wrapper's own exit code.
sentinel_emit_item_a() {
  local exit_code="$1"
  if [ "$exit_code" != "0" ]; then
    sentinel_checkin sl-ui-sentry red job_failed "$UI_SENTRY_SENTINEL_AT" "$UI_SENTRY_SENTINEL_SLOT" || true
    return 0
  fi

  local state_file="${STATE_ROOT}/last-run.json"
  local run_level="" run_started_at=""
  if [ -f "$state_file" ] && command -v jq >/dev/null 2>&1; then
    run_level="$(jq -r '.overallLevel // empty' "$state_file" 2>/dev/null || true)"
    run_started_at="$(jq -r '.startedAt // empty' "$state_file" 2>/dev/null || true)"
  fi

  case "$run_level" in
    PASS | DEGRADED | FAIL) : ;;
    *) run_level="" ;;
  esac

  local state_is_current=1
  if [ -z "$run_started_at" ]; then
    state_is_current=0
  elif ! node -e '
      const startedAt = Date.parse(process.argv[1]);
      const invocationAt = Date.parse(process.argv[2]);
      if (!Number.isFinite(startedAt) || !Number.isFinite(invocationAt)) process.exit(1);
      process.exit(startedAt >= invocationAt ? 0 : 1);
    ' "$run_started_at" "$UI_SENTRY_SENTINEL_AT" 2>/dev/null; then
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
    UI_SENTRY_LAST_SUCCESS_AT="$(jq -r '.lastSuccessfulLiveChatAt // empty' "$state_file" 2>/dev/null || true)"
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
