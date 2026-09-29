# Host overload does not page as an application failure

**Date:** 2026-09-28
**Status:** Accepted

## Context

The five-minute `sl-error-stream-health` supervisor repeatedly reached its
180-second deadline while this 10-core Mac had load averages around 25-150.
The application was healthy before and after those episodes, but every timeout
used the same red-mail path as a real Streetlight failure. The UI sentry already
recorded failure-time host load, but still turned that evidence into a red page.

## Decision

Both watchers use one shared host-load implementation: one-minute load strictly
greater than three times the CPU count is overloaded.

An error-stream run is `host_overloaded` only when the whole-run result is the
deadline exit `124` and the failure-time host sample exceeds that threshold.
The supervisor records the classification, the underlying
`deadline_exceeded`, numeric load sample, and overload-episode counters in its
content-free slot log and atomic slot state. It does not send red mail for that
run. Missed slots and every non-overload failure retain their existing behavior.

A UI-sentry run is `host_overloaded` only when every tier-1 failure is a typed
timeout and every failure-time sample is overloaded. Its raw verdict remains
`observedLevel: FAIL`, while the alert-facing `status`/`overallLevel` is
`DEGRADED`; this prevents both the Sentinel red email and the separate local
pager from treating host load as an application failure. Mixed, missing, and
non-timeout failures remain `FAIL`.

Both watchers track a content-free overload episode. The first 60 minutes are
non-paging. The first failed scheduled run at or beyond 60 minutes pages once,
saying how long the job has not succeeded and that overload was observed on
every failed scheduled run. Later overload-only failures stay quiet after
confirmed or uncertain delivery. A successful run resets the episode; a
genuine non-overload failure pages immediately and ends that consecutive-
overload episode. Cooldown, rejection, or pre-send failure leaves the sustained
alert pending for the next scheduled attempt. The UI sentry's daily cadence means a second
consecutive daily overload run crosses the same threshold; the wording does not
claim continuous observation between scheduled runs.

## 2026-09-29 amendment: recovery-aware gaps and unavailable samples

A missing host-load sample is unknown, not evidence that the host was healthy.
A deadline timeout with an unavailable sample now enters the same sustained
episode as a verified overload timeout, under the fixed classification
`host_load_unavailable`. The UI sentry follows the same rule for timeout-only
tier-1 failures whose failure-time sample is absent or invalid. A valid healthy
sample still makes a timeout a genuine failure and pages immediately.

Missed error-stream slots seed that sustained episode instead of paging on
their own. The next successful scheduled run proves recovery and clears the
episode without a page; if the next run also times out under overload or an
unavailable sample, elapsed time starts at the earliest missed slot. At 60
minutes without a success, the watcher still pages once. No delivery gate,
schedule, endpoint, or message path changed.

## Privacy and operations

No request, response, prompt, user, model, or email content is added. New state
is limited to timestamps, counts, booleans, a fixed classification, numeric
host-load values, and the alert disposition. No vendor, secret, schedule,
endpoint, or retention policy changes. The existing direct red-mail path is
used only for the single sustained-overload escalation and genuine failures.

## 2026-09-29 amendment: worker-side load-susceptible failures

The worker had two page decisions outside the slot supervisor. A failed health
runner with no fresh artifact paged immediately, including Doppler-provider and
Doppler-rate-limit failures. Separately, `watcher.mjs` paged the second
consecutive artifact error; that included `request_timeout` and
`network_error`. Those conditions can all be produced by a busy host and could
page before the recovery-aware episode saw them.

The slot supervisor now owns every `sl-error-stream-health` check-in and the
only red-page decision. `health_runner_failed`, `secret_provider_failed`,
`secret_rate_limited`, `request_timeout`, and `network_error` join the existing
missed-slot/host-timeout episode. Its clock means exactly "the job has not
succeeded": one failure stays quiet, a success before 60 minutes clears the
episode, and the first failure at or after 60 minutes pages once. The policy
does not depend on obtaining a host-load sample.

Missing `node` or `doppler`, an unreadable artifact, a measured red health
result, a healthy-host whole-run timeout, and non-load-susceptible artifact
failure escalation remain genuine breakage and page immediately. This changes
no delivery path, schedule, endpoint, secret, or gate.
