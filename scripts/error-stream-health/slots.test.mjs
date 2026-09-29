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

test("a missed slot followed by a successful run does not page", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "health-missed-recovered-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const result = await exec("python3", ["-c", `
import importlib.util, json, os
from pathlib import Path
s = importlib.util.spec_from_file_location('slots', 'scripts/error-stream-health/slots.py')
m = importlib.util.module_from_spec(s)
s.loader.exec_module(m)
root = Path(os.environ['STREETLIGHT_ERROR_STREAM_HEALTH_STATE_ROOT'])
root.mkdir(parents=True, exist_ok=True)
(root / 'slots-state.json').write_text(json.dumps({'slot': 300, 'pending': False}))
m.time.time = lambda: 900
checkins = []
def fake_bounded(command, seconds):
    if command[:1] == ['/bin/bash'] and len(command) >= 3 and command[2] == '--worker':
        return 0
    return 0
m.bounded = fake_bounded
assert m.main('synthetic-worker') == 1
assert checkins == []
state = json.loads((root / 'slots-state.json').read_text())
assert state['overloadConsecutiveFailures'] == 0
assert state['overloadFirstObservedAt'] is None
`], { env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1", STREETLIGHT_ERROR_STREAM_HEALTH_STATE_ROOT: root } });
  assert.equal(result.stderr, "");
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
first_state = json.loads((root / 'slots-state.json').read_text())
assert first_state['slot'] == 600 and first_state['pending'] is False
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

test("overload or unavailable-sample timeouts stay quiet, then page after 60 minutes", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "health-overload-policy-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const result = await exec("python3", ["-c", `
import importlib.util, json, os
from pathlib import Path
s = importlib.util.spec_from_file_location('slots', 'scripts/error-stream-health/slots.py')
m = importlib.util.module_from_spec(s)
s.loader.exec_module(m)
worker = str(Path('scripts/error-stream-health/run-error-stream-health.sh').resolve())
artifact = Path(os.environ['STREETLIGHT_ERROR_STREAM_HEALTH_STATE_ROOT']) / 'artifact.json'
os.environ['STREETLIGHT_ERROR_STREAM_HEALTH_ARTIFACT'] = str(artifact)
clock = [900]
m.time.time = lambda: clock[0]
m.host_overload_sample = lambda worker: ({'load1': 100, 'load5': 100, 'load15': 100, 'cpuCount': 10}, True)
checkins = []
def fake_bounded(command, seconds):
    if len(command) >= 3 and command[1] == worker and command[2] == '--worker':
        return 124
    if len(command) > 5 and command[5] == 'red':
        checkins.append(command)
        Path(command[8]).write_text('confirmed')
    return 0
m.bounded = fake_bounded

# The first overload-only timeout is recorded locally without a red check-in.
assert m.main(worker) == 124
assert checkins == []
lines = [json.loads(line) for line in (Path(os.environ['STREETLIGHT_ERROR_STREAM_HEALTH_STATE_ROOT']) / 'slots.jsonl').read_text().splitlines()]
assert lines[-1]['reason'] == 'host_overloaded'
assert lines[-1]['underlyingReason'] == 'deadline_exceeded'

# Twelve more five-minute failures cross 60 minutes. Exactly that crossing pages.
for _ in range(12):
    clock[0] += 300
    assert m.main(worker) == 124
assert len(checkins) == 1
assert 'has not succeeded for 60 minutes' in checkins[0][-1]
clock[0] += 300
assert m.main(worker) == 124
assert len(checkins) == 1

# A success resets the episode; a later genuine (not overloaded) timeout pages normally.
def successful_worker(command, seconds):
    if len(command) >= 3 and command[1] == worker and command[2] == '--worker':
        artifact.write_text(json.dumps({'status': 'ok', 'consecutiveFailures': 0}))
        return 0
    return 0
m.bounded = successful_worker
clock[0] += 300
assert m.main(worker) == 0
m.host_overload_sample = lambda worker: ({'load1': 5, 'load5': 5, 'load15': 5, 'cpuCount': 10}, False)
m.bounded = fake_bounded
clock[0] += 300
assert m.main(worker) == 124
assert len(checkins) == 2

# A failed load sample is unknown, not healthy: it stays quiet initially and
# still pages if the job has not recovered for 60 minutes.
m.bounded = successful_worker
clock[0] += 300
assert m.main(worker) == 0
m.host_overload_sample = lambda worker: (None, False)
m.bounded = fake_bounded
clock[0] += 300
assert m.main(worker) == 124
assert len(checkins) == 2
for _ in range(12):
    clock[0] += 300
    assert m.main(worker) == 124
assert len(checkins) == 3
lines = [json.loads(line) for line in (Path(os.environ['STREETLIGHT_ERROR_STREAM_HEALTH_STATE_ROOT']) / 'slots.jsonl').read_text().splitlines()]
assert lines[-2]['reason'] == 'host_load_unavailable'
assert lines[-2]['overloadDurationMinutes'] == 60

# If the shared policy helper fails, fail closed and page the deadline.
m.host_overload_sample = lambda worker: ({'load1': 100, 'load5': 100, 'load15': 100, 'cpuCount': 10}, True)
m.next_overload_episode = lambda *args, **kwargs: None
clock[0] += 300
assert m.main(worker) == 124
assert len(checkins) == 4
`], {
    env: {
      ...process.env,
      PYTHONDONTWRITEBYTECODE: "1",
      STREETLIGHT_ERROR_STREAM_HEALTH_STATE_ROOT: root,
      SENTINEL_MAIL_RED_DISABLED: "1",
    },
  });
  assert.equal(result.stderr, "");
});

test("each load-susceptible worker path suppresses one failure and recovery but pages at 60 minutes", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "health-worker-policy-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const result = await exec("python3", ["-c", `
import importlib.util, json, os
from pathlib import Path
s = importlib.util.spec_from_file_location('slots', 'scripts/error-stream-health/slots.py')
m = importlib.util.module_from_spec(s)
s.loader.exec_module(m)
base = Path(os.environ['STREETLIGHT_ERROR_STREAM_HEALTH_STATE_ROOT'])
worker = str(Path('scripts/error-stream-health/run-error-stream-health.sh').resolve())
paths = [
    ('health_runner_failed', 22, None),
    ('secret_provider_failed', 23, None),
    ('secret_rate_limited', 24, None),
    ('request_timeout', 1, 'request_timeout'),
    ('network_error', 1, 'network_error'),
]

for name, exit_code, artifact_reason in paths:
    path_root = base / name
    path_root.mkdir(parents=True)
    os.environ['STREETLIGHT_ERROR_STREAM_HEALTH_STATE_ROOT'] = str(path_root)
    artifact_path = path_root / 'artifact.json'
    os.environ['STREETLIGHT_ERROR_STREAM_HEALTH_ARTIFACT'] = str(artifact_path)
    clock = [900]
    m.time.time = lambda: clock[0]
    mode = ['failure']
    failures = [0]
    red = []

    def fake_bounded(command, seconds):
        if len(command) >= 3 and command[1] == worker and command[2] == '--worker':
            if mode[0] == 'success':
                artifact_path.write_text(json.dumps({'status': 'ok', 'consecutiveFailures': 0}))
                return 0
            failures[0] += 1
            if artifact_reason is not None:
                artifact_path.write_text(json.dumps({
                    'status': 'error',
                    'reason': artifact_reason,
                    'consecutiveFailures': failures[0],
                }))
                return 0 if failures[0] == 1 else exit_code
            artifact_path.unlink(missing_ok=True)
            return exit_code
        if len(command) > 5 and command[5] == 'red':
            red.append(command)
            Path(command[8]).write_text('confirmed')
        return 0

    m.bounded = fake_bounded
    m.host_overload_sample = lambda worker: (None, False)

    m.main(worker)
    assert red == [], name

    mode[0] = 'success'
    clock[0] += 300
    assert m.main(worker) == 0
    assert red == [], name
    state = json.loads((path_root / 'slots-state.json').read_text())
    assert state['overloadFirstObservedAt'] is None, name

    mode[0] = 'failure'
    failures[0] = 0
    clock[0] += 300
    m.main(worker)
    for _ in range(12):
        clock[0] += 300
        m.main(worker)
    assert len(red) == 1, name
    assert 'has not succeeded for 60 minutes' in red[0][9], name

os.environ['STREETLIGHT_ERROR_STREAM_HEALTH_STATE_ROOT'] = str(base)
`], {
    env: {
      ...process.env,
      PYTHONDONTWRITEBYTECODE: "1",
      STREETLIGHT_ERROR_STREAM_HEALTH_STATE_ROOT: root,
      SENTINEL_MAIL_RED_DISABLED: "1",
    },
  });
  assert.equal(result.stderr, "");
});

test("genuine worker breakage still pages immediately", async () => {
  const result = await exec("python3", ["-c", `
import importlib.util
s = importlib.util.spec_from_file_location('slots', 'scripts/error-stream-health/slots.py')
m = importlib.util.module_from_spec(s)
s.loader.exec_module(m)
for code, reason in [(20, 'runtime_unavailable'), (21, 'artifact_unreadable')]:
    observed = m.classify_worker_result(code, None)
    assert observed['immediatePage'] is True
    assert observed['failureReason'] == reason
assert m.classify_worker_result(2, {'status': 'failed'})['immediatePage'] is True
assert m.classify_worker_result(1, {'status': 'error', 'reason': 'auth_failed', 'consecutiveFailures': 2})['immediatePage'] is True
`], { env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" } });
  assert.equal(result.stderr, "");
});
