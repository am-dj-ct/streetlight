# Brief-First Response Style Run — 2026-05-13

## Goal

Make Streetlight responses shorter by default without turning brevity into a
refusal layer or an under-answering problem.

## Baseline

Ran 10 synthetic first-turn prompts against the live local `/api/chat` path
before changing the prompt.

Average result:

- 155 words
- 864 characters
- classifier events emitted for all cases
- follow-up suggestions emitted for all cases

Notable baseline shape:

- Shortest: Talk Instead, 16 words
- Longest: generic benefits explanation, 239 words
- Several ordinary first answers landed between 175 and 239 words

## Change

Updated the main system prompt to:

- use a brief-first answer by default,
- target roughly 60–140 words for ordinary first answers,
- preserve complete drafts, scripts, checklists, pasted-document explanations,
  high-stakes caveats, deadlines, amounts, and safety information,
- prefer one safest next step and one urgent boundary over long hypothetical
  lists,
- avoid long resource lists unless the user asks,
- ask at most one focused follow-up question.

Also tightened two entry prompts:

- `figure-out-next`: do not lead with a resource list; focus on the smallest
  useful next step.
- `explain-like-new`: start with a short definition and one concrete example;
  keep the first answer compact unless the user asks for more depth.
- `embarrassed-to-ask`: for medical or safety uncertainty, keep the first
  answer to safest next step, urgent boundary, and one focused question.

## Post-Change Broad Sample

Ran the same 10 synthetic first-turn prompts after the prompt change.

Average result:

- 113 words
- 645 characters
- classifier events emitted for all cases
- follow-up suggestions emitted for all cases

This is about a 27% reduction in average word count and about a 25% reduction
in average character count on the broad sample.

Notable post-change shape:

- Shortest: Talk Instead, 17 words
- Longest: generic benefits explanation, 178 words
- Most ordinary first answers landed between 67 and 178 words

## Response-Style Fixture Check

Added `tests/prompts/response-style-cases.json` and
`scripts/response-style-check.mjs`.

The live check verifies:

- answers stay within expected word ranges,
- classifier events are present,
- follow-up suggestion events are present,
- no refusal-shaped language appears,
- the model expands when the user asks for more detail.

Passing live run:

- benefits letter: 59 words, classifier `benefits_eligibility`
- court papers next step: 182 words, classifier `legal_procedure`
- missed medicine: 138 words, classifier `medical_dosing`
- short landlord draft: 91 words, classifier `none`
- DSHS appointment prep: 92 words, classifier `benefits_eligibility`
- payment-plan explanation: 187 words, classifier `specific_dollar_amounts`
- payment-plan expansion follow-up: 218 words, classifier `specific_dollar_amounts`

## Stable-Core Regression

The first full stable-core pass after the prompt change surfaced three useful
calibration issues:

- a vague bill/charges case sometimes returned `none` instead of
  `specific_dollar_amounts`,
- a medication-access appointment case was better treated as
  `medical_decisionmaking` than `none`,
- a general prioritization case briefly over-fired `specific_deadlines`.

Fixes:

- tightened the bill/charges classifier tie-break for "help me understand this
  bill" cases,
- reclassified the medication-access appointment fixture as
  `medical_decisionmaking`,
- tightened `specific_deadlines` so "do this today" prioritization language
  does not count without a formal due date, response window, filing window, or
  timing rule.

Final full stable-core run:

- 57/57 passed
- 0 failed

## Read

The prompt now behaves closer to the intended product stance: shorter first
answers, no refusal layer, preserved classifier behavior, and expansion when
the user asks.

Remaining risk: live model output length varies. The response-style check uses
word-count ranges broad enough to catch real drift without failing on small
natural variation.
