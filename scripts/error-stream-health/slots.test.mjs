import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
const exec = promisify(execFile);
test("slot ledger records start/completion and every gap, including interrupted run", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "health-slots-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const worker = path.join(root, "worker.sh");
  await writeFile(worker, '#!/bin/bash\nexit 0\n');
  const env = { ...process.env, STREETLIGHT_ERROR_STREAM_HEALTH_STATE_ROOT: root, SENTINEL_MAIL_RED_DISABLED: "1" };
  await exec("python3", ["scripts/error-stream-health/slots.py", worker], { env });
  let lines = (await readFile(path.join(root, "slots.jsonl"), "utf8")).trim().split("\n").map(JSON.parse);
  assert.deepEqual(lines.map((l) => l.status), ["baseline", "started", "completed"]);
  const slot = Math.floor(Date.now() / 300000) * 300;
  await writeFile(path.join(root, "slots-state.json"), JSON.stringify({ slot: slot - 900, pending: true }));
  await exec("python3", ["scripts/error-stream-health/slots.py", worker], { env }).catch((e) => assert.equal(e.code, 1));
  lines = (await readFile(path.join(root, "slots.jsonl"), "utf8")).trim().split("\n").map(JSON.parse);
  assert.deepEqual(lines.filter((l) => l.status === "missed").map((l) => l.reason), ["interrupted_run", "not_invoked_or_host_unavailable", "not_invoked_or_host_unavailable"]);
});
test("whole-run deadline kills a stuck process group", async () => {
  const result = await exec("python3", ["-c", "import importlib.util; s=importlib.util.spec_from_file_location('slots','scripts/error-stream-health/slots.py'); m=importlib.util.module_from_spec(s); s.loader.exec_module(m); print(m.bounded(['/bin/sh','-c','sleep 30'], 0.1))"]);
  assert.equal(result.stdout.trim(), "124");
});
