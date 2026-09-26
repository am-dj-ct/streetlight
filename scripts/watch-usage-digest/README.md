# Usage digest ran watcher

One local watcher checks only `usage-digest.yml`. No Resource Review watcher.
At 22:00 local time (host must remain Pacific), `gh run list` must contain a
completed successful run created on today's Pacific date. The query includes
both UTC dates that overlap that day, then filters in America/Los_Angeles,
including daylight saving changes. The 16:00 UTC digest belongs to the same
Pacific date. A successful manual run counts; a failed later rerun does not
invalidate an earlier success. This proves workflow success, not inbox delivery.

GitHub errors/timeouts (`gh_failed`), malformed results (`invalid_runs`), and no
success (`missing_success`) fail separately. Only failures send mail, using
`doppler run -p agent-secrets -c dev`, from notifications@alerts.ctpipeline.com
to jesse@balancedlivingtherapy.com. Addresses are fixed in the sender.

`~/.streetlight/digest-watch/checks.jsonl` stores fixed reasons and timestamps.
`receipts.jsonl` stores timestamp, job, reason, HTTP status, and Resend UUID only.
No raw provider output, keys, or email bodies are logged. HTTP acceptance is not
proof that the recipient opened the message. The temporary fixed email body is
removed after sending. The OS lock serializes sends; one six-hour cooldown covers
all failure reasons for this item. Attempts reserve the cooldown before sending,
including ambiguous failures, to prevent duplicate email. A local error exits 1.

`bash scripts/watch-usage-digest.sh --test` forces one `[TEST]` failure email,
shares the cooldown, and saves a permanent `test-attempted` marker. Repeating it
cannot send another test. Normal invocation is `bash scripts/watch-usage-digest.sh`.
Tests use an isolated `STREETLIGHT_DIGEST_WATCH_STATE_ROOT`; do not change it in
production. Node, Python 3, Doppler, and authenticated `gh` must be on PATH.

## Coordinator installation after review and merge

Wait for the supported autodeploy to update the live checkout; never hand-pull it.
Confirm the Mac's system timezone is America/Los_Angeles (`TZ` alone does not
change launchd's calendar). Create `~/.streetlight/digest-watch`, copy this plist
to `~/Library/LaunchAgents/com.jesse.streetlight-usage-digest-watch.plist`, then:

```sh
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.jesse.streetlight-usage-digest-watch.plist
```

No RunAtLoad and no extra watcher. No installation was performed by Lane B.
The existing error-stream-health plist needs no reinstall: its unchanged entry
script now starts the slot supervisor after the normal autodeploy updates it.

## Verification

```sh
node --test scripts/watch-usage-digest/*.test.mjs scripts/error-stream-health/*.test.mjs
```

Before landing, the coordinator must reconcile the architecture dates and add a
shared dated decision under `docs/decisions/` for both lanes' content-free receipt
and local monitoring changes. Lane B keeps edits inside its assigned files;
this note does not replace the architecture document's required decision entry.
