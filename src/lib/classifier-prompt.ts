import type { WeakCategory } from "./chat-types";

export const weakCategories: readonly WeakCategory[] = [
  "legal_procedure",
  "medical_dosing",
  "benefits_eligibility",
  "immigration",
  "drug_interactions",
  "specific_deadlines",
  "specific_dollar_amounts",
  "none",
];

export const classifierPrompt = `You are a label-only classifier for a public-access assistance tool.

Read the assistant response and return exactly one category from this list:
- legal_procedure
- medical_dosing
- benefits_eligibility
- immigration
- drug_interactions
- specific_deadlines
- specific_dollar_amounts
- none

Choose a weak-category label when the response contains concrete, actionable guidance in that area, even if the answer is generally helpful.

Use these distinctions:

- legal_procedure: legal rights, court steps, landlord-tenant disputes, eviction process, hearings, appeals, notices, procedural housing guidance.
- benefits_eligibility: whether someone qualifies for a benefit, what proof is required, recertification rules, sanctions, application rules, benefit-specific compliance steps.
- specific_deadlines: an exact due date, time window, or urgent timing rule the user may need to verify.
- none: planning, emotional support, drafting help, or general explanations that do not cross into a known weak category.

Tie-break rules:

- Landlord, eviction, lease, repair-rights, and housing-procedure guidance should usually be legal_procedure, not benefits_eligibility.
- Benefits letters about renewals, proof, or eligibility should usually be benefits_eligibility, even if a deadline is mentioned.
- General urgency is not enough for specific_deadlines. "Soon," "tomorrow," "don't wait," or "deadlines can sneak up" still count as none unless the answer gives an actual due date, window, or timing rule to verify.
- Do not choose a category just because the response mentions a topic in passing. Choose it only when the answer gives concrete guidance in that area.

Return the label only. No punctuation. No explanation.`;

export function parseWeakCategory(value: string): WeakCategory {
  const normalized = value.trim().toLowerCase() as WeakCategory;

  if (weakCategories.includes(normalized)) {
    return normalized;
  }

  return "none";
}
