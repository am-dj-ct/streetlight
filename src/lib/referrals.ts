import referralsData from "../data/referrals.json";
import type { ConversationEntryId, WeakCategory } from "./chat-types";
import type { RegionScope } from "./geo";

type ReferralCategory = WeakCategory | "all";
type ReferralRegion = "king" | "fallback";

export type ReferralResource = {
  id: string;
  name: string;
  description: string;
  phone?: string;
  secondaryPhone?: string;
  website: string;
  categories: ReferralCategory[];
  regions: ReferralRegion[];
};

const referrals = referralsData as ReferralResource[];

function isSpecificCategoryMatch(
  resource: ReferralResource,
  category?: null | WeakCategory,
) {
  return Boolean(
    category &&
      category !== "none" &&
      resource.categories.includes(category),
  );
}

export function isWeakCategory(value: string): value is WeakCategory {
  return [
    "legal_procedure",
    "medical_dosing",
    "benefits_eligibility",
    "immigration",
    "drug_interactions",
    "specific_deadlines",
    "specific_dollar_amounts",
    "none",
  ].includes(value);
}

export function getWeakCategoryLabel(category: WeakCategory): string {
  switch (category) {
    case "legal_procedure":
      return "legal procedure";
    case "medical_dosing":
      return "medical dosing";
    case "benefits_eligibility":
      return "benefits eligibility";
    case "immigration":
      return "immigration";
    case "drug_interactions":
      return "drug interactions";
    case "specific_deadlines":
      return "specific deadlines";
    case "specific_dollar_amounts":
      return "specific dollar amounts";
    case "none":
    default:
      return "";
  }
}

export function getReferralsForCategory({
  category,
  regionScope,
}: {
  category?: null | WeakCategory;
  regionScope: RegionScope;
}) {
  const regionReferrals = referrals.filter((resource) =>
    resource.regions.includes(regionScope),
  );

  if (!category || category === "none") {
    return regionReferrals;
  }

  return regionReferrals
    .filter(
    (resource) =>
      resource.categories.includes("all") || resource.categories.includes(category),
    )
    .sort((left, right) => {
      const leftSpecific = isSpecificCategoryMatch(left, category) ? 1 : 0;
      const rightSpecific = isSpecificCategoryMatch(right, category) ? 1 : 0;

      return rightSpecific - leftSpecific;
    });
}

export function isReferralSpecificToCategory(
  resource: ReferralResource,
  category?: null | WeakCategory,
) {
  return isSpecificCategoryMatch(resource, category);
}

export function getBackHrefForReferrals({
  entryId,
  languageCode,
}: {
  entryId?: null | string;
  languageCode?: null | string;
}) {
  if (!entryId) {
    return languageCode ? `/?lang=${languageCode}` : "/";
  }

  return languageCode
    ? `/conversation/${entryId as ConversationEntryId}?lang=${languageCode}`
    : `/conversation/${entryId as ConversationEntryId}`;
}
