// Covers sentinel_emit_item_a/b (lib/sentinel-emit.sh), split out of
// run-ui-sentry.sh 2026-09-26 specifically so this could be tested. Focus:
// the fail-open bug a cross-vendor review caught in the first cut of the
// DEGRADED-is-red fix. Missing jq, an unreadable/malformed last-run.json, a
// missing overallLevel field, and a last-run.json that predates THIS
// invocation (left over from an earlier run) all used to default to green.
// Every one of those must now be red with a distinct "state_unverifiable"
// reason — never silently treated as a clean pass.
//
// sentinel_checkin itself is stubbed to a one-line recorder: this file
// tests sentinel_emit_item_a/b's OWN decision logic, not the mail path
// (covered separately by checkin-lib.mail-red.test.mjs). No network call,
// no real doppler/curl, ever happens here.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const sentinelEmitPath = path.join(here, "sentinel-emit.sh");

async function makeFixture() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "sentinel-emit-"));
  const stateRoot = path.join(dir, "state");
  await mkdir(stateRoot, { recursive: true });
  return { dir, stateRoot, checkinLog: path.join(dir, "checkins.log") };
}

// A minimal PATH containing ONLY a symlink to the real `node` binary — no
// jq, whatever this machine calls it or wherever it lives. Bash's own
// builtins ([, test, printf, command, case) need no PATH entry at all, so
// this is enough to simulate "jq is not installed" without disturbing
// anything else.
async function nodeOnlyPath(dir) {
  const nodeBinDir = path.join(dir, "node-only-bin");
  await mkdir(nodeBinDir, { recursive: true });
  const realNode = await new Promise((resolve, reject) => {
    const child = spawn("/bin/bash", ["-c", "command -v node"]);
    let out = "";
    child.stdout.on("data", (c) => { out += c; });
    child.on("close", (code) => (code === 0 ? resolve(out.trim()) : reject(new Error("node not found"))));
  });
  await symlink(realNode, path.join(nodeBinDir, "node"));
  return nodeBinDir;
}

function runEmitItemA({ stateRoot, checkinLog, exitCode, sentinelAt, pathOverride, mailOutcome = "" }) {
  const script = `
set -uo pipefail
sentinel_checkin() {
  printf 'CHECKIN item=%s status=%s reason=%s detail=%s\\n' "$1" "$2" "$3" "\${6:-}" >> "${checkinLog}"
  if [ -n "${mailOutcome}" ] && [ -n "\${SENTINEL_MAIL_RED_RESULT_FILE:-}" ]; then
    printf '%s\\n' "${mailOutcome}" > "$SENTINEL_MAIL_RED_RESULT_FILE"
  fi
  return 0
}
STATE_ROOT="${stateRoot}"
UI_SENTRY_SENTINEL_AT="${sentinelAt}"
UI_SENTRY_SENTINEL_SLOT="${sentinelAt}"
source "${sentinelEmitPath}"
sentinel_emit_item_a "${exitCode}"
printf 'RC=%s\\n' "$?"
`;
  return new Promise((resolve, reject) => {
    // Absolute path to the interpreter itself: spawn() resolves a bare
    // "bash" against the CHILD's own PATH (the very thing pathOverride
    // restricts), not this process's, so a bare name would fail to launch
    // at all once jq is removed from the child's PATH.
    const child = spawn("/bin/bash", ["-c", script], {
      env: { PATH: pathOverride ?? process.env.PATH, HOME: process.env.HOME },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => { stdout += c; });
    child.stderr.on("data", (c) => { stderr += c; });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

async function lastCheckin(checkinLog) {
  const contents = await readFile(checkinLog, "utf8").catch(() => "");
  const lines = contents.trim().split("\n").filter(Boolean);
  return lines.length > 0 ? lines[lines.length - 1] : null;
}

test("exit code != 0 with no verifiable state file is red job_failed (the pre-2026-09-27 default)", async () => {
  const fx = await makeFixture();
  const result = await runEmitItemA({ ...fx, exitCode: "5", sentinelAt: "2026-09-26T14:00:00.000Z" });
  assert.match(result.stdout, /^RC=0$/m, result.stderr);
  assert.equal(await lastCheckin(fx.checkinLog), "CHECKIN item=sl-ui-sentry status=red reason=job_failed detail=");
});

// 2026-09-27, host-load.mjs (reason vocabulary reverted in cross-vendor
// review of #52 finding 3 — host_overloaded is NOT in checkin-schema.mjs's
// closed reason vocabulary and this lane does not add new reason codes): a
// tier1 failure this run's OWN orchestrator judged was caused by Mac CPU
// load still reports the plain job_failed reason — still red, never
// downgraded — but carries a plain-English detail for the email, naming the
// overall verdict, so Jesse reads WHY without a new reason_code existing.
test("sustained host overload emits one red check-in with the quiet-direction detail", async () => {
  const fx = await makeFixture();
  await writeFile(
    path.join(fx.stateRoot, "last-run.json"),
    JSON.stringify({
      overallLevel: "FAIL",
      startedAt: "2026-09-26T14:00:05.000Z",
      invocationId: "2026-09-26T14:00:00.000Z",
      hostOverloaded: true,
      failureClass: "host_overloaded",
      overloadAlertDisposition: "page",
      overloadDurationMinutes: 65,
    }),
  );
  const result = await runEmitItemA({ ...fx, exitCode: "1", sentinelAt: "2026-09-26T14:00:00.000Z", mailOutcome: "confirmed" });
  assert.match(result.stdout, /^RC=0$/m, result.stderr);
  const line = await lastCheckin(fx.checkinLog);
  assert.match(line, /^CHECKIN item=sl-ui-sentry status=red reason=job_failed detail=/);
  assert.match(line, /has not succeeded for 65 minutes/);
  assert.match(line, /overloaded on every failed scheduled run/);
  const state = JSON.parse(await readFile(path.join(fx.stateRoot, "last-run.json"), "utf8"));
  assert.equal(state.overloadEscalationActive, true);
  assert.equal(state.overloadAlertDisposition, "delivered");
});

test("a definite sustained-overload mail rejection leaves escalation pending for retry", async () => {
  const fx = await makeFixture();
  const statePath = path.join(fx.stateRoot, "last-run.json");
  await writeFile(statePath, JSON.stringify({
    overallLevel: "FAIL",
    startedAt: "2026-09-26T14:00:05.000Z",
    invocationId: "2026-09-26T14:00:00.000Z",
    hostOverloaded: true,
    failureClass: "host_overloaded",
    overloadAlertDisposition: "page",
    overloadDurationMinutes: 65,
    overloadEscalationActive: false,
  }));
  await runEmitItemA({
    ...fx,
    exitCode: "1",
    sentinelAt: "2026-09-26T14:00:00.000Z",
    mailOutcome: "rejected",
  });
  const state = JSON.parse(await readFile(statePath, "utf8"));
  assert.equal(state.overloadEscalationActive, false);
  assert.equal(state.overloadAlertDisposition, "page");
});

test("an overload-only timeout below the sustained threshold does not emit red", async () => {
  const fx = await makeFixture();
  await writeFile(
    path.join(fx.stateRoot, "last-run.json"),
    JSON.stringify({
      overallLevel: "DEGRADED",
      startedAt: "2026-09-26T14:00:05.000Z",
      invocationId: "2026-09-26T14:00:00.000Z",
      hostOverloaded: true,
      failureClass: "host_overloaded",
      overloadAlertDisposition: "suppress",
      overloadDurationMinutes: 5,
    }),
  );
  const result = await runEmitItemA({ ...fx, exitCode: "0", sentinelAt: "2026-09-26T14:00:00.000Z" });
  assert.match(result.stdout, /^RC=0$/m, result.stderr);
  assert.equal(await lastCheckin(fx.checkinLog), "CHECKIN item=sl-ui-sentry status=yellow reason=degraded detail=");
});

test("exit code != 0 with hostOverloaded:false in an otherwise-verified state stays plain job_failed", async () => {
  const fx = await makeFixture();
  await writeFile(
    path.join(fx.stateRoot, "last-run.json"),
    JSON.stringify({
      overallLevel: "FAIL",
      startedAt: "2026-09-26T14:00:05.000Z",
      invocationId: "2026-09-26T14:00:00.000Z",
      hostOverloaded: false,
    }),
  );
  const result = await runEmitItemA({ ...fx, exitCode: "1", sentinelAt: "2026-09-26T14:00:00.000Z" });
  assert.match(result.stdout, /^RC=0$/m, result.stderr);
  assert.equal(await lastCheckin(fx.checkinLog), "CHECKIN item=sl-ui-sentry status=red reason=job_failed detail=");
});

// A last-run.json claiming hostOverloaded:true is worthless if it isn't
// verifiably THIS invocation's own run — same fail-closed posture as the
// state_unverifiable branch below, just folded into job_failed since this
// exit code already reports red correctly regardless. (The reason_code is
// always job_failed now; what a mismatched invocationId actually withholds
// is the detail sentence.)
test("exit code != 0 with hostOverloaded:true but a MISMATCHED invocationId gets no detail sentence", async () => {
  const fx = await makeFixture();
  await writeFile(
    path.join(fx.stateRoot, "last-run.json"),
    JSON.stringify({
      overallLevel: "FAIL",
      startedAt: "2026-09-26T14:00:05.000Z",
      invocationId: "some-other-invocations-id",
      hostOverloaded: true,
    }),
  );
  const result = await runEmitItemA({ ...fx, exitCode: "1", sentinelAt: "2026-09-26T14:00:00.000Z" });
  assert.match(result.stdout, /^RC=0$/m, result.stderr);
  assert.equal(await lastCheckin(fx.checkinLog), "CHECKIN item=sl-ui-sentry status=red reason=job_failed detail=");
});

test("hostOverloaded alone without the overload-only classification stays a genuine red failure", async () => {
  const fx = await makeFixture();
  await writeFile(
    path.join(fx.stateRoot, "last-run.json"),
    JSON.stringify({
      overallLevel: "FAIL",
      startedAt: "2026-09-26T14:00:05.000Z",
      invocationId: "2026-09-26T14:00:00.000Z",
      hostOverloaded: true,
    }),
  );
  const result = await runEmitItemA({ ...fx, exitCode: "1", sentinelAt: "2026-09-26T14:00:00.000Z" });
  assert.match(result.stdout, /^RC=0$/m, result.stderr);
  assert.equal(await lastCheckin(fx.checkinLog), "CHECKIN item=sl-ui-sentry status=red reason=job_failed detail=");
});

test("a fresh, valid PASS report reports green", async () => {
  const fx = await makeFixture();
  await writeFile(
    path.join(fx.stateRoot, "last-run.json"),
    JSON.stringify({
      overallLevel: "PASS",
      startedAt: "2026-09-26T14:00:05.000Z",
      invocationId: "2026-09-26T14:00:00.000Z",
    }),
  );
  const result = await runEmitItemA({ ...fx, exitCode: "0", sentinelAt: "2026-09-26T14:00:00.000Z" });
  assert.match(result.stdout, /^RC=0$/m, result.stderr);
  assert.equal(await lastCheckin(fx.checkinLog), "CHECKIN item=sl-ui-sentry status=green reason=ok detail=");
});

test("a fresh DEGRADED report reports red degraded", async () => {
  const fx = await makeFixture();
  await writeFile(
    path.join(fx.stateRoot, "last-run.json"),
    JSON.stringify({
      overallLevel: "DEGRADED",
      startedAt: "2026-09-26T14:00:05.000Z",
      invocationId: "2026-09-26T14:00:00.000Z",
    }),
  );
  const result = await runEmitItemA({ ...fx, exitCode: "0", sentinelAt: "2026-09-26T14:00:00.000Z" });
  assert.match(result.stdout, /^RC=0$/m, result.stderr);
  assert.equal(await lastCheckin(fx.checkinLog), "CHECKIN item=sl-ui-sentry status=red reason=degraded detail=");
});

test("a fresh FAIL report also reports red", async () => {
  const fx = await makeFixture();
  await writeFile(
    path.join(fx.stateRoot, "last-run.json"),
    JSON.stringify({
      overallLevel: "FAIL",
      startedAt: "2026-09-26T14:00:05.000Z",
      invocationId: "2026-09-26T14:00:00.000Z",
    }),
  );
  const result = await runEmitItemA({ ...fx, exitCode: "0", sentinelAt: "2026-09-26T14:00:00.000Z" });
  assert.match(result.stdout, /^RC=0$/m, result.stderr);
  assert.match(await lastCheckin(fx.checkinLog), /^CHECKIN item=sl-ui-sentry status=red /);
});

test("no last-run.json at all reports red state_unverifiable, not green", async () => {
  const fx = await makeFixture();
  const result = await runEmitItemA({ ...fx, exitCode: "0", sentinelAt: "2026-09-26T14:00:00.000Z" });
  assert.match(result.stdout, /^RC=0$/m, result.stderr);
  assert.equal(await lastCheckin(fx.checkinLog), "CHECKIN item=sl-ui-sentry status=red reason=state_unverifiable detail=");
});

test("malformed JSON reports red state_unverifiable, not green", async () => {
  const fx = await makeFixture();
  await writeFile(path.join(fx.stateRoot, "last-run.json"), "{not valid json");
  const result = await runEmitItemA({ ...fx, exitCode: "0", sentinelAt: "2026-09-26T14:00:00.000Z" });
  assert.match(result.stdout, /^RC=0$/m, result.stderr);
  assert.equal(await lastCheckin(fx.checkinLog), "CHECKIN item=sl-ui-sentry status=red reason=state_unverifiable detail=");
});

test("valid JSON missing the overallLevel field reports red state_unverifiable, not green", async () => {
  const fx = await makeFixture();
  await writeFile(
    path.join(fx.stateRoot, "last-run.json"),
    JSON.stringify({ startedAt: "2026-09-26T14:00:05.000Z" }),
  );
  const result = await runEmitItemA({ ...fx, exitCode: "0", sentinelAt: "2026-09-26T14:00:00.000Z" });
  assert.match(result.stdout, /^RC=0$/m, result.stderr);
  assert.equal(await lastCheckin(fx.checkinLog), "CHECKIN item=sl-ui-sentry status=red reason=state_unverifiable detail=");
});

test("an unrecognized overallLevel value reports red state_unverifiable, not green", async () => {
  const fx = await makeFixture();
  await writeFile(
    path.join(fx.stateRoot, "last-run.json"),
    JSON.stringify({
      overallLevel: "SOMETHING_NEW",
      startedAt: "2026-09-26T14:00:05.000Z",
      invocationId: "2026-09-26T14:00:00.000Z",
    }),
  );
  const result = await runEmitItemA({ ...fx, exitCode: "0", sentinelAt: "2026-09-26T14:00:00.000Z" });
  assert.match(result.stdout, /^RC=0$/m, result.stderr);
  assert.equal(await lastCheckin(fx.checkinLog), "CHECKIN item=sl-ui-sentry status=red reason=state_unverifiable detail=");
});

test("a PASS left over from a PREVIOUS invocation (startedAt before this run started, a different invocationId) reports red state_unverifiable, never green", async () => {
  const fx = await makeFixture();
  await writeFile(
    path.join(fx.stateRoot, "last-run.json"),
    JSON.stringify({
      overallLevel: "PASS",
      startedAt: "2026-09-25T14:00:00.000Z",
      invocationId: "2026-09-25T14:00:00.000Z",
    }),
  );
  const result = await runEmitItemA({ ...fx, exitCode: "0", sentinelAt: "2026-09-26T14:00:00.000Z" });
  assert.match(result.stdout, /^RC=0$/m, result.stderr);
  assert.equal(await lastCheckin(fx.checkinLog), "CHECKIN item=sl-ui-sentry status=red reason=state_unverifiable detail=");
});

// 3rd cross-vendor review, 2026-09-26, finding 4: an invocation id lets the
// emitter make a much stronger claim than any timestamp window can — not
// "not older than roughly when this run started," but "this exact file was
// written by THIS exact invocation." A startedAt that is otherwise fresh
// but carries a DIFFERENT invocation's id must still read as unverifiable.
test("a fresh-looking startedAt with a MISMATCHED invocationId reports red state_unverifiable, never green", async () => {
  const fx = await makeFixture();
  await writeFile(
    path.join(fx.stateRoot, "last-run.json"),
    JSON.stringify({
      overallLevel: "PASS",
      startedAt: "2026-09-26T14:00:05.000Z",
      invocationId: "some-other-invocations-id",
    }),
  );
  const result = await runEmitItemA({ ...fx, exitCode: "0", sentinelAt: "2026-09-26T14:00:00.000Z" });
  assert.match(result.stdout, /^RC=0$/m, result.stderr);
  assert.equal(await lastCheckin(fx.checkinLog), "CHECKIN item=sl-ui-sentry status=red reason=state_unverifiable detail=");
});

// 3rd cross-vendor review, finding 4: a non-string value passing a bare
// null-check (the old `// ""` pattern) is the same class of gap as the
// multi-value one below, just for one field instead of the whole document
// — e.g. a schema drift that writes overallLevel as an object or number.
test("a non-string overallLevel (failing strict field-type validation) reports red state_unverifiable, not green", async () => {
  const fx = await makeFixture();
  await writeFile(
    path.join(fx.stateRoot, "last-run.json"),
    JSON.stringify({
      overallLevel: { drifted: "schema" },
      startedAt: "2026-09-26T14:00:05.000Z",
      invocationId: "2026-09-26T14:00:00.000Z",
    }),
  );
  const result = await runEmitItemA({ ...fx, exitCode: "0", sentinelAt: "2026-09-26T14:00:00.000Z" });
  assert.match(result.stdout, /^RC=0$/m, result.stderr);
  assert.equal(await lastCheckin(fx.checkinLog), "CHECKIN item=sl-ui-sentry status=red reason=state_unverifiable detail=");
});

// 3rd cross-vendor review, finding 4's own repro: a fresh, otherwise-VALID
// PASS document (a real, correctly formatted timestamp, matching
// invocationId, everything the checks above accept on its own) immediately
// followed by a second JSON value — reproduced directly with a trailing
// `{}`. This is not a parse error (both values are individually valid
// JSON), so the exit-status check from the 2nd review's fix does not catch
// it on its own; `length != 1` under `-s` (slurp) is what does.
test("a fresh, otherwise-valid PASS report followed by a second JSON value ({}) reports red state_unverifiable, not green", async () => {
  const fx = await makeFixture();
  const validDoc = JSON.stringify({
    overallLevel: "PASS",
    startedAt: "2026-09-26T14:00:05.000Z",
    invocationId: "2026-09-26T14:00:00.000Z",
  });
  await writeFile(path.join(fx.stateRoot, "last-run.json"), `${validDoc}\n{}`);
  const result = await runEmitItemA({ ...fx, exitCode: "0", sentinelAt: "2026-09-26T14:00:00.000Z" });
  assert.match(result.stdout, /^RC=0$/m, result.stderr);
  assert.equal(await lastCheckin(fx.checkinLog), "CHECKIN item=sl-ui-sentry status=red reason=state_unverifiable detail=");
});

test("a valid PASS object followed by trailing garbage reports red state_unverifiable, not green (2nd cross-vendor review reproduction)", async () => {
  const fx = await makeFixture();
  // jq parses a JSON document stream by default: it prints the valid
  // document's fields to stdout, THEN exits nonzero on the trailing
  // garbage. The old `jq ... || true` pattern discarded that exit code
  // and used "PASS" anyway — verified directly against real jq: this
  // exact byte sequence prints PASS/startedAt on stdout while exiting 5.
  await writeFile(
    path.join(fx.stateRoot, "last-run.json"),
    `${JSON.stringify({ overallLevel: "PASS", startedAt: "2026-09-26T14:00:05.000Z" })}\nGARBAGE_NOT_JSON`,
  );
  const result = await runEmitItemA({ ...fx, exitCode: "0", sentinelAt: "2026-09-26T14:00:00.000Z" });
  assert.match(result.stdout, /^RC=0$/m, result.stderr);
  assert.equal(await lastCheckin(fx.checkinLog), "CHECKIN item=sl-ui-sentry status=red reason=state_unverifiable detail=");
});

test("a wildly future-dated startedAt (year 2099) reports red state_unverifiable, not green (the lower-bound check alone cannot catch this)", async () => {
  const fx = await makeFixture();
  await writeFile(
    path.join(fx.stateRoot, "last-run.json"),
    JSON.stringify({
      overallLevel: "PASS",
      startedAt: "2099-01-01T00:00:00.000Z",
      invocationId: "2026-09-26T14:00:00.000Z",
    }),
  );
  const result = await runEmitItemA({ ...fx, exitCode: "0", sentinelAt: "2026-09-26T14:00:00.000Z" });
  assert.match(result.stdout, /^RC=0$/m, result.stderr);
  assert.equal(await lastCheckin(fx.checkinLog), "CHECKIN item=sl-ui-sentry status=red reason=state_unverifiable detail=");
});

test("missing jq reports red state_unverifiable, never green, even with a perfectly valid report on disk", async () => {
  const fx = await makeFixture();
  await writeFile(
    path.join(fx.stateRoot, "last-run.json"),
    JSON.stringify({ overallLevel: "PASS", startedAt: "2026-09-26T14:00:05.000Z" }),
  );
  const nodeOnly = await nodeOnlyPath(fx.dir);
  const result = await runEmitItemA({
    ...fx,
    exitCode: "0",
    sentinelAt: "2026-09-26T14:00:00.000Z",
    pathOverride: nodeOnly,
  });
  assert.match(result.stdout, /^RC=0$/m, result.stderr);
  assert.equal(await lastCheckin(fx.checkinLog), "CHECKIN item=sl-ui-sentry status=red reason=state_unverifiable detail=");
});

test("mixed timestamp precision (millisecond startedAt vs a second-precision invocation stamp) compares correctly, not as text", async () => {
  const fx = await makeFixture();
  // A naive STRING compare puts "14:00:00.500Z" BEFORE "14:00:00Z" (the "."
  // sorts below "Z"), even though .500 is chronologically LATER. This is
  // exactly the shape SENTINEL_AT's wall-clock fallback (no milliseconds,
  // `date -u +%Y-%m-%dT%H:%M:%SZ`) produces against orchestrator.mjs's
  // real millisecond-precision startedAt.
  await writeFile(
    path.join(fx.stateRoot, "last-run.json"),
    JSON.stringify({
      overallLevel: "PASS",
      startedAt: "2026-09-26T14:00:00.500Z",
      invocationId: "2026-09-26T14:00:00Z",
    }),
  );
  const result = await runEmitItemA({ ...fx, exitCode: "0", sentinelAt: "2026-09-26T14:00:00Z" });
  assert.match(result.stdout, /^RC=0$/m, result.stderr);
  assert.equal(await lastCheckin(fx.checkinLog), "CHECKIN item=sl-ui-sentry status=green reason=ok detail=");
});
