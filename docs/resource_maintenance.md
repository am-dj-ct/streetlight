# Resource Maintenance

The human-help lists in `src/data/referrals.json` and
`src/data/crisis-resources.json` are hand-maintained on purpose.

They are not model-generated. They are not auto-synced. If a phone number,
URL, or description changes, a human updates the file.

## Required fields

Every entry must include:

- `sourceName` — where the current contact details were verified
- `sourceUrl` — the official page used for scrape-assisted review
- `lastVerified` — the date the entry was last checked, in `YYYY-MM-DD`

These are enforced by `npm run validate:data`.

## Routine checks

Run:

```bash
npm run validate:data
npm run data:status
npm run resources:check
```

`validate:data` checks schema, URL shape, phone shape, and freshness metadata.

`data:status` gives a quick aging snapshot so you can see which entries are
oldest and whether anything is stale past the current threshold.

`resources:check` fetches each `sourceUrl`, compares candidate phone numbers and
links against the maintained JSON, and writes a Markdown report to `tmp/`.
That report is only a review aid. It does not update the JSON and it is not a
source of truth.

Set `skipSourceCheck` to `true` only for a manually verified resource whose
official site predictably blocks automated requests. The resource stays live,
but it is omitted from the scrape-assisted report.

## Scheduled email review

GitHub Actions runs a scrape-assisted review every two weeks on Monday at
17:00 UTC. The workflow can also be started manually from the GitHub Actions
tab.

The workflow uploads the full Markdown report as an artifact. If any resource
needs manual review or a fetch fails, it sends a Resend email with a short
checklist: what to open, what phone or URL Streetlight currently has, and why
the scraper flagged it. It also opens or comments on the
`Streetlight resource review needs attention` GitHub issue as a backup record.

Required GitHub repository secrets:

- `RESEND_API_KEY`
- `RESOURCE_REVIEW_EMAIL_FROM`
- `RESOURCE_REVIEW_EMAIL_TO`

## Freshness rule

- Entries older than 180 days are treated as stale.
- Entries dated in the future are invalid.

Launch readiness also checks this.

## Update workflow

1. Open the official source page for the entry.
2. Confirm the phone number, website, and description still match.
3. Optionally run `npm run resources:check` to create a local review report.
4. Update the JSON entry if anything changed.
5. Set `lastVerified` to today.
6. Run:

```bash
npm run validate:data
npm run data:status
npm run resources:check
npm run verify:quick
```

## Notes

- Keep descriptions plain and short.
- Prefer official pages over directory listings when possible.
- If an entry is no longer trustworthy, remove it instead of leaving it to rot.
- Do not auto-commit scraped changes. Scraping can flag drift; a human decides.
