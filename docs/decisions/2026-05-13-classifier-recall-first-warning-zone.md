# 2026-05-13 — Recall-First Weak-Category Warning Zone

## Question

Should the weak-category classifier be precise about when a category is fully
established, or broad enough to fire when ordinary user language reasonably
touches a weak area?

## Context

Live user-side testing showed that the classifier still missed ordinary broad
prompts like Social Security letters, bills, deadlines, court papers, and other
topics when the prompt did not contain a fully specified fact pattern.

The existing classifier had improved on crisp test fixtures, but it was still
too conservative for the actual UI contract. The weak-category note is not a
refusal and not a safety block. It only says AI sometimes gets this area wrong
and links the user toward human resources.

Anthropic's prompt-engineering guidance starts from clear success criteria and
empirical tests, and its evaluation guidance says tests should mirror real-world
distribution and include edge cases. For this project, the real-world
distribution includes vague, adjacent, low-literacy, and incomplete phrasing.

## Decision

Treat the classifier as a high-recall warning system.

The classifier should choose a weak-category label when either the latest user
message or assistant response reasonably touches a listed weak area, even if the
assistant mostly asks for more details or gives only light practical guidance.
`none` is now the narrow option: use it when no listed weak category is
reasonably implicated.

Keep the same taxonomy, label-only output, post-hoc architecture, and
metadata-only logging.

## What Changed

- `src/lib/classifier-prompt.ts` now states that missing a warning is worse
  than showing an extra warning.
- Category definitions now include broad adjacent-language signals for each
  weak category.
- Tie-break rules now select the kind of human expertise most useful to the
  user, rather than demanding exact proof that only one category applies.
- `parseWeakCategory` now tolerates common label-only formatting drift such as a
  trailing period or first-line label.
- `tests/prompts/weak-category-recall-cases.json` adds broad, vague, adjacent,
  light-risk, overlap, and control prompts.
- `npm run check:weak-category-recall` runs those cases through the real
  `/api/chat` endpoint without printing prompt text.
- `docs/weak_category_recall_protocol.md` documents the testing method.

## What Did Not Change

- No keyword detector.
- No classifier-based crisis routing.
- No refusal layer.
- No sentiment classifier.
- No new logging surface.
- No content logging or debugging toggle.
- No new persistence.
- No new provider or secret.
