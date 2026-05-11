# 2026-05-07 — Fixed-schema metadata logging

## Question

How should Streetlight capture enough operational signal to debug and
review usage patterns without storing conversation content or letting the
logging surface drift over time?

## Options considered

**Option A — Keep ad hoc structured logs.** Continue logging a few success and
error events near the relevant code paths and add fields as needed.

**Option B — Land one fixed per-turn metadata record.** Centralize the log
write behind a helper that emits one allowlisted JSON record per send attempt,
with separate minimal error logs only when needed.

## Decision

Option B.

## Reasoning

The privacy posture gets stronger when the logging surface is boring and
predictable. A single fixed-schema record is easier to audit, easier to review
quarterly, and harder for a future session to quietly expand with content-like
fields.

This implementation keeps the useful operational signals:

- model names
- token counts
- classifier category
- response timings
- language and button id
- hashed IP for short-window abuse pattern review
- blocked versus completed request states

And it keeps the important boundaries:

- no conversation text
- no raw IP
- no request or response objects dumped to logs
- no external log destination

Local development also stays workable: if the hashed-IP salt is absent, the
metadata record writes `hashed_ip: null` instead of breaking the app.

## Date

2026-05-07.
