# Synthetic Regression Suite

Per-button synthetic prompts that run against the live API on every PR
touching `lib/system-prompts/`, `lib/classifier-prompt.ts`, or model config.

This directory is the structural answer to "how do you debug without
content logging." Bugs that surface in real partner reports get reproduced
here as synthetic cases. Real user content never enters this tree.

## Structure (planned)

One subdirectory per button, plus typed-input and language-specific edges:

- `01-understand-a-letter-or-form/`
- `02-write-something/`
- `03-think-it-through/`
- `04-figure-out-what-to-do-next/`
- `05-explain-something-like-im-new-to-it/`
- `06-prepare-for-something-hard/`
- `07-am-i-being-unreasonable/`
- `08-something-im-embarrassed-to-ask/`
- `09-typed-their-own/`
- `language-edges/` — Spanish, Vietnamese, Somali, Russian, Amharic, Chinese
  cases. Auto-detect, mid-conversation switch, mixed-language input.
- `weak-category-edges/` — cases that should fire each classifier category
  (legal procedure, medical dosing, benefits eligibility, immigration, drug
  interactions, specific deadlines, specific dollar amounts).

Each subdirectory: 5–10 canonical synthetic prompts covering typical and
edge cases.

## Assertions

- Response length within bounds.
- Response in correct language when input language is specified.
- Response does not refuse the request (the tool has no refusal categories).
- Classifier fires the correct category for cases where one is expected,
  and `none` for cases where none should fire.

## What this directory is not

- Not a content store. Synthetic prompts are written from imagination plus
  partner reports paraphrased into structured form. No real user content
  ever enters this tree. Partner bug reports use the structured template
  in `docs/partners/bug-report.md` (TBD before launch) and explicitly
  forbid pasting real model responses.

## Status

Pre-build. Suite gets populated as button system prompts are written.
