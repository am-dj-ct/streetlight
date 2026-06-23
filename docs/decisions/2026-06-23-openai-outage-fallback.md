# 2026-06-23: Rare OpenAI outage fallback

## Status

Accepted.

## Context

On June 23, 2026, Anthropic had an elevated error-rate incident across multiple models. Streetlight's public UX should not expose provider machinery or leave users with an internal-looking failure message when the upstream model provider is having a broad outage.

The original V1 design kept all chat and classifier model calls inside Anthropic because Anthropic's data posture is the reason the project selected it. That remains the primary design. The outage exposed a narrow availability risk: if all configured Anthropic models fail, the user gets no answer even though the rest of Streetlight is healthy.

## Decision

Add an optional OpenAI Responses API fallback after all configured Anthropic main-model attempts fail before any text is emitted.

- Anthropic remains primary.
- OpenAI is tried only in rare circumstances after the Anthropic chain fails.
- The default OpenAI fallback model is `gpt-5.5`, configurable through `OPENAI_FALLBACK_MODEL`.
- The fallback is disabled unless `OPENAI_API_KEY`, `OPENAI_FALLBACK_INPUT_COST_PER_MILLION_USD`, and `OPENAI_FALLBACK_OUTPUT_COST_PER_MILLION_USD` are all configured.
- Classifier and follow-up suggestion passes remain Anthropic first; if those small passes fail and OpenAI fallback is configured, they retry through OpenAI.
- OpenAI fallback requests do not enable web search, tools, file access, or background workflows.
- No request bodies, response bodies, or provider error bodies are logged. Logs include only safe metadata: provider/model label, status code, response time, and stable error code.
- Daily spend tracking counts fallback tokens using explicit OpenAI cost env vars.
- `/healthz` exposes whether the fallback is configured and reports `deployConfigOk: false` in production if an OpenAI key is present without fallback cost config.
- The user-facing privacy and about pages name OpenAI as a rare outage backup.

## Consequences

Positive:

- A broad Anthropic outage no longer automatically produces a visible internal-looking failure for users when OpenAI fallback is configured.
- The fallback still respects the no-content-logging rule and the daily spend cap.
- The operational state is inspectable through `/healthz`, `npm run ops:status`, and `npm run cost:mode`.

Tradeoffs:

- Streetlight now has a second AI provider in rare circumstances. The privacy story is still honest, but less simple than Anthropic-only.
- OpenAI provider-side handling is outside Streetlight's control for fallback turns, just as Anthropic provider-side handling is outside Streetlight's control for normal turns.
- ZDR pursuit with Anthropic remains important because Anthropic is still the normal path.

Rejected alternatives:

- Do nothing: preserves the cleanest provider story but leaves users stranded during broad Anthropic outages.
- Add an outside-provider fallback silently: rejected because the privacy explainer must say what is true.
- Replace Anthropic primary routing: rejected because Anthropic remains the best fit for the V1 privacy posture.
