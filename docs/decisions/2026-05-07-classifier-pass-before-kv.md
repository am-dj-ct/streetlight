# 2026-05-07 — Classifier pass before KV-backed rate limit

## Question

Should the Access Tool land the post-response weak-category classifier now,
before Turnstile, KV-backed rate limiting, and the full metadata-log schema
are in place?

## Options considered

**Option A — Wait for the whole operational stack.** Hold the classifier
until rate limiting, spend tracking, Turnstile, and the full logging schema
arrive together.

**Option B — Land the classifier now.** Ship the Haiku weak-category pass and
the inline UI note as soon as the streaming chat path is stable, while
leaving KV-backed controls for the next tranche.

## Decision

Option B.

## Reasoning

The classifier pass is part of the user-facing honesty contract in the spec.
It changes what the user sees after a response in categories where the model
is known to be weaker, and it does so without widening the content-retention
surface controlled by this project.

Landing it now is acceptable because:

- The classifier uses the same Anthropic provider already in the architecture.
- It returns a label only — no freeform explanation, no stored reasoning.
- The UI note materially improves calibration for legal, medical, benefits,
  immigration, drug-interaction, deadline, and dollar-amount answers.
- The route still avoids content logging and only emits structured safe
  metadata.

What remains intentionally incomplete:

- Turnstile validation.
- KV-backed per-IP rate limiting.
- KV-backed spend tracking / kill-switch state.
- The full fixed-schema per-turn metadata record described in the architecture
  doc.

This means the tool is closer to the target product behavior, but it is still
not partner-ready.

## Date

2026-05-07.
