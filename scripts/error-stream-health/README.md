# Error-stream health watcher

Every five minutes this local job requests Streetlight's authenticated,
count-only 60-minute health summary. It writes
`~/.blt-hub/source-health/streetlight-error-stream-health.json` atomically and
emits the `sl-error-stream-health` Sentinel check-in for the same slot.

The artifact is `failed` only when at least one interaction exists and more
than half of interactions in the window ended `error_stream`. Zero traffic is
healthy. Fetch, authentication, or response-shape failures write `error`
instead and emit `red/job_failed`; no user or model content is requested,
written, or logged.

`OPS_READ_TOKEN` is loaded at runtime from Doppler. Install with `./install.sh`
after the change is merged into the main checkout. The installer first checks
that blt-hub's authoritative Sentinel registry admits the item, then copies
the plist; it deliberately does not load or start it.
