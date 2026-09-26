# Error-stream health watcher

Every five minutes this local job requests Streetlight's authenticated,
count-only 60-minute health summary. It writes
`~/.blt-hub/source-health/streetlight-error-stream-health.json` atomically and
emits the `sl-error-stream-health` Sentinel check-in for the same slot.

The artifact is `failed` only when at least one interaction exists and more
than half of interactions in the window ended `error_stream`. Zero traffic is
healthy. Fetch, authentication, or response-shape failures write `error`
instead with a fixed `reason`, the upstream HTTP status, latency, attempt
count, and the consecutive failure count. No user or model content is
requested, written, or logged.

Transient request failures (`request_timeout`, `network_error`, `rate_limited`,
upstream 5xx, upstream timeout, or an empty response) are retried once after
20 seconds. A first final failure is a yellow `degraded` check-in with the
`rerun_once` repair action and a clean process exit. The second consecutive
final failure is a red `job_failed` check-in with the `escalate` action and the
reason in the local diagnostic line. Any successful read resets the failure
streak.

`OPS_READ_TOKEN` is loaded at runtime from Doppler. Install with `./install.sh`
after the change is merged into the main checkout. The installer first checks
that blt-hub's authoritative Sentinel registry admits the item, then copies
the plist; it deliberately does not load or start it.

## Durable slot accounting (2026-09-26)

The entry script now runs through `slots.py` before loading secrets. Its OS lock
is released automatically on process death. Every invocation writes a timestamped
start and finish to `~/.streetlight/error-stream-health/slots.jsonl`; a separate
atomic cursor identifies an interrupted run and each uninvoked five-minute slot
on the next invocation. Missed health measurements are never fabricated or
backfilled as successful. A stopped/asleep host is observable only on resumption.
The whole worker, including Doppler and reporting, has a 180-second deadline;
a timed-out process group is killed and recorded. Missed slots/timeouts use the
existing red-mail path and its six-hour per-item cooldown. No new mail path.
The existing plist and installer do not need to be reinstalled for this change.
Python 3 must be on launchd's PATH. The ledger starts at first installation;
it cannot reconstruct missing history that the old logs never retained.

### Historical evidence limits

On 2026-09-26 the audit reported absent UTC slots 13:50, 15:05, 15:30, 15:50.
The inspected stdout health lines and stderr fallback lines have no timestamps;
state.json and the source-health artifact overwrite their previous observation.
At 16:35:59.589Z both showed healthy, HTTP 200, one attempt, latency 3103 ms.
`launchctl print` showed all twelve five-minute calendar entries, last exit 0,
1302 runs, and no running process when inspected. The wrapper had no lock and
no whole-run deadline. `pmset -g log` returned no Sleep/Wake/DarkWake records
between 06:35 and 09:00 Pacific. This does not establish a cause for each gap.
`log show` refused with `Cannot run while sandboxed`, so overlap, coalescing,
and delayed scheduling remain unproven. The Doppler rate-limit comment describes
September 4, not evidence that Doppler caused today's gaps. Coordinator can
retrieve the missing launch history read-only with:

```sh
/usr/bin/log show --start '2026-09-26 06:35:00' --end '2026-09-26 09:00:00' --style compact --predicate 'process == "launchd" AND eventMessage CONTAINS "com.streetlight.error-stream-health"'
```
