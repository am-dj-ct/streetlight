# 2026-05-07 — KV-backed rate limit before Turnstile

## Question

Should Streetlight land the per-IP rate limit now, before Turnstile,
daily spend tracking, and kill-switch state are in place?

## Options considered

**Option A — Wait for the full abuse-control stack.** Hold rate limiting
until Turnstile, spend tracking, and kill-switch logic are all ready.

**Option B — Land the per-IP rate limit now.** Ship the hashed-IP daily
counter in Vercel KV first, while leaving the other controls for the next
tranche.

## Decision

Option B.

## Reasoning

The per-IP rate limit is the highest-value operational control after the
working chat path and classifier pass. It materially reduces trivial budget
drain and spam without adding any user identity surface or changing the
product experience for ordinary use.

This implementation stays within the architecture:

- Raw IP is read only long enough to derive a one-way hash.
- The stored key is a hashed IP plus day bucket, with TTL to the next UTC
  midnight.
- No conversation content enters KV.
- No new database is introduced.
- Local development fails open when KV env vars are missing, which keeps the
  operator's machine usable without pretending that local dev is production.

What remains intentionally incomplete:

- Turnstile validation.
- Daily spend tracking.
- Kill-switch state in KV or env vars.
- Full per-turn metadata logging.

This gets the project closer to partner-safe operations, but not all the way
there.

## Date

2026-05-07.
