# Weak-Category Recall Protocol

**Date:** 2026-05-13

This protocol exists because real users do not usually write polished test
prompts. They write things like "my Social Security letter," "court papers,"
"my boss cut my hours," or "the bill has charges I don't understand." The
weak-category system should catch those broad warning zones even when the
assistant mostly asks for more information.

## Goal

The classifier is a recall-first warning system. A false positive means the UI
shows an extra "verify with a person" note and a broader human-resource filter.
A false negative means Streetlight failed to warn in an area where AI often
gets important details wrong. For this product, false negatives are worse.

## What Gets Tested

`tests/prompts/weak-category-recall-cases.json` covers all ten weak categories
with synthetic prompts across these tiers:

- `bare-topic`: the user names the broad area with little detail.
- `vague-domain`: the user uses ordinary, imprecise language.
- `adjacent-language`: the user describes the situation without the formal
  category name.
- `light-risk`: the user gives enough detail to show a real verification risk,
  but not a full fact pattern.
- `overlap`: the prompt plausibly touches more than one category, so tie-breaks
  matter.
- `control`: ordinary non-weak prompts that should stay `none`.

The harness calls the real `/api/chat` endpoint. It does not print prompt text
in terminal output; it prints only case names, expected categories, actual
categories, durations, and response character counts.

## Command

Run locally against live model mode:

```bash
ACCESS_TOOL_BASE_URL=http://localhost:3000 npm run check:weak-category-recall
```

Helpful filters:

```bash
WEAK_CATEGORY_RECALL_FILTER=benefits npm run check:weak-category-recall
WEAK_CATEGORY_RECALL_FILTER=bare-topic npm run check:weak-category-recall
WEAK_CATEGORY_RECALL_CASE_LIMIT=10 npm run check:weak-category-recall
```

## Passing Standard

The current gate is strict exact-match or allowed-match by case:

- `expectedClassifier` means the classifier must return that category.
- `expectedAnyOf` means the prompt is intentionally overlapping and any listed
  category is acceptable.

Any miss exits nonzero. If future model variance makes exact category matching
too noisy, split the suite into:

- strict core cases that must exact-match, and
- variance/watchlist cases where any weak label is acceptable and the note
  firing is the main success condition.

Do not loosen the suite by accepting `none` for a positive weak-category case.

## Privacy Boundary

This protocol follows the no-content-debugging architecture:

- all prompts are synthetic and repo-owned;
- no production conversation content is collected;
- no request/response bodies are logged;
- no new vendor, storage, analytics, or telemetry is added;
- output remains a label-only classifier result.
