// Covers sentinel_doppler_run in checkin-lib.sh — added 2026-09-04 after
// com.streetlight.error-stream-health went red three times in one day on a
// Doppler 429 ("Exceeded rate limit of 240 requests within 60 seconds")
// even though its secrets hadn't changed in hours. A fake `doppler` binary
// on PATH stands in for the real CLI so these run offline and don't touch
// the shared rate limit themselves.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, mkdtemp, mkdir, writeFile, utimes } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const checkinLibPath = path.join(here, "checkin-lib.sh");

// A stand-in `doppler` CLI. `--fallback-only` never touches "the network":
// it succeeds iff the given --fallback file exists, matching real Doppler's
// documented behavior. Without `--fallback-only` ("live" calls) its outcome
// is controlled by $DOPPLER_STUB_LIVE_MODE so each test can force a
// specific failure shape.
const DOPPLER_STUB = `#!/usr/bin/env bash
set -uo pipefail
mode="\${DOPPLER_STUB_LIVE_MODE:-success}"
calllog="\${DOPPLER_STUB_CALL_LOG:-}"
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
if [ -n "$calllog" ]; then
  printf 'fallback_only=%s mode=%s\\n' "$fallback_only" "$mode" >> "$calllog"
fi
if [ "$fallback_only" = "1" ]; then
  if [ -n "$fallback_file" ] && [ -f "$fallback_file" ]; then
    exec "\${rest[@]}"
  fi
  echo "Doppler Error: could not read fallback file" >&2
  exit 1
fi
case "$mode" in
  success)
    [ -n "$fallback_file" ] && printf 'stub-encrypted-secrets\\n' > "$fallback_file"
    exec "\${rest[@]}"
    ;;
  rate_limit)
    echo "Doppler Error: Exceeded rate limit of 240 requests within 60 seconds. Reading secrets from fallback file" >&2
    exit 1
    ;;
  bad_token)
    echo "Doppler Error: invalid access token" >&2
    exit 1
    ;;
  *)
    echo "unknown DOPPLER_STUB_LIVE_MODE: $mode" >&2
    exit 1
    ;;
esac
`;

async function makeFixture() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "sentinel-doppler-run-"));
  const binDir = path.join(dir, "bin");
  const fallbackDir = path.join(dir, "fallback");
  await mkdir(binDir, { recursive: true });
  await mkdir(fallbackDir, { recursive: true });
  const dopplerPath = path.join(binDir, "doppler");
  await writeFile(dopplerPath, DOPPLER_STUB);
  await chmod(dopplerPath, 0o755);
  return { dir, dopplerPath, fallbackDir, callLog: path.join(dir, "calls.log") };
}

function runSentinelDopplerRun({ dopplerPath, fallbackDir, callLog, liveMode, ttlSeconds }) {
  const script = `
set -uo pipefail
source "${checkinLibPath}"
sentinel_doppler_run "agent-secrets" "dev" -- node -e "process.stdout.write('ran\\n')"
rc=$?
printf 'RC=%s\\n' "$rc"
printf 'STATUS=%s\\n' "$SENTINEL_DOPPLER_RUN_STATUS"
exit "$rc"
`;
  return new Promise((resolve, reject) => {
    const child = spawn("bash", ["-c", script], {
      env: {
        PATH: `${path.dirname(dopplerPath)}:${process.env.PATH}`,
        HOME: process.env.HOME,
        SENTINEL_DOPPLER_FALLBACK_DIR: fallbackDir,
        SENTINEL_DOPPLER_FALLBACK_TTL_SECONDS: String(ttlSeconds ?? 21600),
        SENTINEL_FALLBACK_LOG: path.join(fallbackDir, "..", "sentinel-fallback.log"),
        DOPPLER_STUB_LIVE_MODE: liveMode,
        DOPPLER_STUB_CALL_LOG: callLog,
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

function parseStatus(stdout) {
  const match = stdout.match(/^STATUS=(.*)$/m);
  return match ? match[1] : null;
}

async function writeFallbackFile(fallbackDir, ageSeconds) {
  const file = path.join(fallbackDir, "agent-secrets-dev.fallback");
  await writeFile(file, "existing-encrypted-secrets\n");
  if (ageSeconds !== undefined) {
    const then = new Date(Date.now() - ageSeconds * 1000);
    await utimes(file, then, then);
  }
  return file;
}

test("no fallback file, live call succeeds: runs live, refreshes cache, status live_ok", async () => {
  const fx = await makeFixture();
  const result = await runSentinelDopplerRun({ ...fx, liveMode: "success" });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(parseStatus(result.stdout), "live_ok");
  assert.match(result.stdout, /^ran$/m);
});

test("fresh fallback file (<6h): served from cache only, never calls out live", async () => {
  const fx = await makeFixture();
  await writeFallbackFile(fx.fallbackDir, 60); // 1 minute old
  // If sentinel_doppler_run ever made a live call it would hit rate_limit
  // and fail loudly, since we deliberately did not carve out a
  // recoverable path here — proving the fresh-cache branch never even
  // attempts a live call.
  const result = await runSentinelDopplerRun({ ...fx, liveMode: "rate_limit" });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(parseStatus(result.stdout), "cache_fresh");
  assert.match(result.stdout, /^ran$/m);
});

test("stale fallback file + live 429: does not report error, retries via fallback-only", async () => {
  const fx = await makeFixture();
  await writeFallbackFile(fx.fallbackDir, 7 * 3600); // stale by TTL, but present
  const result = await runSentinelDopplerRun({ ...fx, liveMode: "rate_limit" });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(parseStatus(result.stdout), "rate_limited_used_fallback");
  assert.match(result.stdout, /^ran$/m);
  // The 429 must be tolerated, not surfaced as the job's own failure text.
  assert.doesNotMatch(result.stderr, /Exceeded rate limit/);
});

test("no fallback file at all + live 429: genuinely fails (no way to reach secrets)", async () => {
  const fx = await makeFixture();
  const result = await runSentinelDopplerRun({ ...fx, liveMode: "rate_limit" });
  assert.notEqual(result.code, 0);
  assert.equal(parseStatus(result.stdout), "rate_limited_no_fallback");
});

test("non-rate-limit live failure is never masked, even with a fallback present", async () => {
  const fx = await makeFixture();
  await writeFallbackFile(fx.fallbackDir, 7 * 3600);
  const result = await runSentinelDopplerRun({ ...fx, liveMode: "bad_token" });
  assert.notEqual(result.code, 0);
  assert.equal(parseStatus(result.stdout), "live_failed");
  assert.match(result.stderr, /invalid access token/);
});

test("stale cache triggers exactly one live attempt, then one fallback-only retry on 429", async () => {
  const fx = await makeFixture();
  await writeFallbackFile(fx.fallbackDir, 7 * 3600);
  await runSentinelDopplerRun({ ...fx, liveMode: "rate_limit" });
  const { readFile } = await import("node:fs/promises");
  const log = await readFile(fx.callLog, "utf8");
  const lines = log.trim().split("\n");
  assert.deepEqual(lines, [
    "fallback_only=0 mode=rate_limit",
    "fallback_only=1 mode=rate_limit",
  ]);
});
