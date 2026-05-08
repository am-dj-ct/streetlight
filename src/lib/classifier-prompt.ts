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

Choose a weak-category label when the response contains actionable guidance in that area, even if the answer is generally helpful.

Return the label only. No punctuation. No explanation.`;

export function parseWeakCategory(value: string): WeakCategory {
  const normalized = value.trim().toLowerCase() as WeakCategory;

  if (weakCategories.includes(normalized)) {
    return normalized;
  }

  return "none";
}
