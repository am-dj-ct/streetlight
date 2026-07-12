# Operator-Owned Local Health Polling

**Date:** 2026-07-12

## Context

Streetlight already exposes a public, no-store `/healthz` contract for deploy verification. The operator's local personal-ops dashboard needs a reliable way to show whether the public production runtime is correctly configured and whether the deployed commit has passed the repository's existing verification and resource-review workflows.

The prior architecture wording prohibited monitoring broadly because hosted observability and alerting vendors add surveillance-shaped infrastructure and may gain access to user-connected request data. A local poller that reads only the existing public health contract and GitHub workflow metadata has a different privacy profile, but it needs an explicit boundary so it cannot quietly expand.

## Decision

Permit the operator-owned personal-ops dashboard, running on the operator's own machine, to perform bounded read-only polling of:

- `https://streetlight.help/healthz`
- GitHub Actions metadata for the `Verify` and scheduled `Resource Review` workflows

The dashboard may retain only a fixed green/yellow/red status, a fixed non-diagnostic summary, a source label, and timestamps. It must not retain response bodies, configuration fields, commit metadata, workflow output, logs, request headers, IP addresses, user agents, or any user content.

The poller must not call `/api/chat`, `/api/tts`, `/api/usage`, `/api/ops/usage`, or any other user-connected or operator-data route. It must not dispatch workflows, send alerts, trigger model calls, or introduce a hosted monitoring vendor.

## Consequences

- The local dashboard can detect an unavailable or invalid production health endpoint without adding a third-party observer.
- Deploy integrity can be compared with existing GitHub verification metadata, and resource-review freshness can be surfaced without running the review again.
- Human review remains the response path. This decision does not authorize Sentry, Datadog, Pingdom, Vercel analytics, log drains, content logging, or user-level telemetry.
- Any expansion beyond these exact read-only surfaces requires another architecture review and dated decision.
