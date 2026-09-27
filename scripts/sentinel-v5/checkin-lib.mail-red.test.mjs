// Covers sentinel_checkin/sentinel_mail_red/sentinel_mail_red_attempt in
// checkin-lib.sh.
//
// What changed here and needs coverage:
//   1. The Resend response used to be discarded (`2>&1 >/dev/null` threw
//      the body away, keeping only stderr) — sentinel_mail_red now captures
//      the HTTP status and the Resend message id and writes a content-free
//      receipt line for every real send attempt (Jesse's order: "save the
//      receipts"), in the same field shape #45 already uses elsewhere
//      (timestamp/job/httpStatus/resendId, plus this path's own `reason`).
//   2. sentinel_checkin no longer writes anything to the sentinel-v5 spool
//      (~/.blt-sentinel/spool) — that consumer was retired 2026-09-24 and
//      nothing reads it. It still sends (or, under cooldown, skips) the
//      direct red email, which is the only thing anything downstream of
//      this function actually depends on.
//   3. Cross-vendor review, 2026-09-26: the cooldown used to be checked
//      without a lock and recorded only after success, so two concurrent
//      callers could both pass the check and both send, and a timeout
//      after Resend had already accepted the request could cause a resend
//      on the next check-in. Fixed with a per-item OS advisory lock
//      (#45's mail-lock.py, reused) around a reserve-before-send cycle,
//      plus a per-item Idempotency-Key header.
//   4. Same review: receipts used to accept any string as a Resend id, and
//      any 2xx started the cooldown even without one. Fixed with the same
//      UUID validation #45's send-resend-email.mjs already applies.
//   5. THIRD review, same day: the cross-invocation pending-key/bounded-
//      retry design from #4 was itself where the next round of bugs came
//      from — a retry could rebuild the payload with a new timestamp under
//      the SAME key (a Resend conflict, not a dedup), an unverifiable 2xx
//      was treated as a definite rejection even though delivery may
//      already have happened, and the Doppler status read after the send
//      lived inside a `raw="$(...)"` subshell and never actually reached
//      the caller. Coordinator decision: stop building cross-invocation
//      idempotent retry machinery. Simplified to sending at most once per
//      invocation, plus a single immediate in-process retry of a genuine
//      network error with the identical payload/key, and a four-outcome
//      model — confirmed / rejected (4xx) / pre_send_failure (release, no
//      cooldown) / uncertain (2xx-without-id, 5xx, or an unresolved
//      network error — treated as POSSIBLY sent, cooldown starts anyway;
//      a rare missed duplicate is acceptable, a real duplicate is not).
//      Receipts now also carry this outcome directly.
//
// A fake `doppler` and a fake `curl` on PATH stand in for the real CLIs so
// these run offline, deterministically, and without sending real mail.
// python3 and bash themselves are the REAL system binaries (the lock and
// the self-re-invocation both depend on them) — nothing here is a network
// call.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const checkinLibPath = path.join(here, "checkin-lib.sh");

// Defaults to always succeeding and handing the wrapped command straight
// through. DOPPLER_STUB_MODE=fail simulates a definite pre-send failure
// (a bad token, say) — doppler itself refuses and the wrapped curl command
// never runs at all, exactly like the real CLI's own documented behavior
// when it cannot fetch secrets.
const DOPPLER_STUB = `#!/usr/bin/env bash
set -uo pipefail
mode="\${DOPPLER_STUB_MODE:-success}"
fallback_only=0
fallback_file=""
rest=()
args=("$@")
i=0
while [ "$i" -lt "\${#args[@]}" ]; do
  a="\${args[$i]}"
  case "$a" in
    --fallback-only) fallback_only=1 ;;
    --fallback) i=$((i+1)); fallback_file="\${args[$i]}" ;;
    --) i=$((i+1));
        while [ "$i" -lt "\${#args[@]}" ]; do rest+=("\${args[$i]}"); i=$((i+1)); done
        break ;;
  esac
  i=$((i+1))
done
if [ "$mode" = "fail" ]; then
  echo "Doppler Error: invalid access token" >&2
  exit 1
fi
[ -n "$fallback_file" ] && printf 'stub-encrypted-secrets\\n' > "$fallback_file"
exec "\${rest[@]}"
`;

// Stands in for the real Resend call. Mode is picked per-call via
// CURL_STUB_MODE. Mirrors the real response shape: body, then a newline,
// then the HTTP status — matching curl's `-w "\n%{http_code}"`. Also logs
// the Idempotency-Key it was invoked with (visible to it as an env var,
// exactly as the real curl -H interpolation reads it) so a test can prove
// the key was actually threaded through, without needing to parse argv.
const CURL_STUB = `#!/usr/bin/env bash
set -uo pipefail
mode="\${CURL_STUB_MODE:-success}"
calllog="\${CURL_STUB_CALL_LOG:-}"
if [ -n "$calllog" ]; then
  printf 'call idempotency=%s\\n' "\${SENTINEL_MAIL_IDEMPOTENCY_KEY:-none}" >> "$calllog"
fi
# Copies the -d @<payload-file> body somewhere a test can still read it
# after sentinel_mail_red_attempt deletes the real payload — used to prove
# a caller-supplied \`detail\` (2026-09-27) actually reaches the email text,
# not just the reason_code. Opt-in only (CURL_STUB_PAYLOAD_CAPTURE unset for
# every pre-existing test), so this changes nothing for them.
capture="\${CURL_STUB_PAYLOAD_CAPTURE:-}"
if [ -n "$capture" ]; then
  for arg in "$@"; do
    case "$arg" in
      @*) cp "\${arg#@}" "$capture" 2>/dev/null || true ;;
    esac
  done
fi
case "$mode" in
  success)
    printf '{"id":"%s"}\\n200\\n' "\${CURL_STUB_RESEND_ID:-01a0debb-1d46-70d9-82a3-42ea138b1dd2}"
    ;;
  success_bad_id)
    printf '{"id":"not-a-real-uuid"}\\n200\\n'
    ;;
  http_failure)
    printf '{"statusCode":401,"message":"stub invalid key"}\\n401\\n'
    ;;
  network_error)
    echo "curl: (28) stub connect timeout" >&2
    exit 28
    ;;
  connect_failure)
    echo "curl: (7) stub failed to connect to host" >&2
    exit 7
    ;;
  *)
    echo "unknown CURL_STUB_MODE: $mode" >&2
    exit 1
    ;;
esac
`;

// Always fails, standing in for "mktemp is unavailable/broken" — a fake
// binary shadowing the real one via PATH is a portable, deterministic way
// to reproduce this (finding 5) rather than fighting the real mktemp's
// own OS-specific temp-directory selection (macOS's bare `mktemp` ignores
// $TMPDIR entirely unless a template/prefix is given, so pointing TMPDIR
// at a missing directory does not actually reproduce the failure there).
const MKTEMP_FAIL_STUB = `#!/usr/bin/env bash
echo "mktemp: stub failure" >&2
exit 1
`;

// Fails only for the curl-started marker (every other touch goes to the
// real binary), standing in for temp storage turning unwritable between
// creating the marker path and the send. If the send still went ahead with
// no marker, the caller would record pre_send_failure and start no
// cooldown after a real delivery: a duplicate email on the next run.
const TOUCH_MARKER_FAIL_STUB = `#!/usr/bin/env bash
for a in "$@"; do
  if [ -n "\${SENTINEL_MAIL_CURL_STARTED_MARKER:-}" ] && [ "$a" = "$SENTINEL_MAIL_CURL_STARTED_MARKER" ]; then
    echo "touch: stub failure" >&2
    exit 1
  fi
done
exec /usr/bin/touch "$@"
`;

async function makeFixture({ mktempFails = false, markerTouchFails = false } = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "sentinel-mail-red-"));
  const binDir = path.join(dir, "bin");
  const fallbackDir = path.join(dir, "doppler-fallback");
  const mailRedDir = path.join(dir, "mail-red");
  await mkdir(binDir, { recursive: true });
  await mkdir(fallbackDir, { recursive: true });
  const dopplerPath = path.join(binDir, "doppler");
  const curlPath = path.join(binDir, "curl");
  await writeFile(dopplerPath, DOPPLER_STUB);
  await writeFile(curlPath, CURL_STUB);
  await chmod(dopplerPath, 0o755);
  await chmod(curlPath, 0o755);
  if (markerTouchFails) {
    const touchPath = path.join(binDir, "touch");
    await writeFile(touchPath, TOUCH_MARKER_FAIL_STUB);
    await chmod(touchPath, 0o755);
  }
  if (mktempFails) {
    const mktempPath = path.join(binDir, "mktemp");
    await writeFile(mktempPath, MKTEMP_FAIL_STUB);
    await chmod(mktempPath, 0o755);
  }
  return {
    dir,
    binDir,
    fallbackDir,
    mailRedDir,
    callLog: path.join(dir, "curl-calls.log"),
    fallbackLog: path.join(dir, "sentinel-fallback.log"),
  };
}

function runCheckin({
  binDir, fallbackDir, mailRedDir, callLog, fallbackLog, item, checkStatus, reasonCode, curlMode, dopplerMode,
  detail, payloadCapture,
}) {
  const script = `
set -uo pipefail
source "${checkinLibPath}"
sentinel_checkin "${item}" "${checkStatus}" "${reasonCode}" "2026-09-26T14:23:01Z" "2026-09-26T14:23:01Z" "${detail ?? ""}"
printf 'RC=%s\\n' "$?"
`;
  return new Promise((resolve, reject) => {
    const child = spawn("/bin/bash", ["-c", script], {
      env: {
        PATH: `${binDir}:${process.env.PATH}`,
        HOME: process.env.HOME,
        SENTINEL_DOPPLER_FALLBACK_DIR: fallbackDir,
        SENTINEL_FALLBACK_LOG: fallbackLog,
        SENTINEL_MAIL_RED_STATE_DIR: mailRedDir,
        SENTINEL_MAIL_RED_COOLDOWN_SECONDS: "21600",
        CURL_STUB_MODE: curlMode ?? "success",
        CURL_STUB_CALL_LOG: callLog,
        DOPPLER_STUB_MODE: dopplerMode ?? "success",
        ...(payloadCapture ? { CURL_STUB_PAYLOAD_CAPTURE: payloadCapture } : {}),
      },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

async function callCount(callLog) {
  try {
    const contents = await readFile(callLog, "utf8");
    return contents.split("\n").filter((line) => line.trim().length > 0).length;
  } catch {
    return 0;
  }
}

async function callLines(callLog) {
  try {
    const contents = await readFile(callLog, "utf8");
    return contents.split("\n").filter((line) => line.trim().length > 0);
  } catch {
    return [];
  }
}

async function readReceipts(mailRedDir) {
  try {
    const contents = await readFile(path.join(mailRedDir, "receipts.log"), "utf8");
    return contents
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

test("a red check-in sends exactly one email and records a receipt with the Resend id", async () => {
  const fx = await makeFixture();
  const result = await runCheckin({ ...fx, item: "sl-test-a", checkStatus: "red", reasonCode: "job_failed" });
  assert.match(result.stdout, /^RC=0$/m, result.stderr);
  assert.equal(await callCount(fx.callLog), 1);

  const receipts = await readReceipts(fx.mailRedDir);
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0].job, "sl-test-a");
  assert.equal(receipts[0].reason, "job_failed");
  assert.equal(receipts[0].httpStatus, 200);
  assert.equal(receipts[0].resendId, "01a0debb-1d46-70d9-82a3-42ea138b1dd2");
  assert.equal(receipts[0].outcome, "confirmed");
  // Content-free, and the SAME field names #45 uses (timestamp/job/
  // httpStatus/resendId), plus this path's own fixed `reason` field and
  // the outcome field added in the 3rd cross-vendor review.
  assert.deepEqual(Object.keys(receipts[0]).sort(), [
    "httpStatus", "job", "outcome", "reason", "resendId", "timestamp",
  ]);
});

// 2026-09-27: ui-sentry's host_overloaded reason passes an extra
// plain-English `detail` sentence through sentinel_checkin -> sentinel_mail_red
// -> sentinel_mail_red_attempt, appended into the actual email body sent to
// Resend — not just recorded in the reason_code. Every OTHER existing caller
// omits it and is unaffected (covered by the very next test using the exact
// same fixture with no detail).
test("a red check-in with a detail sentence includes it in the email body sent to Resend", async () => {
  const fx = await makeFixture();
  const payloadCapture = path.join(fx.dir, "captured-payload.json");
  const result = await runCheckin({
    ...fx,
    item: "sl-ui-sentry",
    checkStatus: "red",
    reasonCode: "host_overloaded",
    detail: "The site answered its health check, but the Mac was too loaded to finish the check. Overall verdict for this run: FAIL.",
    payloadCapture,
  });
  assert.match(result.stdout, /^RC=0$/m, result.stderr);

  const payload = JSON.parse(await readFile(payloadCapture, "utf8"));
  assert.match(payload.subject, /host_overloaded/);
  assert.match(payload.text, /too loaded to finish the check/);
  assert.match(payload.text, /Overall verdict for this run: FAIL/);
  // The fixed footer must still be there, after the detail.
  assert.match(payload.text, /Sent at most once per item every 6 hours\./);
});

test("a red check-in with NO detail keeps the exact same generic body as before", async () => {
  const fx = await makeFixture();
  const payloadCapture = path.join(fx.dir, "captured-payload.json");
  await runCheckin({
    ...fx, item: "sl-test-a", checkStatus: "red", reasonCode: "job_failed", payloadCapture,
  });
  const payload = JSON.parse(await readFile(payloadCapture, "utf8"));
  assert.equal(
    payload.text,
    "Watcher sl-test-a reported red at 2026-09-26T14:23:01Z (reason: job_failed).\n\n" +
      "Logs: ~/.streetlight/  (error-stream-health/, ui-sentry/)\n" +
      "Repo: ~/streetlight\n\n" +
      "Sent at most once per item every 6 hours.",
  );
});

test("a green check-in never calls the mail path or writes a receipt", async () => {
  const fx = await makeFixture();
  const result = await runCheckin({ ...fx, item: "sl-test-a", checkStatus: "green", reasonCode: "ok" });
  assert.match(result.stdout, /^RC=0$/m, result.stderr);
  assert.equal(await callCount(fx.callLog), 0);
  assert.deepEqual(await readReceipts(fx.mailRedDir), []);
});

test("the 6-hour cooldown suppresses a second red send for the SAME item", async () => {
  const fx = await makeFixture();
  await runCheckin({ ...fx, item: "sl-test-a", checkStatus: "red", reasonCode: "job_failed" });
  await runCheckin({ ...fx, item: "sl-test-a", checkStatus: "red", reasonCode: "job_failed" });
  assert.equal(await callCount(fx.callLog), 1, "second red check-in within the cooldown must not send again");
  assert.equal((await readReceipts(fx.mailRedDir)).length, 1);
});

test("the cooldown is per item — a second, different item still sends its own email", async () => {
  const fx = await makeFixture();
  await runCheckin({ ...fx, item: "sl-test-a", checkStatus: "red", reasonCode: "job_failed" });
  await runCheckin({ ...fx, item: "sl-test-b", checkStatus: "red", reasonCode: "degraded" });
  assert.equal(await callCount(fx.callLog), 2);
  const receipts = await readReceipts(fx.mailRedDir);
  assert.equal(receipts.length, 2);
  assert.deepEqual(receipts.map((r) => r.job).sort(), ["sl-test-a", "sl-test-b"]);
});

test("a definite 4xx rejection releases the reservation — the next check-in retries", async () => {
  const fx = await makeFixture();
  const first = await runCheckin({
    ...fx, item: "sl-test-c", checkStatus: "red", reasonCode: "job_failed", curlMode: "http_failure",
  });
  assert.match(first.stdout, /^RC=0$/m, first.stderr);

  const receiptsAfterFirst = await readReceipts(fx.mailRedDir);
  assert.equal(receiptsAfterFirst.length, 1);
  assert.equal(receiptsAfterFirst[0].httpStatus, 401);
  assert.equal(receiptsAfterFirst[0].resendId, null);
  assert.equal(receiptsAfterFirst[0].outcome, "rejected");
  assert.equal(await callCount(fx.callLog), 1, "a definite 4xx is never retried in-process");

  // No cooldown started on a definite rejection — a second attempt must try
  // again.
  await runCheckin({ ...fx, item: "sl-test-c", checkStatus: "red", reasonCode: "job_failed" });
  assert.equal(await callCount(fx.callLog), 2);
  assert.equal((await readReceipts(fx.mailRedDir)).length, 2);
});

// 4th cross-vendor review, 2026-09-26: the 3rd review's single-retry design
// was itself unsound — a first attempt that may already have reached
// Resend, followed by a retry that hits a DNS/Doppler failure or a 401,
// released the reservation based on the RETRY's outcome alone, erasing
// the first attempt's real uncertainty. Coordinator decision: no retry of
// any kind, one send per invocation, full stop.
test("a curl-level (network) failure with the marker present (curl started) is uncertain — no retry, cooldown starts anyway", async () => {
  const fx = await makeFixture();
  const result = await runCheckin({
    ...fx, item: "sl-test-d", checkStatus: "red", reasonCode: "job_failed", curlMode: "network_error",
  });
  assert.match(result.stdout, /^RC=0$/m, result.stderr);

  const lines = await callLines(fx.callLog);
  assert.equal(lines.length, 1, "exactly one attempt — no retry of any kind any more");

  const receipts = await readReceipts(fx.mailRedDir);
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0].httpStatus, null);
  assert.equal(receipts[0].resendId, null);
  assert.equal(receipts[0].outcome, "uncertain");

  await runCheckin({ ...fx, item: "sl-test-d", checkStatus: "red", reasonCode: "job_failed", curlMode: "success" });
  assert.equal(await callCount(fx.callLog), 1, "the cooldown from the uncertain outcome must suppress the next check-in");
});

test("a definite pre-send failure (Doppler never handed back secrets, curl never ran) releases the reservation immediately — no retry, no cooldown", async () => {
  const fx = await makeFixture();
  const result = await runCheckin({
    ...fx, item: "sl-test-g3", checkStatus: "red", reasonCode: "job_failed", dopplerMode: "fail",
  });
  assert.match(result.stdout, /^RC=0$/m, result.stderr);
  assert.equal(await callCount(fx.callLog), 0, "curl must never run at all when Doppler itself fails pre-send");

  const receipts = await readReceipts(fx.mailRedDir);
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0].httpStatus, null);
  assert.equal(receipts[0].resendId, null);
  assert.equal(receipts[0].outcome, "pre_send_failure");

  // Released, not kept — the next check-in gets a fresh attempt immediately,
  // not after 6h.
  const result2 = await runCheckin({
    ...fx, item: "sl-test-g3", checkStatus: "red", reasonCode: "job_failed", curlMode: "success",
  });
  assert.match(result2.stdout, /^RC=0$/m, result2.stderr);
  assert.equal(await callCount(fx.callLog), 1, "the very next check-in must be free to try again, not suppressed");
});

// The curl-started marker is touched by the wrapped shell BEFORE it execs
// curl, so it exists even when curl itself then fails with a DNS/connect
// error (rc 6/7) — that failure happened AFTER curl started, from this
// mechanism's point of view, so it is "uncertain" (cooldown starts), not
// "pre_send_failure". This is a deliberate simplification (coordinator,
// 4th cross-vendor review): deciding pre-send-vs-not from a plain,
// verifiable physical fact (did curl start at all) rather than trying to
// keep enumerating curl's own exit-code semantics, which is exactly the
// kind of fragile heuristic that kept producing new bugs each round.
test("a curl-level connect/DNS failure (rc 6/7) still counts as curl having started — outcome=uncertain, cooldown starts", async () => {
  const fx = await makeFixture();
  const result = await runCheckin({
    ...fx, item: "sl-test-g4", checkStatus: "red", reasonCode: "job_failed", curlMode: "connect_failure",
  });
  assert.match(result.stdout, /^RC=0$/m, result.stderr);
  assert.equal(await callCount(fx.callLog), 1, "curl ran exactly once — no retry of any kind");

  const receipts = await readReceipts(fx.mailRedDir);
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0].outcome, "uncertain");

  const result2 = await runCheckin({
    ...fx, item: "sl-test-g4", checkStatus: "red", reasonCode: "job_failed", curlMode: "success",
  });
  assert.match(result2.stdout, /^RC=0$/m, result2.stderr);
  assert.equal(await callCount(fx.callLog), 1, "the cooldown from the uncertain outcome must suppress the next check-in");
});

// 4th cross-vendor review, finding 5: an early return before the send was
// ever attempted (a temp file could not even be created) used to return
// without recording anything — reproduced with zero receipts. Every early
// return now writes a pre_send_failure receipt, the same as a Doppler
// refusal does.
test("a temp-file creation failure before any send still writes a pre_send_failure receipt", async () => {
  const fx = await makeFixture({ mktempFails: true });
  const result = await runCheckin({ ...fx, item: "sl-test-k", checkStatus: "red", reasonCode: "job_failed" });
  assert.match(result.stdout, /^RC=0$/m, result.stderr);
  assert.equal(await callCount(fx.callLog), 0, "curl must never be reached if a temp file could not even be created");

  const receipts = await readReceipts(fx.mailRedDir);
  assert.equal(receipts.length, 1, "an early return before the send must still write a receipt");
  assert.equal(receipts[0].outcome, "pre_send_failure");
  assert.equal(receipts[0].httpStatus, null);
  assert.equal(receipts[0].resendId, null);
});

test("a failed curl-started marker blocks the send — no email without a marker, pre_send_failure receipt", async () => {
  const fx = await makeFixture({ markerTouchFails: true });
  const result = await runCheckin({ ...fx, item: "sl-test-m", checkStatus: "red", reasonCode: "job_failed" });
  assert.match(result.stdout, /^RC=0$/m, result.stderr);
  assert.equal(await callCount(fx.callLog), 0, "curl must not run when the marker could not be written");

  const receipts = await readReceipts(fx.mailRedDir);
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0].outcome, "pre_send_failure");
  assert.equal(receipts[0].resendId, null);
});

test("a 2xx with a non-UUID id is treated as possibly sent — outcome=uncertain, cooldown starts anyway", async () => {
  const fx = await makeFixture();
  await runCheckin({ ...fx, item: "sl-test-h", checkStatus: "red", reasonCode: "job_failed", curlMode: "success_bad_id" });
  const receipts = await readReceipts(fx.mailRedDir);
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0].httpStatus, 200);
  assert.equal(receipts[0].resendId, null, "an unvalidated id string must never be trusted as a real Resend id");
  assert.equal(receipts[0].outcome, "uncertain");

  // Coordinator decision: an unresolved 2xx is possibly sent, so the
  // cooldown starts anyway — a rare missed duplicate-detection window is
  // acceptable, an actual duplicate email is not.
  await runCheckin({ ...fx, item: "sl-test-h", checkStatus: "red", reasonCode: "job_failed" });
  assert.equal(await callCount(fx.callLog), 1, "an uncertain-but-possibly-sent outcome must still suppress the next attempt");
});

test("the send carries a per-item Idempotency-Key header value, unique per invocation", async () => {
  const fx = await makeFixture();
  await runCheckin({ ...fx, item: "sl-test-i", checkStatus: "red", reasonCode: "job_failed" });
  const [line] = await callLines(fx.callLog);
  assert.match(line, /idempotency=sl-test-i-\d+-\d+/);
});

test("two concurrent callers for the SAME item never both send", async () => {
  const fx = await makeFixture();
  const [a, b] = await Promise.all([
    runCheckin({ ...fx, item: "sl-test-j", checkStatus: "red", reasonCode: "job_failed" }),
    runCheckin({ ...fx, item: "sl-test-j", checkStatus: "red", reasonCode: "job_failed" }),
  ]);
  assert.match(a.stdout, /^RC=0$/m, a.stderr);
  assert.match(b.stdout, /^RC=0$/m, b.stderr);
  assert.equal(await callCount(fx.callLog), 1, "the lock must serialize both callers onto one actual send");
  assert.equal((await readReceipts(fx.mailRedDir)).length, 1);
});

test("sentinel_checkin never touches the retired sentinel-v5 spool path", async () => {
  const fx = await makeFixture();
  const script = `
set -uo pipefail
source "${checkinLibPath}"
# Point at a checkin.mjs that does not exist — if sentinel_checkin (for
# EITHER green or red) still tried to invoke it the way it used to, this
# would show up as a fallback-log entry; capture_invocation is unaffected
# since it is a different, still-used code path.
SENTINEL_CHECKIN_MJS="/nonexistent/checkin.mjs"
sentinel_checkin "sl-test-e" "green" "ok" "2026-09-26T14:23:01Z" "2026-09-26T14:23:01Z"
sentinel_checkin "sl-test-e" "red" "job_failed" "2026-09-26T14:23:01Z" "2026-09-26T14:23:01Z"
printf 'RC=%s\\n' "$?"
`;
  const result = await new Promise((resolve, reject) => {
    const child = spawn("/bin/bash", ["-c", script], {
      env: {
        PATH: `${fx.binDir}:${process.env.PATH}`,
        HOME: process.env.HOME,
        SENTINEL_DOPPLER_FALLBACK_DIR: fx.fallbackDir,
        SENTINEL_FALLBACK_LOG: fx.fallbackLog,
        SENTINEL_MAIL_RED_STATE_DIR: fx.mailRedDir,
        CURL_STUB_MODE: "success",
        CURL_STUB_CALL_LOG: fx.callLog,
      },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
  assert.match(result.stdout, /^RC=0$/m, result.stderr);
  const fallback = await readFile(fx.fallbackLog, "utf8").catch(() => "");
  assert.doesNotMatch(fallback, /nonexistent\/checkin\.mjs/);
  assert.doesNotMatch(fallback, /checkin:sl-test-e/);
});
