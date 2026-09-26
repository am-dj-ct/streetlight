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

test("boundary crossing leaves the next slot open and accounts for it if later skipped", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "health-boundary-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await exec("python3", ["-c", `
import importlib.util, json, os
from pathlib import Path
s = importlib.util.spec_from_file_location('slots', 'scripts/error-stream-health/slots.py')
m = importlib.util.module_from_spec(s)
s.loader.exec_module(m)
root = Path(os.environ['STREETLIGHT_ERROR_STREAM_HEALTH_STATE_ROOT'])
clock = [899]
m.time.time = lambda: clock[0]
def worker(command, seconds):
    clock[0] = 901
    return 0
m.bounded = worker
assert m.main('synthetic-worker') == 0
assert json.loads((root / 'slots-state.json').read_text()) == {'slot': 600, 'pending': False}
assert not any(json.loads(line)['status'] == 'missed' for line in (root / 'slots.jsonl').read_text().splitlines())
# A delayed next invocation still gets its own normal record.
m.bounded = lambda command, seconds: 0
assert m.main('synthetic-worker') == 0
assert json.loads((root / 'slots-state.json').read_text())['slot'] == 900
# If that invocation never arrived, the next run must report it as missed.
(root / 'slots-state.json').write_text(json.dumps({'slot': 600, 'pending': False}))
clock[0] = 1201
assert m.main('synthetic-worker') == 1
missed = [json.loads(line) for line in (root / 'slots.jsonl').read_text().splitlines() if json.loads(line)['status'] == 'missed']
assert len(missed) == 1 and missed[0]['slot'] == m.iso(900)
assert missed[0]['reason'] == 'not_invoked_or_host_unavailable'
`], { env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1", STREETLIGHT_ERROR_STREAM_HEALTH_STATE_ROOT: root } });
});
