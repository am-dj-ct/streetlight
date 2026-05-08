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
