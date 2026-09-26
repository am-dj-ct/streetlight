"""Serialize sends with an OS lock; no stale lock survives a crash."""
import fcntl
import os
import subprocess
import sys

with open(os.path.join(sys.argv[1], 'mail.lock'), 'a') as lock:
    fcntl.flock(lock, fcntl.LOCK_EX)
    sys.exit(subprocess.call(sys.argv[2:]))
