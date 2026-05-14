# Prompt Regression Fixtures

Each subdirectory maps to one conversation entry point.

Structure:

- `tests/prompts/<entry-id>/cases.json`

Each case contains:

- `name`
- `text`
- optional `language` (defaults to `en`)
- optional `expectedClassifier`

These are synthetic prompts only. Never copy real user content here.

The initial scaffold is intentionally small. Grow each file over time as bug
reports and partner feedback surface the prompts worth protecting.

For lower-cost local iteration:

- `PROMPT_CASE_LIMIT=3 npm run regression:prompts`
- `PROMPT_CASE_FILTER=spanish npm run regression:prompts`
- `SMOKE_CASE_LIMIT=2 npm run smoke`
- `SMOKE_CASE_FILTER=benefits npm run smoke`

Deterministic stress-test splits:

- `tests/prompts/stable-core.txt`: high-confidence deterministic cases used as a strict gate.
- `tests/prompts/variance-watchlist.txt`: known variable overlap cases for monitoring drift without noisy gate failures.
- `tests/prompts/response-style-cases.json`: live model cases that check the
  brief-first contract without turning brevity into under-answering.
- `tests/prompts/weak-category-recall-cases.json`: broad, vague, adjacent,
  light-risk, overlap, and control prompts used to check high-recall weak-category
  warning behavior through the real `/api/chat` endpoint.

Tiered weak-category coverage:

- `docs/weak_category_tiered_prompt_protocol.md`: how to test bare-topic,
  vague-domain, light-risk, concrete, and overlap prompts before promoting
  cases into stable-core or watchlist files.

Commands:

- `npm run regression:stable-core` (fails on any stable-core mismatch)
- `npm run regression:watchlist` (prints scorecard; does not fail the process)
- `npm run check:response-style` (live model check for answer length,
  follow-up suggestions, classifier events, and "expand when asked" behavior)
- `npm run check:weak-category-recall` (live model check for broad weak-category
  recall; terminal output prints synthetic case names and labels, not prompt text)
