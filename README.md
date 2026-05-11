# Access Tool

A free, public, mobile-web LLM tool for people experiencing homelessness,
housing insecurity, or extreme poverty in Seattle / King County.

Anonymous by default. No accounts, no PII retention, no ads, no upsell, no
data harvesting, no premium tier. Open source from day one.

> A software engineer in SOMA uses Claude every day. He pays $20/month and
> it's a rounding error in his budget. A guy sleeping in a shelter ten
> blocks away has the exact same brain. Often harder problems. Zero access.
> That gap is not a moral failure on his part. It's an access gap. This
> project closes it, in one city, for one population, as a public utility.

## Status

Pre-launch. V1 in development. Soft-launch through named frontline partners
when the build is ready.

## Documents

- [Thesis](docs/access_tool_thesis.md) — why this tool exists and the
  reasoning behind it.
- [V1 Specification](docs/access_tool_v1_spec.md) — what the tool is,
  concretely.
- [Data and Privacy Architecture](docs/data_architecture.md) — how it's
  built, what it logs (and doesn't), and the threat model.
- [What this tool will not do](docs/forbidden.md) — the "no" list.
- [Translation handoff](docs/translation_handoff.md) — how locale files are
  produced, reviewed, and audited for completeness.
- [Translation worklist](docs/translation_worklist.md) — generated
  per-language missing-key checklist for translation maintenance.
- [Resource maintenance](docs/resource_maintenance.md) — how the hand-curated
  human-help lists are verified and kept fresh.
- [Operational runbook](OPERATIONAL_RUNBOOK.md) — dashboard-first incident
  and pause procedures.
- [Partner bug report template](docs/partners/bug-report.md) — structured
  no-content issue intake for frontline partners.
- [Partner launch packet](docs/partners/launch-packet.md) — ready-to-send
  framing, limits, and bug-report links for soft launch.
- [Partner materials index](docs/partners/README.md) — quick map of the
  soft-launch docs set.
- [Security policy](SECURITY.md) — how to report vulnerabilities safely.
- [Contributing guide](CONTRIBUTING.md) — how to open issues and send pull
  requests.
- [Code of conduct](CODE_OF_CONDUCT.md) — participation and moderation
  standards.

## Project structure

This is a one-person, one-year commitment with a graceful sunset path if no
institutional home is found by year-end. The about page is honest about
this. Code stays public on GitHub regardless.

## Useful commands

- `npm run lint`
- `npm run dev:mock` — runs the app with zero-cost local mock chat replies
- `npm run dev:live` — runs the app against the configured live model path
- `npm run build`
- `npm run check:audit` — runs npm audit for dependency advisories
- `npm run check:locales`
- `npm run check:locales:summary` — quieter locale-gap summary for routine
  verification loops
- `npm run check:launch` — static soft-launch readiness check for docs,
  placeholders, translations, and env contract
- `npm run check:env` — validates local/env-example boolean and numeric value
  shapes without printing secrets
- `npm run check:forbidden-integrations` — fails if forbidden analytics,
  error-reporting, or log-forwarding packages are added
- `npm run check:no-tracked-secrets` — scans tracked files for common
  secret-shaped values before push
- `npm run check:ops` — dry-run validation for the incident and ops helper
  scripts
- `npm run check:translation-worklist` — verifies that the generated
  translation worklist is current
- `npm run cost:status` — shows the local model pair and whether cheap local
  mode is active
- `npm run diagnostics:local` — prints the current local server mode and the
  report-page metadata snapshot
- `npm run ops:status` — prints the local health, deploy metadata, model mode,
  and any launch-doc placeholders still hanging around
- `npm run build:translation-worklist`
- `npm run incident:new -- --slug short-name --severity Sev-2` — scaffolds a
  public Sev-1/Sev-2 incident write-up from `incidents/TEMPLATE.md`
- `npm run incident:sev3 -- --what "..." --action "..." --outcome "..."` —
  appends a structured Sev-3 note to `incidents/log.md`
- add `--dry-run true` to either incident command if you want a preview without
  writing files
- `npm run validate:data` — validates referral/crisis schema plus source and
  last-verified metadata
- `npm run data:status` — shows the oldest referral/crisis entries and whether
  any have drifted past the freshness threshold
- `npm run smoke` — checks key pages plus a small synthetic end-to-end chat
  flow against `ACCESS_TOOL_BASE_URL` or `http://localhost:3000`
- `npm run smoke:quick` — cheaper local smoke pass with a smaller synthetic
  sample
- `npm run regression:prompts` — runs the synthetic prompt suite in
  `tests/prompts/` against the configured live model path
- `npm run regression:mock` — runs the full prompt set in mock-local plumbing
  mode without live model calls; this is what PR verification uses
- `npm run regression:quick` — cheaper prompt plumbing check; in mock mode it
  verifies streaming/classifier wiring without pretending to validate live
  model behavior
- `npm run verify:quick` — lower-cost local check for active setup work, now
  including the diagnostics snapshot and quick regression plumbing pass
- `npm run verify:mock` — full local no-spend verification with all smoke
  cases and all prompt fixtures in mock plumbing mode
- `npm run verify` — runs the local pre-launch verification stack

`npm run dev:mock` is for zero-cost local UI work. `npm run dev:live` is the
easy way back to real model calls. Full prompt regression still expects live
model replies, so `npm run regression:prompts` will stop with a clear message
while mock mode is active. Use `npm run regression:mock` for a full no-spend
plumbing pass. The GitHub Actions `Verify` workflow runs the full mock suite on
PRs and pushes to `main`; run `npm run regression:prompts` with the Haiku
testing model path before model, prompt, or deploy changes where live behavior
matters.

## Utility routes

- `/healthz` — simple no-store JSON health check for local smoke checks and
  future monitoring
- `/report-problem` — structured no-content bug report draft builder that
  stays client-side and opens a `mailto:` draft

## License

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE).

## Contact

Bug reports currently go to `jesse.c.dunn@outlook.com`.
