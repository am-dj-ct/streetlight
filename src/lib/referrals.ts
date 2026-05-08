import referralsData from "../data/referrals.json";
import type { ConversationEntryId, WeakCategory } from "./chat-types";

type ReferralCategory = WeakCategory | "all";

export type ReferralResource = {
  id: string;
  name: string;
  description: string;
  phone?: string;
  secondaryPhone?: string;
  website: string;
  categories: ReferralCategory[];
};

const referrals = referralsData as ReferralResource[];

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

export function getReferralsForCategory(category?: null | WeakCategory) {
  if (!category || category === "none") {
    return referrals;
  }

  return referrals.filter(
    (resource) =>
      resource.categories.includes("all") || resource.categories.includes(category),
  );
}

export function getBackHrefForReferrals(entryId?: null | string) {
  if (!entryId) {
    return "/";
  }

  return `/conversation/${entryId as ConversationEntryId}`;
}
