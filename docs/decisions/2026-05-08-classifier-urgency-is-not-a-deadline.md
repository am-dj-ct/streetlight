# 2026-05-08 — Classifier Urgency Is Not a Deadline

## Question

How should the weak-category classifier handle assistant replies that express
general urgency without giving an actual date, window, or timing rule?

## Context

The synthetic regression suite surfaced a bad-feeling result on a planning
prompt: the assistant said an unopened housing letter might matter because
"deadlines can sneak up fast," and the classifier sometimes labeled that reply
as `specific_deadlines`.

That warning would steer the user toward a weak-category note even though the
assistant had not actually given a deadline to rely on.

Classifier behavior is an architecture trigger, so this change is documented
explicitly.

## Options considered

### Option A — Leave `specific_deadlines` broad

Accept that urgency language may sometimes trip the deadline warning.

### Option B — Require concrete timing guidance

Treat `specific_deadlines` as reserved for an exact due date, time window, or
timing rule the user may need to verify.

## Decision

Choose **Option B**.

## Why

- The weak-category note changes what kind of human-help list the user sees
  first, so false positives matter.
- A vague sense of urgency is not the same as a concrete deadline.
- This stays within the same privacy and logging posture: same provider, same
  label-only output, same metadata schema.

## What changed

- `src/lib/classifier-prompt.ts` now explicitly says that generic urgency such
  as "soon," "tomorrow," or "deadlines can sneak up" should still count as
  `none` unless the reply includes a real timing rule or due date.
- The architecture doc now mirrors that rule in the regression-suite section.

## What did not change

- No new categories.
- No thresholding.
- No logging-surface change.
- No new persistence or analytics.
