# 2026-05-13 — Classifier Context for Vague Prompts

## Question

How should Streetlight handle vague but clearly domain-specific user prompts
like "Can you help me understand my Social Security letter?" when the assistant
response asks for more detail and does not repeat all of the user's context?

## Context

Live UI testing showed that the weak-category classifier passed crisp,
fully-specified prompts but was too quiet on vague or lightly specific prompts.
The root cause was that the classifier only received the assistant response.
When the assistant answered "I can help you figure out what proof to send" but
did not repeat "SSI" or "Social Security," the classifier had lost the domain
signal needed to choose `benefits_eligibility`.

This matters because many real users will start with ordinary language:

- "I got a Social Security letter."
- "I got court papers."
- "My medicine label is confusing."
- "My job is messing with my paycheck."

The product promise is not keyword routing. It is honest calibration when the
model is answering in a known weak area.

## Decision

Send the latest user message plus the assistant response to the label-only
classifier.

Keep the same single-label taxonomy and the same post-hoc flow. The classifier
still does not route crisis behavior, refuse content, personalize the UI, or
store content. It only returns one label that controls the inline weak-category
note and `Find a human` pre-filter.

Tune the classifier prompt so light practical guidance in a named weak domain is
enough to trigger the weak-category note. A complete fact pattern is no longer
required.

## Why

- The classifier needs enough context to classify the assistant's answer.
- Passing the latest user message avoids brittle keyword code while preserving a
  model-based second pass.
- The additional content is sent to the same Anthropic API already receiving the
  conversation for the main response, under the same retention and no-training
  assumptions already disclosed.
- No content is logged, persisted, or sent to any new vendor.

## What Changed

- `src/app/api/chat/route.ts` now builds classifier input from the latest user
  message and the assistant response.
- `src/lib/classifier-prompt.ts` now defines vague-domain handling explicitly.
- Regression fixtures now include vague and lightly specific cases for Social
  Security/SSI, court papers, missed doses, drug interactions, USCIS notices,
  identity documents, deadline counting, and bill charges.
- The bill/charges tie-break explicitly covers "please help me understand this
  bill" cases where the assistant offers to review the charges before seeing
  exact dollar amounts.
- `docs/weak_category_tiered_prompt_protocol.md` and
  `docs/weak_category_tiered_prompt_run_2026-05-13.md` capture the test method
  and the pre-fix findings.

## What Did Not Change

- No keyword detector.
- No classifier-based crisis routing.
- No refusal layer.
- No sentiment classifier.
- No new logging surface.
- No new persistence.
- No new provider or secret.
