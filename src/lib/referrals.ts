import referralsData from "../data/referrals.json";
import {
  isConversationEntryId,
  isWeakCategory,
  type ConversationEntryId,
  type WeakCategory,
  weakCategories,
} from "./chat-types";
import type { RegionScope } from "./geo";
import type { SupportedLanguageCode } from "./languages";
import { isOneOf } from "./is-one-of";
import {
  buildConversationHref,
  buildHomeHref,
  type InternalAppPath,
} from "./routes";

type ReferralCategory = WeakCategory | "all";
type ReferralRegion = "king" | "fallback";

export type ReferralResource = {
  id: string;
  name: string;
  description: string;
  lastVerified: string;
  phone?: string;
  secondaryPhone?: string;
  sourceName: string;
  website: string;
  categories: ReferralCategory[];
  regions: ReferralRegion[];
};

const validReferralCategories: readonly ReferralCategory[] = [
  "all",
  ...weakCategories,
];
const validReferralRegions: readonly ReferralRegion[] = ["king", "fallback"];

function isReferralResource(value: unknown): value is ReferralResource {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<ReferralResource>;

  return (
    typeof candidate.id === "string" &&
    typeof candidate.name === "string" &&
    typeof candidate.description === "string" &&
    typeof candidate.lastVerified === "string" &&
    (candidate.phone === undefined || typeof candidate.phone === "string") &&
    (candidate.secondaryPhone === undefined ||
      typeof candidate.secondaryPhone === "string") &&
    typeof candidate.sourceName === "string" &&
    typeof candidate.website === "string" &&
    Array.isArray(candidate.categories) &&
    candidate.categories.every((category) => isOneOf(validReferralCategories, category)) &&
    !candidate.categories.includes("none") &&
    Array.isArray(candidate.regions) &&
    candidate.regions.every((region) => isOneOf(validReferralRegions, region))
  );
}

function loadReferrals(value: unknown): ReferralResource[] {
  if (!Array.isArray(value) || !value.every(isReferralResource)) {
    throw new Error("referrals.json is not a valid referral resource array.");
  }

  return value;
}

const referrals = loadReferrals(referralsData);

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
        resource.categories.includes("all") ||
        resource.categories.includes(category),
    )
    .sort((left, right) => {
      const leftSpecific = isSpecificCategoryMatch(left, category) ? 1 : 0;
      const rightSpecific = isSpecificCategoryMatch(right, category) ? 1 : 0;

      return rightSpecific - leftSpecific;
    });
}

export function getCheckedThroughDate(resources: ReferralResource[]) {
  if (resources.length === 0) {
    return null;
  }

  return resources.reduce((oldest, resource) =>
    resource.lastVerified < oldest ? resource.lastVerified : oldest,
  resources[0].lastVerified);
}

export function isReferralSpecificToCategory(
  resource: ReferralResource,
  category?: null | WeakCategory,
) {
  return isSpecificCategoryMatch(resource, category);
}

export function formatTelephoneHref(phone: string) {
  return `tel:${phone.replace(/[^0-9]/g, "")}`;
}

export function getBackHrefForReferrals({
  entryId,
  languageCode,
}: {
  entryId?: null | string;
  languageCode: SupportedLanguageCode;
}): InternalAppPath {
  if (!isConversationEntryId(entryId)) {
    return buildHomeHref(languageCode);
  }

  return buildConversationHref({
    entryId,
    languageCode,
  });
}

export function sanitizeFindHumanSearchParams({
  category,
  entryId,
}: {
  category?: null | string;
  entryId?: null | string;
}): {
  category: WeakCategory | undefined;
  entryId: ConversationEntryId | undefined;
} {
  return {
    category: isWeakCategory(category) ? category : undefined,
    entryId: isConversationEntryId(entryId) ? entryId : undefined,
  };
}

export { isWeakCategory } from "./chat-types";
