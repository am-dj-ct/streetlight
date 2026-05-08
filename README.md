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
- [Translation handoff](docs/translation_handoff.md) — where human
  translation work lives and how to audit completeness.
- [Translation worklist](docs/translation_worklist.md) — generated
  per-language missing-key checklist for human translators.
- [Operational runbook](OPERATIONAL_RUNBOOK.md) — dashboard-first incident
  and pause procedures.
- [Partner bug report template](docs/partners/bug-report.md) — structured
  no-content issue intake for frontline partners.
- [Partner launch packet](docs/partners/launch-packet.md) — ready-to-send
  framing, limits, and bug-report links for soft launch.
- [Partner materials index](docs/partners/README.md) — quick map of the
  soft-launch docs set.

## Project structure

This is a one-person, one-year commitment with a graceful sunset path if no
institutional home is found by year-end. The about page is honest about
this. Code stays public on GitHub regardless.

## Useful commands

- `npm run lint`
- `npm run build`
- `npm run check:locales`
- `npm run check:launch` — static soft-launch readiness check for docs,
  placeholders, translations, and env contract
- `npm run build:translation-worklist`
- `npm run validate:data`
- `npm run smoke` — runs a small synthetic end-to-end chat check against
  `ACCESS_TOOL_BASE_URL` or `http://localhost:3000`
- `npm run regression:prompts` — runs the starter synthetic prompt set in
  `tests/prompts/`
- `npm run verify` — runs the local pre-launch verification stack

## Utility routes

- `/healthz` — simple no-store JSON health check for local smoke checks and
  future monitoring

## License

TBD — MIT or Apache-2.0. Picked before public launch.

## Contact

Bug reports currently go to `jesse.c.dunn@outlook.com`.
