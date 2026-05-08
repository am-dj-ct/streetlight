# Translation Handoff

This app is set up so human translation can happen as a content pass, not a
component refactor.

## Rules

- Do not generate launch translations with a model.
- English is the source of truth.
- Every supported language gets its own JSON file.
- If a language file is incomplete, the app falls back to English and shows an
  honesty notice in the UI.

## Supported languages

- `en`
- `es`
- `vi`
- `so`
- `ru`
- `am`
- `zh`

## Files translators will touch

### Shared UI strings

- `src/data/ui-copy/en.json`
- `src/data/ui-copy/es.json`
- `src/data/ui-copy/vi.json`
- `src/data/ui-copy/so.json`
- `src/data/ui-copy/ru.json`
- `src/data/ui-copy/am.json`
- `src/data/ui-copy/zh.json`

These cover buttons, footer labels, save modal text, notices, and other shared
UI chrome.

### Conversation entry content

- `src/data/conversation-content/en.json`
- `src/data/conversation-content/es.json`
- `src/data/conversation-content/vi.json`
- `src/data/conversation-content/so.json`
- `src/data/conversation-content/ru.json`
- `src/data/conversation-content/am.json`
- `src/data/conversation-content/zh.json`

These cover:

- the eight landing button labels
- `Type your own`
- `Talk instead`
- seed assistant messages
- starter suggestions

### Static trust pages

- `src/data/static-pages/en.json`
- `src/data/static-pages/es.json`
- `src/data/static-pages/vi.json`
- `src/data/static-pages/so.json`
- `src/data/static-pages/ru.json`
- `src/data/static-pages/am.json`
- `src/data/static-pages/zh.json`

These cover:

- `/privacy`
- `/about`

## How to check progress

Run:

```bash
npm run check:locales
```

The script reports missing keys by directory and ends each section with a
summary count.

## Translation workflow

1. Translate from the English file into the matching language file.
2. Keep the same JSON structure and keys.
3. Do not delete the `meta` object.
4. Set `meta.translated` to `true` only when the file is complete enough to
   ship without the English fallback notice.
5. Run `npm run check:locales`.
6. Run `npm run lint` and `npm run build`.

## Notes

- The app currently uses English fallback honestly on incomplete languages.
- Referral data and crisis-resource data remain shared across languages for now.
- If a future pass adds language-specific resource variants, update
  `docs/data_architecture.md` if that changes the data surface in a meaningful
  way.
