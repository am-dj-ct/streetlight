import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { evaluateHealth, errorArtifact, writeArtifactAtomic } from "./health.mjs";
import { decideWatcher } from "./watcher.mjs";

function runNode(script, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], { env: { ...process.env, ...env } });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

function runCommand(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env: { ...process.env, ...env } });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

test("reds only above fifty percent with at least one interaction", () => {
  assert.equal(evaluateHealth({ windowMinutes: 60, totalInteractions: 0, errorStreamCount: 0 }).status, "ok");
  assert.equal(evaluateHealth({ windowMinutes: 60, totalInteractions: 2, errorStreamCount: 1 }).status, "ok");
  assert.equal(evaluateHealth({ windowMinutes: 60, totalInteractions: 3, errorStreamCount: 2 }).status, "failed");
});

test("rejects count shapes that could create a false rate", () => {
  assert.throws(() => evaluateHealth({ windowMinutes: 30, totalInteractions: 3, errorStreamCount: 2 }), /unexpected_window/);
  assert.throws(() => evaluateHealth({ windowMinutes: 60, totalInteractions: 1, errorStreamCount: 2 }), /errors_exceed/);
  assert.throws(() => evaluateHealth({ windowMinutes: 60, totalInteractions: -1, errorStreamCount: 0 }), /invalid_total/);
});

test("operational failures are distinct from a measured red", () => {
  const artifact = errorArtifact("http_503", "2026-08-23T00:00:00.000Z", {
    reason: "upstream_5xx",
    upstreamStatus: 503,
    upstreamLatencyMs: 217,
  });
  assert.equal(artifact.status, "error");
  assert.equal(artifact.reason, "upstream_5xx");
  assert.equal(artifact.upstreamStatus, 503);
  assert.equal(artifact.upstreamLatencyMs, 217);
  assert.equal(artifact.totalInteractions, null);
});

test("watcher repairs once, then escalates on the second consecutive failure", () => {
  assert.deepEqual(decideWatcher({ status: "error", consecutiveFailures: 1 }), {
    checkinStatus: "yellow",
    reasonCode: "degraded",
    action: "rerun_once",
    exitCode: 0,
  });
  assert.deepEqual(decideWatcher({ status: "error", consecutiveFailures: 2 }), {
    checkinStatus: "red",
    reasonCode: "job_failed",
    action: "escalate",
    exitCode: 1,
  });
});

test("artifact write is private and complete", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "streetlight-health-test-"));
  const output = path.join(directory, "nested", "health.json");
  const artifact = evaluateHealth({ windowMinutes: 60, totalInteractions: 3, errorStreamCount: 2 }, "2026-08-23T00:00:00.000Z");
  await writeArtifactAtomic(output, artifact);

  assert.deepEqual(JSON.parse(await readFile(output, "utf8")), artifact);
  assert.equal((await stat(output)).mode & 0o777, 0o600);
});

test("runner authenticates, derives red locally, and writes only counts", async (t) => {
  let authorization = null;
  const server = createServer((request, response) => {
    authorization = request.headers.authorization ?? null;
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({
      generatedAt: "2026-08-23T00:00:00.000Z",
      windowMinutes: 60,
      totalInteractions: 5,
      errorStreamCount: 4,
      errorStreamRate: 0.8,
      status: "red",
    }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());

  const directory = await mkdtemp(path.join(os.tmpdir(), "streetlight-health-runner-"));
  const output = path.join(directory, "health.json");
  const address = server.address();
  const result = await runNode(fileURLToPath(new URL("./run-health.mjs", import.meta.url)), {
    OPS_READ_TOKEN: "test-ops-token",
    STREETLIGHT_BASE_URL: `http://127.0.0.1:${address.port}`,
    STREETLIGHT_ERROR_STREAM_HEALTH_ARTIFACT: output,
  });
  const artifact = JSON.parse(await readFile(output, "utf8"));

  assert.equal(result.code, 2);
  assert.equal(result.stderr, "");
  assert.equal(authorization, "Bearer test-ops-token");
  assert.equal(artifact.status, "failed");
  assert.equal(artifact.totalInteractions, 5);
  assert.equal(artifact.upstreamStatus, 200);
  assert.equal(artifact.attempts, 1);
  assert.equal(typeof artifact.upstreamLatencyMs, "number");
});

test("retries a transient failure once and records the successful attempt", async (t) => {
  let requests = 0;
  const server = createServer((request, response) => {
    requests += 1;
    if (requests === 1) {
      response.writeHead(503, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "temporary" }));
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ windowMinutes: 60, totalInteractions: 1, errorStreamCount: 0 }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());

  const directory = await mkdtemp(path.join(os.tmpdir(), "streetlight-health-retry-"));
  const address = server.address();
  const output = path.join(directory, "health.json");
  const result = await runNode(fileURLToPath(new URL("./run-health.mjs", import.meta.url)), {
    OPS_READ_TOKEN: "test-ops-token",
    STREETLIGHT_BASE_URL: `http://127.0.0.1:${address.port}`,
    STREETLIGHT_ERROR_STREAM_HEALTH_ARTIFACT: output,
    STREETLIGHT_ERROR_STREAM_HEALTH_STATE_FILE: path.join(directory, "state.json"),
    STREETLIGHT_ERROR_STREAM_HEALTH_RETRY_DELAY_MS: "0",
  });
  const artifact = JSON.parse(await readFile(output, "utf8"));

  assert.equal(result.code, 0);
  assert.equal(requests, 2);
  assert.equal(artifact.status, "ok");
  assert.equal(artifact.attempts, 2);
  assert.equal(artifact.upstreamStatus, 200);
});

test("reports auth failures with status and latency, then turns red on the second run", async (t) => {
  const server = createServer((request, response) => {
    response.writeHead(401, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "unauthorized" }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());

  const directory = await mkdtemp(path.join(os.tmpdir(), "streetlight-health-auth-"));
  const address = server.address();
  const output = path.join(directory, "health.json");
  const env = {
    OPS_READ_TOKEN: "test-ops-token",
    STREETLIGHT_BASE_URL: `http://127.0.0.1:${address.port}`,
    STREETLIGHT_ERROR_STREAM_HEALTH_ARTIFACT: output,
    STREETLIGHT_ERROR_STREAM_HEALTH_STATE_FILE: path.join(directory, "state.json"),
    STREETLIGHT_ERROR_STREAM_HEALTH_RETRY_DELAY_MS: "0",
  };

  const first = await runNode(fileURLToPath(new URL("./run-health.mjs", import.meta.url)), env);
  const firstArtifact = JSON.parse(await readFile(output, "utf8"));
  const second = await runNode(fileURLToPath(new URL("./run-health.mjs", import.meta.url)), env);
  const secondArtifact = JSON.parse(await readFile(output, "utf8"));

  assert.equal(first.code, 0);
  assert.equal(firstArtifact.reason, "auth_failed");
  assert.equal(firstArtifact.upstreamStatus, 401);
  assert.equal(typeof firstArtifact.upstreamLatencyMs, "number");
  assert.equal(firstArtifact.consecutiveFailures, 1);
  assert.equal(second.code, 1);
  assert.equal(secondArtifact.consecutiveFailures, 2);
});

test("installer refuses to launch before Sentinel admits the item", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "streetlight-health-install-"));
  const installScript = fileURLToPath(new URL("./install.sh", import.meta.url));
  const result = await runCommand("bash", [installScript], { HOME: home });

  assert.equal(result.code, 2);
  assert.match(result.stderr, /not admitted in the authoritative Sentinel registry/);
});
