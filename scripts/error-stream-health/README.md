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
