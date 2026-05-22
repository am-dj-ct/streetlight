# AGENTS.md

Shared instructions for coding agents working on Streetlight. Claude Code
imports this file from `CLAUDE.md`; Codex and other agents should read it
directly. Cross-project workflow and safety rules belong in the user's global
`AGENTS.md`.

Keep this file concise. Put long rationale in `docs/`, not here.

---

## Project

Streetlight is a free, public, mobile-web LLM tool for people experiencing
homelessness, housing insecurity, or extreme poverty in Seattle / King County.
It is anonymous by default: no accounts, no PII retention, no ads, no upsell,
no premium tier, and no surveillance-shaped analytics.

Core docs:

- `docs/access_tool_thesis.md`: why this exists.
- `docs/access_tool_v1_spec.md`: what V1 should do.
- `docs/data_architecture.md`: privacy, data flow, threat model, logging,
  persistence, abuse controls, ops.
- `docs/forbidden.md`: the "no" list.
- `docs/decisions/`: dated ADRs.

When the spec and architecture doc disagree, the spec defines what the tool is;
the architecture doc defines how it is built and operated.

---

## Non-Negotiables

- No content logging, ever: no request bodies, model messages, conversation
  content, classifier input, exact user text, TTS text, or raw model responses.
- No content-debugging toggle. Debug only with synthetic reproductions.
- No accounts, email/phone collection, user IDs, partner IDs, session table, or
  per-user history.
- No Sentry, Datadog, LogRocket, Bugsnag, Plausible, PostHog, Google Analytics,
  Vercel Analytics, Speed Insights, Web Analytics, Log Drains, or equivalents.
- No keyword crisis detector and no classifier-based crisis routing.
- No extra refusal layer, content filter, or sentiment classifier.
- Treat users as normal capable adults. No patronizing UX or hidden data
  collection.

If a proposed fix seems to require one of these, stop and redesign.

---

## Architecture Re-Read Triggers

Before landing any change in these areas, re-read `docs/data_architecture.md`.
If the doc says an ADR/update is required, do that before the change lands.

- Model/provider behavior, prompt routing, model fallback, response style.
- Persistence, KV, database, cache, queue, storage, or generated secrets.
- Logging, telemetry, monitoring, analytics, traces, log drains, error tools.
- Auth, accounts, cookies, user identity, partner identity.
- Refusal behavior, safety behavior, classifier behavior, crisis behavior.
- Kill switch, soft pause, rate limits, spend controls, Turnstile, abuse
  controls.
- Operational access, collaborators, funding/partnership structure, or any
  Sev-1/Sev-2 incident.

---

## Stack And Key Surfaces

- Next.js App Router, TypeScript, Tailwind.
- Main UI: `src/app/`, `src/components/`, `src/lib/`.
- Static translations/content/resources: `src/data/`.
- Chat streaming: `src/app/api/chat/route.ts`.
- Read-aloud: `src/app/api/tts/route.ts`.
- Weak-category classifier: `src/lib/classifier-prompt.ts`.
- Main response prompt: `src/lib/system-prompts.ts`.
- Metadata logging: `src/lib/metadata-log.ts`.
- Referral filtering/resources: `src/lib/referrals.ts`, `src/data/referrals.json`,
  `src/data/crisis-resources.json`.
- Phone links/actions: `src/components/phone-action.tsx`.
- Persistent crisis/app footer: `src/components/crisis-footer.tsx`.

The desktop UI is intentionally a centered wider version of mobile. Do not add
sidebars or dashboard chrome without a product decision.

---

## Product Rules

- Use "organized," not "curated."
- Use "device," not "phone," except for actual phone numbers.
- No direct phone links in normal UI. Phone actions go through
  `src/components/phone-action.tsx`.
- Direct `tel:` appears only inside the explicit "Open calling app" action.
- Phone dialog actions: `Use this number`, `Copy number`, `Open website`,
  `Open calling app`, `Close`.
- Crisis/resource phone dialogs include website links where available.
- KCSARC and national crisis-only resources stay data-only `crisis`, not `all`.
- Benefits-filtered King County resources: King County 211, DSHS Community
  Services, Washington Healthplanfinder.
- Mobile keyboard/footer behavior matters. Verify on narrow viewports when
  layout changes.

---

## Commands

Use `npm`.

Dev:

- `npm run dev:mock`: no-spend mock chat.
- `npm run dev:live`: live model path.
- `npm run build`

Routine checks:

- `npm run lint`
- `npm run build`
- `npm run smoke:quick`
- `npm run validate:data`
- `npm run check:content`
- `npm run check:locales:summary`
- `npm run check:translation-worklist`
- `npm run check:forbidden-integrations`
- `npm run check:no-tracked-secrets`
- `npm run diagnostics:local`

Broad checks:

- `npm run verify:quick`: normal confidence pass.
- `npm run verify:mock`: no-spend full mock plumbing.
- `npm run verify`: live full prompt regression; use deliberately.

Prompt/model/classifier checks:

- `npm run regression:stable-core`
- `npm run regression:watchlist`
- `npm run check:response-style`
- `npm run check:weak-category-recall`

Ops:

- `npm run ops:status`
- `npm run cost:status`
- `npm run check:env`
- `npm run check:launch`

---

## Verification Expectations

- Docs-only: `git diff --check`; add targeted docs/content checks if relevant.
- UI/copy: lint, build, content/locales/translation checks, and browser/mobile
  verification for layout, keyboard, or footer changes.
- Data/resources: `npm run validate:data` and `npm run check:content`.
- Model/prompt/classifier/logging/env/abuse controls: re-read architecture,
  update ADR/docs as required, run targeted live checks plus `npm run
  verify:quick`.
- Classifier changes: also run `npm run regression:stable-core` and
  `npm run check:weak-category-recall`.
- Response-style changes: also run `npm run check:response-style`.

Before finishing, report what changed and which checks passed. If a check was
not run, say why.

---

## Classifier And Logging

- Weak-category classifier is post-hoc, label-only, and recall-first.
- It can show a "verify with a person" note and pre-filter resources.
- It must not become crisis routing, refusal routing, or profiling.
- Do not add keyword detectors.
- Keep prompt tests synthetic. Never put real user content in fixtures.
- Metadata logs must stay allowlisted and content-free. Do not log raw
  Anthropic/Azure/Vercel KV request, response, or error objects.

Useful classifier docs:

- `docs/weak_category_recall_protocol.md`
- `docs/weak_category_tiered_prompt_protocol.md`
- `tests/prompts/weak-category-recall-cases.json`
- `tests/prompts/stable-core.txt`
- `tests/prompts/variance-watchlist.txt`

---

## Deployment And Git

- Production is Vercel.
- After push/deploy, confirm `/healthz` shows the expected commit SHA,
  `deployEnv=production`, `chatMode=live-model`, and `deployConfigOk=true`.
- Prefer dashboard-first instructions for the operator. Label CLI-only steps
  clearly.
- Never revert user changes you did not make.
- Keep edits scoped; prefer existing local patterns over new abstractions.
- Do not commit or push unless the user asks or the current task clearly
  authorized it.

---

## Handoff Discipline

If the user asks for a "handoff" in any form, provide a concise handoff summary
in chat unless they explicitly ask for a file.

Include current goal, current state, files changed, commands run and results,
git status and latest commit if relevant, production/deploy state if touched,
skipped checks or blockers, and next recommended steps.

Do not create or update `HANDOFF.md` unless the user explicitly asks for a
persistent file.
