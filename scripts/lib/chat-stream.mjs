const weakCategories = new Set([
  "legal_procedure",
  "medical_dosing",
  "benefits_eligibility",
  "immigration",
  "drug_interactions",
  "specific_deadlines",
  "specific_dollar_amounts",
  "none",
]);

export function isChatStreamEvent(value) {
  if (!value || typeof value !== "object") {
    return false;
  }

  if (value.type === "delta") {
    return typeof value.text === "string";
  }

  if (value.type === "classifier") {
    return typeof value.category === "string" && weakCategories.has(value.category);
  }

  if (value.type === "error") {
    return typeof value.error === "string";
  }

  return false;
}
