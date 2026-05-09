# 2026-05-09 — AI-Assisted Launch Translations

## Question

Can Access Tool ship its seven-language locale files using AI-assisted
translation instead of requiring professional or community translation as a P0
launch gate?

## Context

The original architecture doc treated non-English UI and trust-page
translations as a human-only launch deliverable. In practice, that made
translation the last hard blocker even after the app, runbook, pause drills,
and launch docs were otherwise ready.

The operator chose to use AI-assisted translation for the initial locale pass
and accept that tradeoff explicitly rather than hold launch until human
translation could be organized.

This is an architecture trigger because it changes a previously documented P0
launch requirement and alters what the repo says about translation quality and
provenance.

## Options considered

### Option A — Keep human-only translation as a hard launch gate

Preserve the original requirement and block launch until professional or
community translators complete all six non-English locale sets.

### Option B — Allow AI-assisted translation for launch

Permit AI-generated locale files to satisfy launch readiness as long as:

- the locale structure is complete
- the app passes locale and build checks
- the translation pass is spot-checked for clarity, safety wording, privacy
  wording, and mobile UI fit
- partner-facing docs do not claim human-only translation when that is no
  longer true

## Decision

Choose **Option B**.

## Why

- It removes the final launch blocker without changing the app's privacy
  posture, provider surface, or logging surface.
- The translation files are static repo content, so they can still be audited,
  revised, and replaced later without product refactors.
- The more important honesty requirement is to avoid claiming a stricter
  translation provenance than the project actually used.

## What changed

- The six non-English locale files under `src/data/` are now complete and
  marked translated.
- Translation docs now allow AI-assisted launch translation with spot-check
  review.
- Partner-facing copy no longer says human translation is still being added.
- The English About copy no longer says UI translation is being added by
  humans.

## What did not change

- English remains the source of truth.
- Each supported language still gets its own static JSON files.
- The app still falls back honestly when a locale file is incomplete.
- Resource lists remain hand-maintained and are still not model-generated.
