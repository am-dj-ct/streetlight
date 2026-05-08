# 2026-05-07 — Turnstile script-only validation

## Question

How should the Access Tool add Cloudflare Turnstile without putting message
content behind a Cloudflare proxy or adding enough complexity to slow down the
operator?

## Options considered

**Option A — Full Cloudflare proxy path.** Put the app behind a broader
Cloudflare layer and let Cloudflare sit in the request path.

**Option B — Script-only Turnstile.** Render an invisible Turnstile widget in
the browser, send the single-use token with `/api/chat`, and validate it on
the Vercel side with `siteverify`.

## Decision

Option B.

## Reasoning

Script-only Turnstile matches the architecture's privacy posture better. It
keeps Cloudflare out of the message-body path while still giving the tool a
basic abuse check in front of the model call.

This implementation keeps a few boundaries intact:

- Cloudflare sees only the Turnstile token and its own validation metadata, not
  the conversation body.
- Vercel still receives and handles the actual chat request directly.
- Local development stays fail-open when Turnstile keys are absent, so the app
  remains usable on the operator's machine without extra setup.
- Tokens are treated as single-use and are reset after each send attempt.

What remains intentionally incomplete:

- The fixed-schema per-turn metadata log.
- Turnstile widget metadata tuning beyond the basic invisible flow.

## Date

2026-05-07.
