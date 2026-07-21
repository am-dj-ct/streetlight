import path from "node:path";
import { readJsonFile } from "./lib/json-file.mjs";
import {
  isReferralCategory,
  referralCoverageCategories,
} from "./lib/taxonomy.mjs";
import { parseStrictIsoDate } from "./lib/iso-date.mjs";

const cwd = process.cwd();

const referralPath = path.join(cwd, "src/data/referrals.json");
const crisisPath = path.join(cwd, "src/data/crisis-resources.json");

const validRegions = new Set(["king", "fallback"]);
const staleAfterDays = 180;
const resourceIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const controlCharacterPattern = /[\u0000-\u001f\u007f]/;

function fail(message) {
  throw new Error(message);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function assertCleanString(value, label) {
  if (!isNonEmptyString(value)) {
    fail(`${label} must be a non-empty string.`);
  }

  if (value !== value.trim()) {
    fail(`${label} must not have leading or trailing whitespace.`);
  }

  if (controlCharacterPattern.test(value)) {
    fail(`${label} must not contain control characters.`);
  }
}

function assertResourceId(value, label) {
  assertCleanString(value, label);

  if (!resourceIdPattern.test(value)) {
    fail(`${label} must use lowercase kebab-case.`);
  }
}

function assertHttpsUrl(value, label) {
  assertCleanString(value, label);

  try {
    const url = new URL(value);

    if (url.protocol !== "https:") {
      fail(`${label} must use https.`);
    }
  } catch {
    fail(`${label} must be a valid URL.`);
  }
}

function assertIsoDate(value, label) {
  assertCleanString(value, label);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    fail(`${label} must use YYYY-MM-DD.`);
  }

  const parsed = parseStrictIsoDate(value);

  if (parsed === null) {
    fail(`${label} must be a valid calendar date.`);
  }

  if (parsed > Date.now()) {
    fail(`${label} cannot be in the future.`);
  }
}

function collectStaleWarning(lastVerified, label, warnings) {
  const verifiedAt = parseStrictIsoDate(lastVerified);

  if (verifiedAt === null) {
    return;
  }

  const ageInDays = Math.floor((Date.now() - verifiedAt) / (1000 * 60 * 60 * 24));

  if (ageInDays > staleAfterDays) {
    warnings.push(`${label} was last verified ${ageInDays} days ago.`);
  }
}

function assertPhone(value, label) {
  assertCleanString(value, label);

  const digits = value.replace(/[^0-9]/g, "");

  if (digits.length < 3) {
    fail(`${label} must contain at least 3 digits.`);
  }
}

function assertRegions(value, label) {
  if (!Array.isArray(value) || value.length === 0) {
    fail(`${label} must be a non-empty array.`);
  }

  const seenRegions = new Set();

  for (const region of value) {
    if (!validRegions.has(region)) {
      fail(`${label} contains invalid region "${region}".`);
    }

    if (seenRegions.has(region)) {
      fail(`${label} contains duplicate region "${region}".`);
    }

    seenRegions.add(region);
  }
}

function assertUniqueId(id, seenIds, label) {
  if (seenIds.has(id)) {
    fail(`${label} contains duplicate id "${id}".`);
  }

  seenIds.add(id);
}

function validateReferrals(referrals) {
  if (!Array.isArray(referrals) || referrals.length === 0) {
    fail("src/data/referrals.json must contain a non-empty array.");
  }

  const seenIds = new Set();
  const regionCoverage = new Map(
    [...validRegions].map((region) => [
      region,
      new Map(referralCoverageCategories.map((category) => [category, 0])),
    ]),
  );
  const warnings = [];

  for (const referral of referrals) {
    assertResourceId(referral.id, "Every referral id");
    assertUniqueId(referral.id, seenIds, "src/data/referrals.json");

    assertCleanString(referral.name, `Referral "${referral.id}" name`);
    assertCleanString(referral.description, `Referral "${referral.id}" description`);
    assertCleanString(referral.sourceName, `Referral "${referral.id}" sourceName`);
    assertHttpsUrl(referral.sourceUrl, `Referral "${referral.id}" sourceUrl`);

    if (
      referral.skipSourceCheck !== undefined &&
      typeof referral.skipSourceCheck !== "boolean"
    ) {
      fail(`Referral "${referral.id}" skipSourceCheck must be a boolean.`);
    }

    assertIsoDate(
      referral.lastVerified,
      `Referral "${referral.id}" lastVerified`,
    );
    collectStaleWarning(
      referral.lastVerified,
      `Referral "${referral.id}"`,
      warnings,
    );

    if (referral.phone !== undefined) {
      assertPhone(referral.phone, `Referral "${referral.id}" phone`);
    }

    if (referral.secondaryPhone !== undefined) {
      assertPhone(
        referral.secondaryPhone,
        `Referral "${referral.id}" secondaryPhone`,
      );

      if (referral.secondaryPhone === referral.phone) {
        fail(`Referral "${referral.id}" secondaryPhone must differ from phone.`);
      }
    }

    if (referral.secondaryPhoneType !== undefined) {
      if (referral.secondaryPhone === undefined) {
        fail(`Referral "${referral.id}" secondaryPhoneType requires secondaryPhone.`);
      }

      if (
        referral.secondaryPhoneType !== "call" &&
        referral.secondaryPhoneType !== "text"
      ) {
        fail(`Referral "${referral.id}" secondaryPhoneType must be "call" or "text".`);
      }
    }

    assertHttpsUrl(referral.website, `Referral "${referral.id}" website`);
    assertRegions(referral.regions, `Referral "${referral.id}" regions`);

    if (!Array.isArray(referral.categories) || referral.categories.length === 0) {
      fail(`Referral "${referral.id}" must have at least one category.`);
    }

    const seenCategories = new Set();

    for (const category of referral.categories) {
      if (!isReferralCategory(category)) {
        fail(
          `Referral "${referral.id}" contains invalid category "${category}".`,
        );
      }

      if (seenCategories.has(category)) {
        fail(`Referral "${referral.id}" contains duplicate category "${category}".`);
      }

      seenCategories.add(category);
    }

    if (seenCategories.has("none")) {
      fail(`Referral "${referral.id}" cannot use the classifier-only category "none".`);
    }

    for (const region of referral.regions) {
      const coverageForRegion = regionCoverage.get(region);

      if (!coverageForRegion) {
        continue;
      }

      for (const category of referralCoverageCategories) {
        if (seenCategories.has("all") || seenCategories.has(category)) {
          coverageForRegion.set(category, (coverageForRegion.get(category) ?? 0) + 1);
        }
      }
    }
  }

  for (const region of validRegions) {
    const coverageForRegion = regionCoverage.get(region);

    if (!coverageForRegion) {
      continue;
    }

    for (const category of referralCoverageCategories) {
      if ((coverageForRegion.get(category) ?? 0) === 0) {
        fail(`Referral coverage is missing for region "${region}" and category "${category}".`);
      }
    }
  }

  console.log(`Validated ${referrals.length} referral resource(s).`);

  for (const warning of warnings) {
    console.log(`Warning: ${warning}`);
  }
}

function validateCrisisResources(resources) {
  if (!Array.isArray(resources) || resources.length === 0) {
    fail("src/data/crisis-resources.json must contain a non-empty array.");
  }

  const seenIds = new Set();
  const regionCounts = new Map([...validRegions].map((region) => [region, 0]));
  const warnings = [];

  for (const resource of resources) {
    assertResourceId(resource.id, "Every crisis resource id");
    assertUniqueId(resource.id, seenIds, "src/data/crisis-resources.json");

    assertCleanString(resource.label, `Crisis resource "${resource.id}" label`);
    assertCleanString(resource.sourceName, `Crisis resource "${resource.id}" sourceName`);

    if (
      resource.skipSourceCheck !== undefined &&
      typeof resource.skipSourceCheck !== "boolean"
    ) {
      fail(`Crisis resource "${resource.id}" skipSourceCheck must be a boolean.`);
    }

    assertIsoDate(
      resource.lastVerified,
      `Crisis resource "${resource.id}" lastVerified`,
    );
    collectStaleWarning(
      resource.lastVerified,
      `Crisis resource "${resource.id}"`,
      warnings,
    );

    assertPhone(resource.phone, `Crisis resource "${resource.id}" phone`);
    assertHttpsUrl(resource.sourceUrl, `Crisis resource "${resource.id}" sourceUrl`);
    assertHttpsUrl(resource.url, `Crisis resource "${resource.id}" url`);
    assertRegions(resource.regions, `Crisis resource "${resource.id}" regions`);

    for (const region of resource.regions) {
      regionCounts.set(region, (regionCounts.get(region) ?? 0) + 1);
    }
  }

  for (const region of validRegions) {
    if ((regionCounts.get(region) ?? 0) === 0) {
      fail(`Crisis resources are missing all entries for region "${region}".`);
    }
  }

  console.log(`Validated ${resources.length} crisis resource(s).`);

  for (const warning of warnings) {
    console.log(`Warning: ${warning}`);
  }
}

const [referrals, crisisResources] = await Promise.all([
  readJsonFile(referralPath),
  readJsonFile(crisisPath),
]);

validateReferrals(referrals);
validateCrisisResources(crisisResources);
