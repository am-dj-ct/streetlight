# 2026-05-09 — Classifier Specific-Dollar Amounts

## Question

How should the weak-category classifier handle assistant responses that explain
or act on exact dollar amounts?

## Context

The stress test found that the classifier correctly handled a medical bill
breakdown as `specific_dollar_amounts`, but missed rent-ledger and repayment
plan examples with exact amounts. Those answers can materially affect what a
user does next, so they should receive the same honest verification note as
other known weak categories.

Classifier behavior is an architecture trigger, so this change is documented
explicitly.

## Options Considered

### Option A — Leave the classifier prompt broad

Accept that some concrete dollar answers will not show a weak-category note.

### Option B — Define specific-dollar cases directly

Keep the same categories and same logging surface, but clarify that exact
balances, fees, rent owed, repayment plans, bill breakdowns, benefit amounts,
income thresholds, and dollar calculations should usually classify as
`specific_dollar_amounts`.

## Decision

Choose **Option B**.

## Why

- Exact dollar amounts are the kind of thing users may rely on immediately.
- The fix keeps the same provider, same label-only output, same metadata
  schema, and same no-content-logging posture.
- A prompt clarification plus regression fixtures is the smallest useful
  intervention.

## What Changed

- `src/lib/classifier-prompt.ts` now explicitly defines
  `specific_dollar_amounts`.
- The classifier tie-break rules now name rent ledgers, repayment plans,
  payment plans, medical bills, overpayment notices, and fee breakdowns.
- The benefits tie-break examples were also made more explicit so benefit
  warning letters continue to classify as `benefits_eligibility` rather than
  falling through to `none` or a dollar/deadline category.
- Regression fixtures now cover a rent-ledger/payment-plan case and a medical
  bill dollar-breakdown case.

## What Did Not Change

- No new categories.
- No thresholding.
- No classifier reasoning text stored or surfaced.
- No logging-surface change.
- No new persistence or analytics.
