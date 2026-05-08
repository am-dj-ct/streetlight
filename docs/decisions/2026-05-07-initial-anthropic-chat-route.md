# 2026-05-07 — Initial Anthropic chat route before classifier and rate limit

## Question

How do we move from a static conversation shell to a working chat system
without accidentally widening the privacy surface beyond what this stage can
operate safely?

## Options considered

**Option A — Wait for the full architecture at once.** Hold the API route
until Turnstile, per-IP rate limiting, classifier pass, metadata logging,
and referral filtering are all implemented together.

**Option B — Land the main chat path first.** Ship a backend `/api/chat`
route that proxies browser conversation history to Anthropic's Messages API
with no content logging, while leaving Turnstile, KV-backed rate limiting,
classifier pass, and metadata logging for the next tranche.

## Decision

Option B.

## Reasoning

The codebase needed a real browser-to-backend-to-model path so the UI could
advance beyond a static shell. Waiting for the entire target architecture at
once would have delayed useful integration work and made it harder to verify
the core conversation flow.

This route is intentionally narrow:

- It proxies through the backend, never browser-to-Anthropic directly.
- It requires `ANTHROPIC_API_KEY` and `MAIN_MODEL` via environment variables.
- It keeps conversation history in browser memory and sends the full stateless
  turn history on each request.
- It does **not** log request bodies, message arrays, or raw SDK error objects.
- It does **not** yet implement Turnstile, rate limiting, classifier pass,
  or metadata log writes.

Those omissions are deliberate, temporary, and now documented. They must be
completed before partner-facing use. The route is a development milestone,
not evidence that the full privacy architecture is finished.

## Date

2026-05-07.
