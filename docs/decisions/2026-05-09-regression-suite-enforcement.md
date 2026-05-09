# Regression Suite Enforcement

**Date:** 2026-05-09

## Question

How should the synthetic prompt regression suite be enforced without logging user content or creating routine live-model spend on every pull request?

## Options Considered

1. Run the full live Anthropic regression suite on every PR.
2. Run only static fixture checks on every PR.
3. Run the full suite in mock-local mode on every PR, and keep live regression as a deliberate pre-deploy/model-change gate.

## Decision

Use option 3.

Every conversation entry has 5–10 synthetic prompt fixtures. `npm run check:content` enforces fixture shape and count. GitHub Actions runs static checks, build, smoke, and the full prompt regression suite against `DEV_MOCK_CHAT=true` on every PR and every push to `main`.

Live behavior regression stays available through `npm run regression:prompts`. It should be run deliberately with the configured Haiku testing path before prompt, classifier, model-tier, or production deployment changes where live behavior matters.

## Reasoning

The mock PR suite catches routing, streaming, fixture, classifier-event, page-health, and data-contract regressions without sending synthetic content to Anthropic and without exposing live model secrets to PR contexts.

Live regression is still necessary for model quality and weak-category behavior, but it is an operator-controlled gate rather than an automatic spend source. That matches the project's privacy posture, cost constraints, and one-person operational model.
