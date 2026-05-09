# 2026-05-09 — V2 Weak-Category Taxonomy Expansion

## Question

Should the weak-category classifier expand beyond the original V1 set, and if
so, which additions are worth the maintenance cost?

## Context

The original weak-category taxonomy was intentionally small. It covered a
practical set of places where the model can sound useful but be materially
wrong, and where the product should respond with an honest verification note
plus better human-help ordering.

Stress-test review found three recurring gaps:

- concrete health-decision guidance that is not dose math or medication mixing
- workplace-rights guidance that currently falls between legal procedure and
  `none`
- document-requirement guidance that is not primarily a benefits, immigration,
  or court-process question

Classifier behavior is an architecture trigger, so this change is documented
explicitly.

## Decision

Expand the taxonomy by exactly three categories:

- `medical_decisionmaking`
- `employment_rights`
- `identity_documentation`

Keep the existing categories and keep the same single-label classifier design.

## Why

- The three new categories cover common, concrete answer types that users may
  rely on immediately.
- They improve honesty and `Find a human` ordering without turning the second
  pass into a large ontology.
- They are distinct enough to support prompt definitions, tie-break rules, and
  regression fixtures.

## What Changed

- `src/lib/chat-types.ts` adds the three labels to the weak-category enum.
- `src/lib/classifier-prompt.ts` now defines the three labels directly and adds
  tie-break rules against benefits, immigration, legal procedure, medical
  dosing, and drug interactions.
- `src/data/referrals.json` now tags a small set of existing resources for the
  new categories rather than creating new routing branches.
- Regression fixtures now include explicit positive and overlap cases for the
  new labels, plus a direct `specific_deadlines` case.

## What Did Not Change

- No refusal layer.
- No keyword crisis detector.
- No classifier-based crisis routing.
- No logging-surface change.
- No new provider, persistence, analytics, or secrets changes.
