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
//      plus a per-item-per-window Idempotency-Key header.
//   4. Same review: receipts used to accept any string as a Resend id, and
//      any 2xx started the cooldown even without one. Fixed with the same
//      UUID validation #45's send-resend-email.mjs already applies.
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

// Always succeeds and hands the wrapped command straight through — these
// tests are about sentinel_mail_red's own behavior, not sentinel_doppler_run
// (already covered by checkin-lib.doppler-run.test.mjs).
const DOPPLER_STUB = `#!/usr/bin/env bash
set -uo pipefail
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
  *)
    echo "unknown CURL_STUB_MODE: $mode" >&2
    exit 1
    ;;
esac
`;

async function makeFixture() {
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
  return {
    dir,
    binDir,
    fallbackDir,
    mailRedDir,
    callLog: path.join(dir, "curl-calls.log"),
    fallbackLog: path.join(dir, "sentinel-fallback.log"),
  };
}

function runCheckin({ binDir, fallbackDir, mailRedDir, callLog, fallbackLog, item, checkStatus, reasonCode, curlMode }) {
  const script = `
set -uo pipefail
source "${checkinLibPath}"
sentinel_checkin "${item}" "${checkStatus}" "${reasonCode}" "2026-09-26T14:23:01Z" "2026-09-26T14:23:01Z"
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
  // Content-free, and the SAME field names #45 uses (timestamp/job/
  // httpStatus/resendId), plus this path's own fixed `reason` field.
  assert.deepEqual(Object.keys(receipts[0]).sort(), [
    "httpStatus", "job", "reason", "resendId", "timestamp",
  ]);
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

test("a definite rejection (clean HTTP, non-2xx) releases the reservation — the next check-in retries", async () => {
  const fx = await makeFixture();
  const first = await runCheckin({
    ...fx, item: "sl-test-c", checkStatus: "red", reasonCode: "job_failed", curlMode: "http_failure",
  });
  assert.match(first.stdout, /^RC=0$/m, first.stderr);

  const receiptsAfterFirst = await readReceipts(fx.mailRedDir);
  assert.equal(receiptsAfterFirst.length, 1);
  assert.equal(receiptsAfterFirst[0].httpStatus, 401);
  assert.equal(receiptsAfterFirst[0].resendId, null);

  // No cooldown started on a definite rejection — a second attempt must try
  // again, exactly like sentinel_doppler_run's own "retry on real failure"
  // contract.
  await runCheckin({ ...fx, item: "sl-test-c", checkStatus: "red", reasonCode: "job_failed" });
  assert.equal(await callCount(fx.callLog), 2);
  assert.equal((await readReceipts(fx.mailRedDir)).length, 2);
});

test("a curl-level failure (no HTTP response at all) is recorded as failed, not crashed", async () => {
  const fx = await makeFixture();
  const result = await runCheckin({
    ...fx, item: "sl-test-d", checkStatus: "red", reasonCode: "job_failed", curlMode: "network_error",
  });
  assert.match(result.stdout, /^RC=0$/m, result.stderr);
  const receipts = await readReceipts(fx.mailRedDir);
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0].httpStatus, null);
  assert.equal(receipts[0].resendId, null);
});

test("a curl-level failure keeps the reservation (ambiguous: Resend may have already accepted it) — an immediate retry does not resend", async () => {
  const fx = await makeFixture();
  await runCheckin({ ...fx, item: "sl-test-g", checkStatus: "red", reasonCode: "job_failed", curlMode: "network_error" });
  await runCheckin({ ...fx, item: "sl-test-g", checkStatus: "red", reasonCode: "job_failed", curlMode: "success" });
  assert.equal(await callCount(fx.callLog), 1, "the kept reservation must suppress the second attempt");
  const receipts = await readReceipts(fx.mailRedDir);
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0].httpStatus, null);
});

test("a 2xx with a non-UUID id is not a confirmed accept — resendId is null and no cooldown starts", async () => {
  const fx = await makeFixture();
  await runCheckin({ ...fx, item: "sl-test-h", checkStatus: "red", reasonCode: "job_failed", curlMode: "success_bad_id" });
  const receipts = await readReceipts(fx.mailRedDir);
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0].httpStatus, 200);
  assert.equal(receipts[0].resendId, null, "an unvalidated id string must never be trusted as a real Resend id");

  await runCheckin({ ...fx, item: "sl-test-h", checkStatus: "red", reasonCode: "job_failed" });
  assert.equal(await callCount(fx.callLog), 2, "no confirmed accept means the next check-in should try again");
});

test("the send carries a per-item Idempotency-Key header value", async () => {
  const fx = await makeFixture();
  await runCheckin({ ...fx, item: "sl-test-i", checkStatus: "red", reasonCode: "job_failed" });
  const [line] = await callLines(fx.callLog);
  assert.match(line, /idempotency=sl-test-i-\d+/);
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
