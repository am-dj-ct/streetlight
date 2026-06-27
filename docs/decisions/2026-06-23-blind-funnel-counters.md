# 2026-06-23: Blind funnel counters

## Status

Accepted.

## Context

The launch dashboard showed site views but no LLM calls. That was technically correct, but operationally ambiguous: it did not show whether users were reaching the conversation screen, trying to submit, getting blocked before `/api/chat`, or simply not sending messages.

Streetlight needs enough usage visibility to tell whether the public flow is functioning after launch. The existing privacy architecture rules out third-party analytics SDKs, raw IP storage, paths, user agents, cookies, session records, and content logging.

## Decision

Add Streetlight-owned blind funnel counters in Vercel KV for three additional steps:

- homepage prompt button clicks
- conversation page views
- manual chat submit clicks

Each step stores daily aggregate totals and daily salted-IP unique counts. Per-day unique markers expire shortly after UTC midnight. The dashboard also keeps a clean range-level homepage-view count and clean range-level salted-IP unique counters so top-card aggregate numbers are not summed from polluted daily site-view history. Aggregate counters and range-level markers expire after 180 days. The counters do not store raw IPs, request paths, user agents, cookies, messages, answers, session IDs, or per-person timelines.

`site.views` counts homepage renders, not every page render. Usage counters may use request headers transiently to skip obvious bots, link preview agents, uptime monitors, and prefetches before incrementing a counter; those headers are not stored.

The `/ops/usage` dashboard shows the funnel alongside existing site views, chat requests, LLM turns, classifier categories, model labels, and spend.

The dashboard may derive operational views from those same aggregate counters: dropoff rates, language breakdowns, starting-button breakdowns, blocked/error status summaries, weak-category summaries, and model/provider usage summaries. These are display calculations over aggregate records, not additional per-user tracking.

## Consequences

Positive:

- Launch operations can distinguish a homepage-only visit from a conversation page load, a manual submit attempt, a chat request, and an LLM turn.
- The dashboard can surface breakage before users send detailed bug reports.
- The design stays inside the existing Vercel KV counter architecture and does not add a third-party analytics vendor.
- More launch questions can be answered from one place without opening provider logs or adding a session timeline.

Tradeoffs:

- The dashboard now records more aggregate behavioral counts than the earlier minimum.
- Daily unique counts require short-lived salted-IP marker keys, and top-card aggregate unique cards require longer-lived salted-IP marker keys. Raw IPs are never stored, and both marker types expire.
- The top-card homepage view count starts with the clean counter window instead of backfilling historical site-view rows.

Rejected alternatives:

- Add Vercel Web Analytics or another analytics SDK: rejected because the architecture intentionally avoids third-party analytics surfaces.
- Store paths or full event timelines: rejected because those create a per-user tracking surface the project does not need.
- Do nothing: rejected because launch operations would not be able to tell where users drop before an LLM turn.
