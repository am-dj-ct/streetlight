# 2026-05-09 — Architecture Drift Closeout

## Question

How should the implementation close drift between the V1 spec, the data
architecture, and the shipped app?

## Context

An architecture audit found four implementation gaps:

- Language selection used a browser cookie even though the architecture says
  no cookies.
- Daily spend enforcement hard-capped the tool but did not select cheaper
  model tiers first.
- Follow-up suggestions below model responses were static starter buttons
  only, not model-generated after each response.
- The weak-category classifier enum included medical dosing, drug
  interactions, and immigration, but the prompt did not define those labels
  explicitly.

Model selection, classifier prompt design, and metadata logging are
architecture triggers, so this change is documented explicitly.

## Decision

Close the drift in implementation while keeping the same privacy posture:

- Remove language-cookie persistence. Use explicit `?lang=` links and
  `Accept-Language` only.
- Add spend-aware main-model tier selection inside `/api/chat`.
- Add a separate JSON-only follow-up-suggestion pass using the configured
  classifier model.
- Extend metadata logging with suggestion-pass status, timing, and token
  counts only.
- Define the missing weak-category labels directly in the classifier prompt.

## Why

- The no-cookie promise should be literal.
- Tiering lets the tool degrade cost before reaching the daily hard cap.
- A separate suggestion pass keeps the main response readable and preserves
  the label-only classifier contract.
- Suggestion-pass metadata is needed for cost tracking and operational
  debugging, but no suggestion prompt text or raw output is logged.
- Explicit classifier definitions make the enum less aspirational and more
  testable.

## What Did Not Change

- No new provider.
- No content logging.
- No user accounts, sessions, analytics, or tracking identifiers.
- No keyword crisis detector.
- No classifier-based crisis routing.
- No refusal layer.
