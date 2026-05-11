# 2026-05-07 — Operational brakes before Turnstile

## Question

Should Streetlight land its pause controls and daily spend cap now,
before Cloudflare Turnstile validation is in place?

## Options considered

**Option A — Wait for Turnstile first.** Treat abuse controls as one tranche
and hold soft pause, hard pause, and spend tracking until Turnstile ships.

**Option B — Land the operational brakes now.** Add soft pause, hard pause,
and KV-backed daily spend tracking first, while leaving Turnstile as the next
front-door control.

## Decision

Option B.

## Reasoning

The pause controls and spend cap are the fastest way to reduce operational
blast radius if something goes wrong. They give the operator a way to stop the
tool or slow damage quickly without changing the user-identity surface, and
they match the architecture's dashboard-first operating model.

This implementation stays within the privacy posture:

- No content enters KV.
- Spend tracking stores only aggregate daily cost.
- Soft pause returns a plain assistant-style notice instead of calling the
  model.
- Hard pause serves a static page from `src/proxy.ts` for every route.
- Local development without KV or pricing env vars remains fail-open so the
  operator's machine stays usable.

What remains intentionally incomplete:

- Cloudflare Turnstile validation.
- The full fixed-schema per-turn metadata record.

This is a meaningful operational step, but it is not the final abuse-control
surface.

## Date

2026-05-07.
