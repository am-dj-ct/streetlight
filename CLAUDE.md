# CLAUDE.md

Entry point for any Claude Code (or Claude chat) session working on this repo.
Read this before doing anything. It is short on purpose.

---

## What this project is

Streetlight: a free, public, mobile-web LLM tool for people experiencing
homelessness, housing insecurity, or extreme poverty in Seattle / King County.
Anonymous, no accounts, no PII retention, soft-launched through trusted
frontline workers.

The thesis is in `docs/access_tool_thesis.md`.
The product spec is in `docs/access_tool_v1_spec.md`.
The data and privacy architecture is in `docs/data_architecture.md`.

When the spec and the architecture doc disagree, the spec defines what the
tool is and the architecture doc defines how it is built and operated.

---

## Hard rule: re-read `docs/data_architecture.md` before any of these

The architecture doc lists ten trigger conditions for a non-scheduled re-read.
They are hard rules, not suggestions. Open the doc and re-read the relevant
section before:

1. Any change to the model provider.
2. Any change to the persistence layer (Vercel KV, Supabase, any database).
3. Any change to the logging surface (Sentry, Log Drain, analytics, even
   "just for this debug session").
4. Any change to authentication, accounts, or user identification.
5. Any change to refusal behavior or classifier behavior.
6. Any change to the kill switch mechanism.
7. Any new secret added to the env var set.
8. Any change to who has operational access.
9. Funding or partnership conversations that might shift project structure.
10. Any incident at Sev-1 or Sev-2.

If a change is in scope of any trigger, the change requires a dated entry in
`docs/decisions/` and an update to the architecture doc's "last reviewed" and
"last meaningful change" dates before the change lands.

---

## The non-negotiables (short version — full versions in the architecture doc)

- **No content logging, ever.** No debugging toggle. The toggle does not exist
  by design. Debug against synthetic reproductions, never against real user
  data.
- **No identity association.** No accounts, no email, no phone, no `user_id`,
  no `partner_id`, no session table. PII enters conversations by necessity
  but is never persisted.
- **No third-party logging, monitoring, or analytics.** No Sentry, Datadog,
  LogRocket, Bugsnag, Plausible, PostHog, Google Analytics, Vercel Analytics,
  Speed Insights, Web Analytics, or Log Drains. Detection is human.
- **Treat the user as a normal capable adult.** No refusal categories, no
  surveillance posture, no patronizing UI.

The full "no" list is in `docs/forbidden.md`. The full threat model and
residual risks are in `docs/data_architecture.md`.

---

## Operator context (calibrate accordingly)

The builder is self-taught, ~3 months into serious dev work, and runs things
through Vercel's dashboard rather than the CLI by default.

- Prefer dashboard-based instructions over CLI when both work.
- Flag CLI-only steps as such and offer the simpler alternative first when
  one exists.
- The bus-factor person is also non-technical-by-training; operational
  procedures must be executable by them.
- Recommendations that assume Kubernetes, custom CI pipelines, Terraform, or
  significant DevOps complexity are almost certainly the wrong answer. The
  right answer is usually simpler than the recommendation feels.

---

## Repo conventions

- `docs/` — thesis, spec, architecture, partner-facing materials.
- `docs/decisions/` — Architecture Decision Records (ADRs), one file per
  major decision, dated.
- `docs/forbidden.md` — the "no" list. Re-read before adding anything that
  feels like it might be on it.
- `incidents/` — public incident log. Sev-1/Sev-2 get a write-up within 7
  days. Sev-3 gets a one-paragraph entry in `incidents/log.md`.
- `tests/prompts/` — synthetic regression suite per button system prompt.
- `.env.example` — variable names with empty values. Real values live in
  Vercel env vars (production) and `.env.local` (gitignored, local dev).
- `OPERATIONAL_RUNBOOK.md` — screenshot-driven, phone-friendly, P0
  deliverable before any partner uses the tool.

---

## What's done, what's next

See `docs/decisions/` for the running record of architectural commitments.
The repo is intentionally scaffolded with the governance documents (this
file, the architecture doc, the "no" list, the ADR directory, the incidents
directory) before any application code, so the structural defenses against
drift are present from commit one.
