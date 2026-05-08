import path from "node:path";
import { readJsonFile } from "./lib/json-file.mjs";
import {
  isReferralCategory,
  referralCoverageCategories,
} from "./lib/taxonomy.mjs";

const cwd = process.cwd();

const referralPath = path.join(cwd, "src/data/referrals.json");
const crisisPath = path.join(cwd, "src/data/crisis-resources.json");

const validRegions = new Set(["king", "fallback"]);
const staleAfterDays = 180;

function fail(message) {
  throw new Error(message);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function assertHttpsUrl(value, label) {
  if (!isNonEmptyString(value)) {
    fail(`${label} must be a non-empty string.`);
  }

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
  if (!isNonEmptyString(value)) {
    fail(`${label} must be a non-empty string.`);
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    fail(`${label} must use YYYY-MM-DD.`);
  }

  const parsed = Date.parse(`${value}T00:00:00Z`);

  if (Number.isNaN(parsed)) {
    fail(`${label} must be a valid calendar date.`);
  }

  if (parsed > Date.now()) {
    fail(`${label} cannot be in the future.`);
  }
}

function collectStaleWarning(lastVerified, label, warnings) {
  const verifiedAt = Date.parse(`${lastVerified}T00:00:00Z`);
  const ageInDays = Math.floor((Date.now() - verifiedAt) / (1000 * 60 * 60 * 24));

  if (ageInDays > staleAfterDays) {
    warnings.push(`${label} was last verified ${ageInDays} days ago.`);
  }
}

function assertPhone(value, label) {
  if (!isNonEmptyString(value)) {
    fail(`${label} must be a non-empty string.`);
  }

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
    if (!isNonEmptyString(referral.id)) {
      fail("Every referral must have a non-empty id.");
    }

    assertUniqueId(referral.id, seenIds, "src/data/referrals.json");

    if (!isNonEmptyString(referral.name)) {
      fail(`Referral "${referral.id}" must have a non-empty name.`);
    }

    if (!isNonEmptyString(referral.description)) {
      fail(`Referral "${referral.id}" must have a non-empty description.`);
    }

    if (!isNonEmptyString(referral.sourceName)) {
      fail(`Referral "${referral.id}" must have a non-empty sourceName.`);
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
    if (!isNonEmptyString(resource.id)) {
      fail("Every crisis resource must have a non-empty id.");
    }

    assertUniqueId(resource.id, seenIds, "src/data/crisis-resources.json");

    if (!isNonEmptyString(resource.label)) {
      fail(`Crisis resource "${resource.id}" must have a non-empty label.`);
    }

    if (!isNonEmptyString(resource.sourceName)) {
      fail(`Crisis resource "${resource.id}" must have a non-empty sourceName.`);
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
