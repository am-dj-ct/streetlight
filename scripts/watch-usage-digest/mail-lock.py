"""Serialize sends with an OS lock; no stale lock survives a crash."""
import fcntl
import os
import subprocess
import sys
import time


def main(root, command, timeout=60):
    with open(os.path.join(root, 'mail.lock'), 'a') as lock:
        deadline = time.monotonic() + timeout
        while True:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    print(f'digest-watch: mail_lock_timeout after {timeout:g} seconds', file=sys.stderr)
                    return 1
                time.sleep(min(0.1, remaining))
        return subprocess.call(command)


if __name__ == '__main__':
    sys.exit(main(sys.argv[1], sys.argv[2:]))
