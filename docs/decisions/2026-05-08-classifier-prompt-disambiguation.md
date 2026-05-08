# 2026-05-08 — Classifier Prompt Disambiguation

## Question

How should the weak-category classifier handle cases where housing/legal
guidance and benefits language can overlap, especially in landlord or notice
scenarios?

## Context

The regression scaffold surfaced a bad-feeling result: a landlord-preparation
prompt was being classified as `benefits_eligibility`, which would pre-filter
the user toward the wrong kind of human help.

Classifier behavior is an architecture trigger, so this change is documented
explicitly.

## Options considered

### Option A — Leave the prompt broad

Keep the current label-only prompt and accept some noisy category selection.

### Option B — Add sharper category definitions and tie-break rules

Keep the same categories and same logging surface, but make the prompt more
specific about:

- when legal housing guidance should count as `legal_procedure`
- when benefits recertification or proof rules should count as
  `benefits_eligibility`
- when a passing mention should not trigger a category at all

## Decision

Choose **Option B**.

## Why

- The classifier drives referral filtering, so category noise is not just a
  metrics problem. It changes which human-help list the user sees first.
- This stays within the same privacy posture: same provider, same label-only
  output, same metadata logging, no new persistence, no new analytics.
- A prompt-only fix is the smallest useful intervention.

## What changed

- `src/lib/classifier-prompt.ts` now includes clearer distinctions between
  `legal_procedure`, `benefits_eligibility`, `specific_deadlines`, and `none`.
- The prompt now explicitly says landlord/tenant, eviction, lease, and
  repair-rights guidance usually belongs under `legal_procedure`.
- The regression fixture for the landlord-preparation case now expects
  `legal_procedure`.

## What did not change

- No new categories.
- No thresholding.
- No classifier reasoning text stored or surfaced.
- No logging-surface change.
