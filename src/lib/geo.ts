export type RegionScope = "king" | "fallback";

export function getRegionScope({
  countryHeader,
  regionHeader,
}: {
  countryHeader?: null | string;
  regionHeader?: null | string;
}): RegionScope {
  const country = countryHeader?.trim().toUpperCase();
  const region = regionHeader?.trim().toUpperCase();

  if (!country || !region) {
    return "king";
  }

  return country === "US" && region === "WA" ? "king" : "fallback";
}
