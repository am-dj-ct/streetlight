# Brief-First Response Style

## Question

Should Streetlight make main-model answers shorter by default?

## Decision

Yes. Streetlight will use a brief-first response style in the main system
prompt: lead with the most useful plain-language answer, keep it short when
short is enough, and expand when the user asks or the task requires it.

This is not a refusal layer and not a capability limit. The model still does
the work. Drafts, scripts, checklists, pasted documents, high-stakes caveats,
deadlines, amounts, and safety information remain complete even when they need
more space.

## Reasoning

The product is mobile-first, read-aloud-friendly, and designed for users who
may have low reading stamina, stress, or limited time. Shorter default answers
fit that access goal better than long explanations.

The risk is under-answering: a bare "be concise" instruction can make the
model omit useful context. The prompt therefore says "brief-first" rather than
"always short," and the response-style fixtures check both ends: answers should
not sprawl, but they should still be complete enough to use and should expand
when asked.

## Verification

Use `npm run check:response-style` against a live local or deployed chat path
after prompt changes affecting answer length or structure. The check uses
synthetic prompts only, records no conversation content, and verifies:

- word-count ranges for short-first answers,
- classifier event emission,
- follow-up suggestion emission,
- no refusal-shaped output,
- expansion after a user asks for more detail.

## Date

2026-05-13
