export const supportedLanguageCodes = Object.freeze([
  "en",
  "es",
  "vi",
  "so",
  "ru",
  "am",
  "zh",
]);

export const weakCategories = Object.freeze([
  "legal_procedure",
  "medical_dosing",
  "benefits_eligibility",
  "immigration",
  "drug_interactions",
  "specific_deadlines",
  "specific_dollar_amounts",
  "none",
]);

export const referralCategories = Object.freeze(["all", ...weakCategories]);

export const referralCoverageCategories = Object.freeze(
  weakCategories.filter((category) => category !== "none"),
);

const supportedLanguageCodeSet = new Set(supportedLanguageCodes);
const weakCategorySet = new Set(weakCategories);
const referralCategorySet = new Set(referralCategories);

export function isSupportedLanguageCode(value) {
  return supportedLanguageCodeSet.has(value);
}

export function isWeakCategory(value) {
  return weakCategorySet.has(value);
}

export function isReferralCategory(value) {
  return referralCategorySet.has(value);
}
