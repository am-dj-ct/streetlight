# The UI Sentry Reports Without Email

**Date:** 2026-08-17

Follows and partly supersedes
`docs/decisions/2026-08-07-scheduled-ui-sentry-live-chat-check.md` (the
"every run sends an email" reporting decision and the R12 dead-man gap it
admitted). Everything else in that ADR — the live-chat exception, the turn
budget, the content-free allowlist, the blocked-streak state machine —
stands unchanged.

## Context

The sentry mailed a report on every run, pass or fail, to the operator's
personal inbox. On 2026-08-17 that meant a `Streetlight UI sentry: PASS`
email with a full pass-log body arriving at 07:26 on a Monday. Nothing was
wrong; the job worked. That is the problem — a success notice with no
decision attached in it is pure noise, and the standing rule for this
machine is that automated notifications do not land in the operator's
personal inbox.

Two things changed since 2026-08-07, and together they make the email
redundant rather than merely annoying:

1. **`~/caller-track-pager`'s `checkUiSentry()`** reads
   `~/.streetlight/ui-sentry/last-run.json` and pages on `status: FAIL` or a
   record older than 74h. The staleness half is exactly the "candidate fix"
   the 2026-08-07 ADR listed under "Later" and declined to build — it exists
   now, so the R12 gap is covered from outside the sentry.
2. **Sentinel-v5 check-ins.** `sl-ui-sentry` (green/`ok` or red/`job_failed`
   from the run's own exit code) and `sl-ui-sentry-live-chat` (green/`ok` or
   red/`degraded` from the age of `lastSuccessfulLiveChatAt`) are both live
   registry items — `shadow: false`, `enabled: true`, digest escalation, a
   45-minute grace window — so a slot that never checks in is itself
   reported.

A green sentinel check-in *is* the success signal. The PASS email was a
second, worse copy of it.

## Options

**A. Keep the email, suppress only PASS.** Stops the noise. Leaves failure
mail going to the personal inbox, which is the thing the standing rule
forbids, and leaves a mail path in a job that no longer needs one.

**B. Route failure mail to the sentinel mailbox** (`sentinel@…`), matching
how the BLT senders escalate. Not deliverable from this repo. The shared
`RESEND_API_KEY` has no verified sending domain, so the sandbox
`onboarding@resend.dev` sender is in play, and Resend restricts that sender
to the account's own registered address — confirmed empirically as a 403
("You can only send testing emails to your own email address"). The only
other credential on this machine that could send to `sentinel@` is a BLT
tenant Graph app, and wiring BLT tenant credentials into a public
good/open-source project is not a trade this ADR is willing to make.

**C. Remove the mail path.** Report by writing: the headline and tier table
go to the run log, the verdict to `last-run.json`. Both monitors above
already read those.

## Decision

**C.** The sentry sends no email on any path — not on PASS, not on FAIL,
not from the PATH-preflight fallback in `run-ui-sentry.sh` (which could only
ever have reached the personal inbox and, because `RESEND_API_KEY` is
sourced through the very `doppler` that path has just found missing,
essentially never fired anyway).

Concretely:

- `orchestrator.mjs` writes `buildSubject(...)` and `buildReportBody(...)`
  into the run log inside the same one finalizer path (R13) that used to
  send the email. Every ending — pass, fail, crash, signal — still produces
  a report.
- `lib/email.mjs` is deleted. `buildEmailBody` is renamed `buildReportBody`;
  it is byte-for-byte the same content-free body, so no diagnostic detail is
  lost, only its delivery channel.
- `last-run.json` drops `emailAccepted` and `emailHttpStatus`. No consumer
  reads them (`checkUiSentry()` reads `status`, `finishedAt`, `startedAt`).
- A source-level test (`ui-sentry.test.mjs`) fails if any executable mail
  reference reappears anywhere under `scripts/ui-sentry/`. A mail path
  reintroduced there would be reachable from the scheduled run whether or
  not a behavioral test happened to cover that branch, so the guard is on
  the source rather than on one code path.

## Reasoning

The sentry's job is to *know* something and record it. Delivery is a
separate concern, and this machine already has two systems whose whole
purpose is delivery — one that pages for an outage, one that folds a red
check-in into a digest. A third channel owned by the observed job itself was
always the weakest of the three: it could not report its own death (the
admitted R12 gap), it required a vendor and a live API key on the critical
path, and it delivered to a channel that gets skimmed.

Removing it also removes the last hardcoded personal email address from this
repo.

## Costs and what this does not do

- **Failure detail is one step further away.** A red run's tier table is in
  `~/.streetlight/ui-sentry/logs/<timestamp>.log` rather than in an inbox.
  The pager message and the sentinel reason code say *that* the run failed,
  not *which case*; diagnosing still means opening the log. Accepted: that
  is one `ls -t` away on the machine that ran it, and the check-in already
  carries enough to know whether to go look.
- **No new channel is built here.** If the sentry should ever escalate on
  its own again, that needs a sender that can deliver somewhere other than
  the operator's personal inbox — a verified Resend domain for this project,
  or a non-BLT Graph identity — and a dated ADR.
- The live-chat exception, turn budget, cadence, content allowlist, and
  blocked-streak escalation semantics are untouched.
