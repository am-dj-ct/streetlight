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

type ReferralCategory = WeakCategory | "all" | "crisis";
type ReferralRegion = "king" | "fallback";

export type ReferralResource = {
  id: string;
  name: string;
  description: string;
  lastVerified: string;
  phone?: string;
  secondaryPhone?: string;
  secondaryPhoneType?: "call" | "text";
  sourceName: string;
  sourceUrl: string;
  website: string;
  categories: ReferralCategory[];
  regions: ReferralRegion[];
};

const validReferralCategories: readonly ReferralCategory[] = [
  "all",
  "crisis",
  ...weakCategories,
];
const validReferralRegions: readonly ReferralRegion[] = ["king", "fallback"];

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isReferralResource(value: unknown): value is ReferralResource {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<ReferralResource>;

  return (
    isNonEmptyString(candidate.id) &&
    isNonEmptyString(candidate.name) &&
    isNonEmptyString(candidate.description) &&
    isNonEmptyString(candidate.lastVerified) &&
    (candidate.phone === undefined || isNonEmptyString(candidate.phone)) &&
    (candidate.secondaryPhone === undefined ||
      isNonEmptyString(candidate.secondaryPhone)) &&
    (candidate.secondaryPhoneType === undefined ||
      candidate.secondaryPhoneType === "call" ||
      candidate.secondaryPhoneType === "text") &&
    isNonEmptyString(candidate.sourceName) &&
    isNonEmptyString(candidate.sourceUrl) &&
    isNonEmptyString(candidate.website) &&
    Array.isArray(candidate.categories) &&
    candidate.categories.length > 0 &&
    candidate.categories.every((category) => isOneOf(validReferralCategories, category)) &&
    !candidate.categories.includes("none") &&
    Array.isArray(candidate.regions) &&
    candidate.regions.length > 0 &&
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
    case "medical_decisionmaking":
      return "medical decision-making";
    case "benefits_eligibility":
      return "benefits eligibility";
    case "immigration":
      return "immigration";
    case "drug_interactions":
      return "drug interactions";
    case "employment_rights":
      return "employment rights";
    case "identity_documentation":
      return "identity documentation";
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
