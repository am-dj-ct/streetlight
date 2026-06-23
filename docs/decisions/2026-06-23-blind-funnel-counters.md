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

Each step stores daily aggregate totals and daily salted-IP unique counts. Per-day unique markers expire shortly after UTC midnight. Aggregate counters expire after 180 days. The counters do not store raw IPs, request paths, user agents, cookies, messages, answers, session IDs, or per-person timelines.

The `/ops/usage` dashboard shows the funnel alongside existing site views, chat requests, LLM turns, classifier categories, model labels, and spend.

## Consequences

Positive:

- Launch operations can distinguish a homepage-only visit from a conversation page load, a manual submit attempt, a chat request, and an LLM turn.
- The dashboard can surface breakage before users send detailed bug reports.
- The design stays inside the existing Vercel KV counter architecture and does not add a third-party analytics vendor.

Tradeoffs:

- The dashboard now records more aggregate behavioral counts than the earlier minimum.
- Daily unique counts still require short-lived salted-IP marker keys, though raw IPs are never stored and markers expire shortly after the day ends.

Rejected alternatives:

- Add Vercel Web Analytics or another analytics SDK: rejected because the architecture intentionally avoids third-party analytics surfaces.
- Store paths or full event timelines: rejected because those create a per-user tracking surface the project does not need.
- Do nothing: rejected because launch operations would not be able to tell where users drop before an LLM turn.
