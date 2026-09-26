# Alert receipts, missed health slots, and the usage digest watcher

**Date:** 2026-09-26
**Status:** Accepted for implementation; deployment follows review and merge.

## Context and prior decisions

The Sentinel spool consumer was retired on 2026-09-24. Writing a red check-in
to that spool no longer delivers an alert. The existing check-in helper now
sends red directly through Resend, with a six-hour per-item cooldown; legacy
spool writes are not evidence that a human was notified.

The [daily digest decision](2026-07-09-daily-usage-digest.md) authorizes aggregate
usage email. The [local health polling decision](2026-07-12-operator-owned-local-health-polling.md)
limits dashboard observations to safe operational metadata. The
[stream-health decision](2026-08-23-same-day-error-stream-health.md) permits
count-only health polling. These decisions need explicit extensions for email
acceptance receipts, missed-slot accounting, and a single failure-only digest
watcher. The UI-sentry reporting ADR and implementation are updated separately
by Lane A; this decision does not change that job's execution or live-turn rules.

## Options considered

- Keep spool-only reporting and infer delivery from process success. Rejected:
  the retired consumer cannot deliver alerts, and neither a process exit nor a
  provider acceptance proves inbox delivery.
- Add hosted monitoring or a watcher for every scheduled workflow. Rejected:
  unnecessary infrastructure and alert noise; Resource Review intentionally
  skips alternate weeks and only emails when review flags exist.
- Keep existing mail delivery, record strictly allowlisted receipts, account
  for missing health slots locally, and add one digest watcher. Chosen.

## Decision

### Content-free receipts

The shared sender for Usage Digest and Resource Review records only
`timestamp`, fixed `job`, numeric `httpStatus` (or null), and validated Resend
message UUID `resendId` (or null). The digest watcher additionally records a
fixed `reason`: `test_failure`, `missing_success`, `gh_failed`, or `invalid_runs`.
Each attempt reaching the sender writes JSONL and an `EMAIL_RECEIPT` console
line; GitHub runs also append the same allowlisted record to the step summary
and upload a separate receipt artifact with 90-day retention. Workflow logs
and summaries follow the repository's existing GitHub retention settings.
A run that skips or never reaches sending has no receipt.

These receipts contain **no user content**: no messages, model replies,
classifier input, TTS text, request bodies, email subject/body/addresses,
credentials, raw provider responses, or raw exceptions. They comply with the
no-content-logging non-negotiable. A validated UUID and successful HTTP status
prove provider acceptance only, not inbox delivery or reading. Existing digest
aggregate bodies and public resource checklists are unchanged.

### Error-stream missed-slot ledger

The five-minute job enters `scripts/error-stream-health/slots.py` before
loading secrets. A local advisory lock prevents overlapping workers. Under
`~/.streetlight/error-stream-health/`, `slots.jsonl` records only timestamps,
slot time, fixed status and reason, and (on completion) numeric exit code and
duration. An atomic `slots-state.json` cursor records slot time and whether
that run is pending. Neither file stores the endpoint body or user content.

The next invocation records interrupted and uninvoked slots without replaying
health requests or inventing successful measurements. Completion backfills
only slots before the current five-minute slot, leaving the current slot and
its cursor unclaimed for the next invocation. A whole-worker deadline of
180 seconds covers Doppler and reporting and kills a stuck process group.
Missed slots and deadline failures use the existing direct red-email path and
its six-hour cooldown, not a new watcher or mail transport. Slot-alert reporting
is bounded to 45 seconds. An asleep or stopped host can only report gaps after
resuming; history before ledger installation cannot be reconstructed.

### One digest-ran watcher

`com.jesse.streetlight-usage-digest-watch` is a local launchd calendar job at
22:00 Pacific time, with no RunAtLoad. The host timezone must be
America/Los_Angeles; setting only the process's `TZ` does not move launchd's
calendar. It runs `gh run list` for `usage-digest.yml`, fetching only
`createdAt`, `status`, and `conclusion` across the UTC dates intersecting the
Pacific day, then filters by that Pacific date. Any completed success,
including a manual run, satisfies the check; a later failed rerun does not
invalidate it. GitHub query failure, invalid metadata, or no success produces
a fixed failure reason. Healthy checks send nothing.

Only failures send through the existing Resend service, from
notifications@alerts.ctpipeline.com to jesse@balancedlivingtherapy.com.
Credentials are loaded through Doppler at runtime. A six-hour cooldown is
reserved before each real send attempt, including ambiguous failures. A
separate `last-test-attempt.json` marker and permanent `test-attempted` marker
make test sends one-shot and unable to suppress real failures. The OS mail
lock retries non-blocking acquisition for at most 60 seconds, then exits
nonzero with a fixed timeout diagnostic. The outer 130-second deadline allows
both that wait and the bounded 60-second sender subprocess.

Under `~/.streetlight/digest-watch/`, `checks.jsonl` retains only timestamp,
Pacific date, and fixed reason; `receipts.jsonl` uses the receipt allowlist
above; cooldown markers hold timestamps only. These local operational files
and the slot ledger have no automatic expiry and remain until operator cleanup.
The fixed diagnostic email body exists temporarily and is removed in the send
finalizer; abrupt host/process death may leave that content-free file behind.
No GitHub workflow output or raw response body is retained.

### Deliberately not watched

Resource Review gets acceptance receipts only when its existing conditional
mail step runs. No new Resource Review watcher, schedule, failure email, or
missed-run alarm is added. Earlier read-only dashboard authorization does not
imply a new active Resource Review alert. This watcher does not query usage,
chat, TTS, or other user-connected routes, dispatch workflows, repair jobs,
or introduce a new vendor. It also cannot independently detect its own host's
death. Installation is a separate coordinator action after merge, not part of
Lane B's review-fix work.
