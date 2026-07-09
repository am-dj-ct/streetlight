# 2026-07-09 - Daily Aggregate Usage Digest

## Status

Accepted.

## Context

The operator needs a daily readout of Streetlight usage without opening the ops dashboard manually. The useful windows are the latest complete day and the cumulative tracking window. The highest-signal figures are unique homepage reach, chat/API reach, request counts, LLM turns, and spend.

The existing dashboard already exposes blind aggregate usage counters. Adding a second analytics tool or storing per-event records would contradict the privacy architecture.

## Decision

Add a scheduled GitHub Actions cron that fetches the existing protected `/api/ops/usage` JSON endpoint and sends a plain-text Resend email.

The digest includes:

- Latest complete UTC-day homepage unique/open counts.
- Latest complete UTC-day conversation, prompt, submit, chat/API, LLM, and spend counts.
- Cumulative homepage and conversation unique/open counts from their clean page-open tracking windows.
- Cumulative prompt, submit, chat/API, LLM, and spend counts from the existing aggregate tracking windows.
- Daily outcomes, weak categories, and model labels only when the latest day has LLM activity.

The email does not include raw IPs, user agents, request paths, messages, answers, session IDs, cookies, or per-person records.

## Consequences

The operator gets a daily operational signal using the same data as the dashboard. Resend receives aggregate counts in the email body, but not user content or identifiers.

The latest-day section uses the latest complete UTC day because the usage system stores daily UTC buckets, not exact rolling 24-hour event timestamps. Exact rolling 24-hour first-time-new visitor counts would require storing additional event-time state, so this change deliberately avoids that.

The workflow requires GitHub secrets for `OPS_READ_TOKEN`, `RESEND_API_KEY`, `RESOURCE_REVIEW_EMAIL_FROM`, and `RESOURCE_REVIEW_EMAIL_TO`.
