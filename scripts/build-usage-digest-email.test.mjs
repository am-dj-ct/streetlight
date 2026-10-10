// Runs the real digest builder against a stub usage endpoint and checks the
// UI/UX audit line that ends up in the email body.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const builder = path.join(path.dirname(fileURLToPath(import.meta.url)), "build-usage-digest-email.mjs");

async function buildDigest(auditValue) {
  const server = createServer((request, response) => {
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ days: [{ date: "2026-10-09" }], generatedAt: "2026-10-10T16:00:00Z" }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const dir = mkdtempSync(path.join(tmpdir(), "digest-"));
  const output = path.join(dir, "body.md");
  const env = { ...process.env, OPS_READ_TOKEN: "test-token" };
  delete env.UI_SENTRY_LAST_RESULT;
  if (auditValue !== undefined) env.UI_SENTRY_LAST_RESULT = auditValue;
  try {
    // Async spawn: the stub server lives in this process, so a sync spawn
    // would block the event loop that has to answer the child's request.
    const child = spawn(
      process.execPath,
      [builder, "--output", output, "--baseUrl", `http://127.0.0.1:${server.address().port}`, "--date", "2026-10-09"],
      { env },
    );
    let stderr = "";
    child.stderr.on("data", (chunk) => (stderr += chunk));
    const code = await new Promise((resolve) => child.on("close", resolve));
    assert.equal(code, 0, stderr);
    return readFileSync(output, "utf8");
  } finally {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

test("the digest opens with a PASSED IN FULL audit line when the published result is a full pass", async () => {
  const finishedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const body = await buildDigest(JSON.stringify({
    v: 1, status: "PASS", finishedAt, exitCode: 0,
    tiers: { tier0: "pass", tier1: "pass", tier2: "pass" },
    totalChecks: 50, failedChecks: 0, failedNames: [],
  }));
  const lines = body.split("\n");
  assert.equal(lines[0], "# Streetlight usage digest - 2026-10-09");
  assert.match(lines[2], /^UI\/UX audit: PASSED IN FULL - all 50 checks passed \(run /);
  assert.match(body, /Aggregate counts only/);
});

test("the digest still carries an audit line, saying NO RESULT, when nothing was published", async () => {
  const body = await buildDigest(undefined);
  assert.match(body.split("\n")[2], /^UI\/UX audit: NO RESULT/);
  const garbage = await buildDigest("{{ not json");
  assert.match(garbage.split("\n")[2], /^UI\/UX audit: NO RESULT - the published audit result could not be read/);
});
