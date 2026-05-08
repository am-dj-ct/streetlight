import crisisResourcesData from "../data/crisis-resources.json";
import type { RegionScope } from "./geo";
import { isOneOf } from "./is-one-of";

export type CrisisResource = {
  id: string;
  label: string;
  lastVerified: string;
  phone: string;
  sourceName: string;
  url: string;
  regions: RegionScope[];
};

const validRegionScopes: readonly RegionScope[] = ["king", "fallback"];

function isCrisisResource(value: unknown): value is CrisisResource {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<CrisisResource>;

  return (
    typeof candidate.id === "string" &&
    typeof candidate.label === "string" &&
    typeof candidate.lastVerified === "string" &&
    typeof candidate.phone === "string" &&
    typeof candidate.sourceName === "string" &&
    typeof candidate.url === "string" &&
    Array.isArray(candidate.regions) &&
    candidate.regions.every((region) => isOneOf(validRegionScopes, region))
  );
}

function loadCrisisResources(value: unknown): CrisisResource[] {
  if (!Array.isArray(value) || !value.every(isCrisisResource)) {
    throw new Error("crisis-resources.json is not a valid crisis resource array.");
  }

  return value;
}

const crisisResources = loadCrisisResources(crisisResourcesData);

export function getCrisisResources(regionScope: RegionScope) {
  return crisisResources.filter((resource) =>
    resource.regions.includes(regionScope),
  );
}
