"""Account for every five-minute slot after installation, without replaying health.

launchd cannot run while asleep and can coalesce calendar events. The next
invocation records each absent slot as missed. A whole-run deadline also bounds
Doppler and reporting, beyond run-health.mjs's per-fetch deadline.
"""
import datetime
import fcntl
import json
import math
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


def host_overload_sample(worker):
    cli = Path(worker).parent.parent / 'lib/host-overload-cli.mjs'
    try:
        result = subprocess.run(
            ['node', str(cli), 'sample'],
            check=True,
            capture_output=True,
            text=True,
            timeout=5,
        )
        value = json.loads(result.stdout)
        sample = value['sample']
        if (
            not isinstance(sample, dict)
            or not math.isfinite(sample.get('load1', math.nan))
            or not math.isfinite(sample.get('cpuCount', math.nan))
            or sample['cpuCount'] <= 0
        ):
            return None, False
        return sample, value['overloaded'] is True
    except Exception:
        # Unknown is distinct from healthy. The caller keeps an unavailable
        # sample on the same sustained, recovery-aware path as overload.
        return None, False


def next_overload_episode(worker, previous, now, overloaded_failure, success):
    cli = Path(worker).parent.parent / 'lib/host-overload-cli.mjs'
    payload = json.dumps(dict(
        previous=previous,
        now=iso(now),
        overloadedFailure=overloaded_failure,
        success=success,
        thresholdMinutes=60,
    ))
    try:
        result = subprocess.run(
            ['node', str(cli), 'episode'],
            input=payload,
            check=True,
            capture_output=True,
            text=True,
            timeout=5,
        )
        return json.loads(result.stdout)
    except Exception:
        # Streak-state failure must not turn a real deadline into silence.
        return None


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

    def save(slot, pending, episode):
        temp = root / 'slots-state.tmp'
        temp.write_text(json.dumps(dict(slot=slot, pending=pending, **episode)))
        temp.replace(cursor)

    slot = int(time.time()) // 300 * 300
    with (root / 'slots.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            record(slot, 'missed', 'overlapping_invocation')
            return 1
        missed = False
        missed_slot_values = []
        previous = {}
        if cursor.exists():
            previous = json.loads(cursor.read_text())
            if previous['pending']:
                record(previous['slot'], 'missed', 'interrupted_run')
                missed = True
                missed_slot_values.append(previous['slot'])
            for absent in missed_slots(previous['slot'], slot):
                record(absent, 'missed', 'not_invoked_or_host_unavailable')
                missed = True
                missed_slot_values.append(absent)
        else:
            record(slot, 'baseline', 'ledger_installed')
        prior_episode = {
            key: previous.get(key)
            for key in (
                'overloadFirstObservedAt',
                'overloadLastObservedAt',
                'overloadConsecutiveFailures',
                'overloadEscalationActive',
                'overloadDurationMinutes',
            )
        }
        save(slot, True, prior_episode)
        record(slot, 'started', 'scheduled_check')
        started = time.monotonic()
        result = bounded(['/bin/bash', worker, '--worker'], 180)
        load_sample, host_overloaded = host_overload_sample(worker) if result == 124 else (None, False)
        load_sample_unavailable = result == 124 and load_sample is None
        deferred_failure = result == 124 and (host_overloaded or load_sample_unavailable)
        failure_class = (
            'host_overloaded' if result == 124 and host_overloaded
            else 'host_load_unavailable' if load_sample_unavailable
            else None
        )

        latest = int(time.time()) // 300 * 300
        # Leave the current slot open: its invocation may still be arriving.
        trailing_missed_slots = list(missed_slots(slot, latest))
        if trailing_missed_slots:
            missed = True
            missed_slot_values.extend(trailing_missed_slots)

        episode_previous = prior_episode
        if deferred_failure and missed_slot_values and not prior_episode.get('overloadFirstObservedAt'):
            episode_previous = dict(prior_episode)
            episode_previous['overloadFirstObservedAt'] = iso(min(missed_slot_values))
        episode = next_overload_episode(
            worker,
            episode_previous,
            slot,
            overloaded_failure=deferred_failure,
            success=result == 0,
        )
        episode_state_failed = episode is None
        if episode_state_failed:
            deferred_failure = False
            failure_class = None
            episode = dict(
                overloadFirstObservedAt=None,
                overloadLastObservedAt=None,
                overloadConsecutiveFailures=0,
                overloadEscalationActive=False,
                overloadDurationMinutes=0,
                shouldPage=False,
            )
        failure_reason = failure_class or ('deadline_exceeded' if result == 124 else 'worker_exit')
        record(
            slot,
            'completed' if result == 0 else 'failed',
            failure_reason,
            exitCode=result,
            durationSeconds=round(time.monotonic() - started, 3),
            underlyingReason='deadline_exceeded' if deferred_failure else None,
            hostLoad=load_sample,
            overloadDurationMinutes=episode['overloadDurationMinutes'],
            overloadConsecutiveFailures=episode['overloadConsecutiveFailures'],
            overloadPageRequested=episode['shouldPage'],
        )
        for absent in trailing_missed_slots:
            record(absent, 'missed', 'previous_run_still_active')
        save(max(slot, latest - 300), False, episode)
        should_page_deferred = deferred_failure and episode['shouldPage']
        genuine_timeout = result == 124 and (
            episode_state_failed or (load_sample is not None and not host_overloaded)
        )
        if genuine_timeout or should_page_deferred:
            # Existing mail path, with its per-item cooldown and Lane A receipts.
            library = str(Path(worker).parent.parent / 'sentinel-v5/checkin-lib.sh')
            detail = ''
            if should_page_deferred:
                minutes = episode['overloadDurationMinutes']
                detail = f'The job has not succeeded for {minutes} minutes; scheduled runs were missed or timed out while host load was overloaded or unavailable.'
            mail_result = root / 'overload-mail-result.tmp'
            mail_result.unlink(missing_ok=True)
            bounded([
                '/bin/bash', '-c',
                'export SENTINEL_MAIL_RED_RESULT_FILE="$4"; . "$1"; sentinel_checkin sl-error-stream-health red job_failed "$2" "$2" "$3"',
                'slot-alert', library, iso(slot), detail, str(mail_result),
            ], 45)
            if should_page_deferred:
                delivery = mail_result.read_text().strip() if mail_result.exists() else 'unknown'
                if delivery in ('confirmed', 'uncertain'):
                    episode['overloadEscalationActive'] = True
                    save(max(slot, latest - 300), False, episode)
                record(slot, 'alert', 'host_overload_page_' + delivery, overloadDurationMinutes=episode['overloadDurationMinutes'])
            mail_result.unlink(missing_ok=True)
        return result if result else int(missed)


if __name__ == '__main__':
    try:
        sys.exit(main(sys.argv[1]))
    except Exception:
        # Never print raw operational/provider exceptions.
        print('error-stream-health: slot_ledger_or_runner_failed', file=sys.stderr)
        sys.exit(1)
