# 2026-05-07 — Repo scaffolded docs-first, not code-first

## Question

When initializing the repository, do we run `create-next-app` and write the
governance documents into a working application, or do we lay down the
governance documents (CLAUDE.md, the architecture doc, the "no" list, the
ADR directory, the incidents directory) before any application code exists?

## Options considered

**Option A — Code-first.** Run `npx create-next-app`, push the default
scaffold, then add CLAUDE.md, the architecture doc, the "no" list, and the
ADR/incidents directories as the project takes shape.

**Option B — Docs-first.** Lay down the governance documents at commit one,
add the application code after.

## Decision

Option B.

## Reasoning

The architectural commitments in `data_architecture.md` are structural
defenses against drift. They work because they are present from the start
and re-encountered every time someone opens the project — not because
they got bolted on after the fact.

Specifically:

- `CLAUDE.md` exists as the entry point for every future Claude Code session.
  If it shows up at commit fifteen, fifteen sessions have already happened
  without it. The cross-reference to the ten trigger conditions has the most
  force when it is the first thing a session reads.
- The "no" list (`docs/forbidden.md`) is a guardrail against future
  temptations. Its job is to be encountered before the temptation becomes a
  PR. Adding it after the fact still works, but adding it before any code
  exists makes the foreclosed paths feel foreclosed from the beginning.
- The ADR directory is an append-only record of decisions. Its first entry
  should be a real decision, not a retroactive justification.
- The incidents directory is empty by design. Standing it up early signals
  that incident response is a planned-for capability, not a panic-triggered
  scramble.
- The architecture doc itself names the repo structure as part of the
  defense (open-source code + public architecture doc + public incident log
  reinforcing each other). A repo that starts as a default Next.js scaffold
  and accumulates governance later does not have the same shape.

The cost of Option B is one commit's worth of overhead before any code
runs. The benefit is that the architectural ethos is materialized in the
repo from the moment the repo exists.

## Date

2026-05-07.
