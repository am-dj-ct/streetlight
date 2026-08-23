# 2026-08-23 - Same-day aggregate stream health

## Decision

Record count-only chat outcomes in five-minute Vercel KV buckets with a
90-minute TTL. An authenticated operator endpoint summarizes the current
bucket and the prior 12 as a 60-minute rolling signal and reports red only
when `error_stream / total` is strictly greater than 0.5. Because the source
is aggregate buckets rather than event timestamps, an off-boundary query can
include up to five extra minutes; the scheduled watcher runs on five-minute
boundaries. It returns counts, rate, status, window length, and generation
time only. A missing KV configuration or failed bucket read returns 503, never
an empty green window.

Authenticated synthetic UI-sentry turns are excluded from these health
buckets and the public usage aggregates. They remain covered by the sentry's
own result. The daily aggregation schema is unchanged.

Provider stream events now retain only their stable error type in the existing
content-free operational log, so a future spike can distinguish an overload
from another stream failure without retaining the provider message.

The operator-owned Hub may poll this protected endpoint every five minutes and
write its existing fixed source-health artifact (`ok`, `failed`, or `error`). This is a
narrow exception to the earlier public-health-only polling boundary: it reads
an aggregate service signal and retains no response body, user identifier,
request metadata, model label, category, path, or content.

## Why

The daily digest can reveal a stream-error spike nearly a day late. Runtime
logs may expire before review. A short-lived aggregate signal makes a same-day
failure visible without adding a log drain, third-party monitoring service, or
user-level telemetry.
