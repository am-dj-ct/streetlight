import { readJsonFile } from "./lib/json-file.mjs";
import { parseStrictIsoDate } from "./lib/iso-date.mjs";

const staleAfterDays = 180;
const resourceFiles = [
  { label: "Referral resources", path: new URL("../src/data/referrals.json", import.meta.url) },
  { label: "Crisis resources", path: new URL("../src/data/crisis-resources.json", import.meta.url) },
];

function fail(message) {
  console.error(message);
  process.exit(1);
}

function parseIsoDate(value, label) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    fail(`${label} must use YYYY-MM-DD.`);
  }

  const parsed = parseStrictIsoDate(value);

  if (parsed === null) {
    fail(`${label} must be a valid calendar date.`);
  }

  if (parsed > Date.now()) {
    fail(`${label} cannot be in the future.`);
  }

  return parsed;
}

function summarizeResources(resources) {
  return resources
    .map((resource) => {
      const verifiedAt = parseIsoDate(
        resource.lastVerified,
        `${resource.id ?? "unknown-id"} lastVerified`,
      );
      const ageInDays = Math.floor(
        (Date.now() - verifiedAt) / (1000 * 60 * 60 * 24),
      );

      return {
        id: resource.id,
        ageInDays,
        lastVerified: resource.lastVerified,
        sourceName: resource.sourceName,
      };
    })
    .sort((left, right) => right.ageInDays - left.ageInDays);
}

console.log("Access Tool resource status");
console.log("");

for (const resourceFile of resourceFiles) {
  const resources = await readJsonFile(resourceFile.path);

  if (!Array.isArray(resources) || resources.length === 0) {
    fail(`${resourceFile.label} must contain a non-empty array.`);
  }

  const sortedResources = summarizeResources(resources);
  const staleResources = sortedResources.filter(
    (resource) => resource.ageInDays > staleAfterDays,
  );

  console.log(resourceFile.label);
  console.log(`- count: ${sortedResources.length}`);
  console.log(`- stale over ${staleAfterDays} days: ${staleResources.length}`);

  for (const resource of sortedResources.slice(0, 3)) {
    console.log(
      `- ${resource.id}: ${resource.ageInDays} day(s) old, verified ${resource.lastVerified}, source ${resource.sourceName}`,
    );
  }

  console.log("");
}
