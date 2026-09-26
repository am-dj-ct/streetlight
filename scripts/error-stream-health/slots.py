"""Account for every five-minute slot after installation, without replaying health.

launchd cannot run while asleep and can coalesce calendar events. The next
invocation records each absent slot as missed. A whole-run deadline also bounds
Doppler and reporting, beyond run-health.mjs's per-fetch deadline.
"""
import datetime
import fcntl
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time


def iso(epoch):
    return datetime.datetime.fromtimestamp(epoch, datetime.timezone.utc).isoformat().replace('+00:00', 'Z')


def missed_slots(previous, current):
    return range(previous + 300, current, 300)


def bounded(command, seconds):
    child = subprocess.Popen(command, start_new_session=True)
    try:
        return child.wait(timeout=seconds)
    except subprocess.TimeoutExpired:
        os.killpg(child.pid, signal.SIGKILL)
        child.wait()
        return 124


def main(worker):
    os.umask(0o077)
    root = Path(os.environ.get('STREETLIGHT_ERROR_STREAM_HEALTH_STATE_ROOT', str(Path.home() / '.streetlight/error-stream-health')))
    root.mkdir(parents=True, exist_ok=True)
    os.environ['STREETLIGHT_SENTINEL_FALLBACK_LOG'] = str(root / 'sentinel-v5-fallback.log')
    cursor = root / 'slots-state.json'

    def record(slot, status, reason, **extra):
        line = json.dumps(dict(timestamp=iso(time.time()), slot=iso(slot), status=status, reason=reason, **extra), separators=(',', ':'))
        with (root / 'slots.jsonl').open('a') as out:
            out.write(line + '\n')
            out.flush()
            os.fsync(out.fileno())
        print('HEALTH_SLOT ' + line, flush=True)

    def save(slot, pending):
        temp = root / 'slots-state.tmp'
        temp.write_text(json.dumps(dict(slot=slot, pending=pending)))
        temp.replace(cursor)

    slot = int(time.time()) // 300 * 300
    with (root / 'slots.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            record(slot, 'missed', 'overlapping_invocation')
            return 1
        missed = False
        if cursor.exists():
            previous = json.loads(cursor.read_text())
            if previous['pending']:
                record(previous['slot'], 'missed', 'interrupted_run')
                missed = True
            for absent in missed_slots(previous['slot'], slot):
                record(absent, 'missed', 'not_invoked_or_host_unavailable')
                missed = True
        else:
            record(slot, 'baseline', 'ledger_installed')
        save(slot, True)
        record(slot, 'started', 'scheduled_check')
        started = time.monotonic()
        result = bounded(['/bin/bash', worker, '--worker'], 180)
        record(slot, 'completed' if result == 0 else 'failed', 'deadline_exceeded' if result == 124 else 'worker_exit', exitCode=result, durationSeconds=round(time.monotonic() - started, 3))
        latest = int(time.time()) // 300 * 300
        for absent in range(slot + 300, latest + 1, 300):
            record(absent, 'missed', 'previous_run_still_active')
            missed = True
        save(max(slot, latest), False)
        if missed or result == 124:
            # Existing mail path, with its per-item cooldown and Lane A receipts.
            library = str(Path(worker).parent.parent / 'sentinel-v5/checkin-lib.sh')
            bounded(['/bin/bash', '-c', '. "$1"; sentinel_checkin sl-error-stream-health red job_failed "$2" "$2"', 'slot-alert', library, iso(slot)], 45)
        return result if result else int(missed)


if __name__ == '__main__':
    try:
        sys.exit(main(sys.argv[1]))
    except Exception:
        # Never print raw operational/provider exceptions.
        print('error-stream-health: slot_ledger_or_runner_failed', file=sys.stderr)
        sys.exit(1)
