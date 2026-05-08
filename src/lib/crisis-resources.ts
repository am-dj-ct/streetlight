import crisisResourcesData from "../data/crisis-resources.json";
import type { RegionScope } from "./geo";

export type CrisisResource = {
  id: string;
  label: string;
  phone: string;
  url: string;
  regions: RegionScope[];
};

const crisisResources = crisisResourcesData as CrisisResource[];

export function getCrisisResources(regionScope: RegionScope) {
  return crisisResources.filter((resource) =>
    resource.regions.includes(regionScope),
  );
}
