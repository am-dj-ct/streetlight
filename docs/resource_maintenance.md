# Resource Maintenance

The human-help lists in `src/data/referrals.json` and
`src/data/crisis-resources.json` are hand-maintained on purpose.

They are not model-generated. They are not auto-synced. If a phone number,
URL, or description changes, a human updates the file.

## Required fields

Every entry must include:

- `sourceName` — where the current contact details were verified
- `lastVerified` — the date the entry was last checked, in `YYYY-MM-DD`

These are enforced by `npm run validate:data`.

## Routine checks

Run:

```bash
npm run validate:data
npm run data:status
```

`validate:data` checks schema, URL shape, phone shape, and freshness metadata.

`data:status` gives a quick aging snapshot so you can see which entries are
oldest and whether anything is stale past the current threshold.

## Freshness rule

- Entries older than 180 days are treated as stale.
- Entries dated in the future are invalid.

Launch readiness also checks this.

## Update workflow

1. Open the official source page for the entry.
2. Confirm the phone number, website, and description still match.
3. Update the JSON entry if anything changed.
4. Set `lastVerified` to today.
5. Run:

```bash
npm run validate:data
npm run data:status
npm run verify:quick
```

## Notes

- Keep descriptions plain and short.
- Prefer official pages over directory listings when possible.
- If an entry is no longer trustworthy, remove it instead of leaving it to rot.
