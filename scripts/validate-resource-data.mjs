import { readFile } from "node:fs/promises";
import path from "node:path";

const cwd = process.cwd();

const referralPath = path.join(cwd, "src/data/referrals.json");
const crisisPath = path.join(cwd, "src/data/crisis-resources.json");

const validWeakCategories = new Set([
  "legal_procedure",
  "medical_dosing",
  "benefits_eligibility",
  "immigration",
  "drug_interactions",
  "specific_deadlines",
  "specific_dollar_amounts",
  "none",
]);

const validReferralCategories = new Set(["all", ...validWeakCategories]);
const validRegions = new Set(["king", "fallback"]);

function fail(message) {
  throw new Error(message);
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
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

  for (const region of value) {
    if (!validRegions.has(region)) {
      fail(`${label} contains invalid region "${region}".`);
    }
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

    if (referral.phone !== undefined) {
      assertPhone(referral.phone, `Referral "${referral.id}" phone`);
    }

    if (referral.secondaryPhone !== undefined) {
      assertPhone(
        referral.secondaryPhone,
        `Referral "${referral.id}" secondaryPhone`,
      );
    }

    assertHttpsUrl(referral.website, `Referral "${referral.id}" website`);
    assertRegions(referral.regions, `Referral "${referral.id}" regions`);

    if (!Array.isArray(referral.categories) || referral.categories.length === 0) {
      fail(`Referral "${referral.id}" must have at least one category.`);
    }

    for (const category of referral.categories) {
      if (!validReferralCategories.has(category)) {
        fail(
          `Referral "${referral.id}" contains invalid category "${category}".`,
        );
      }
    }
  }

  console.log(`Validated ${referrals.length} referral resource(s).`);
}

function validateCrisisResources(resources) {
  if (!Array.isArray(resources) || resources.length === 0) {
    fail("src/data/crisis-resources.json must contain a non-empty array.");
  }

  const seenIds = new Set();

  for (const resource of resources) {
    if (!isNonEmptyString(resource.id)) {
      fail("Every crisis resource must have a non-empty id.");
    }

    assertUniqueId(resource.id, seenIds, "src/data/crisis-resources.json");

    if (!isNonEmptyString(resource.label)) {
      fail(`Crisis resource "${resource.id}" must have a non-empty label.`);
    }

    assertPhone(resource.phone, `Crisis resource "${resource.id}" phone`);
    assertHttpsUrl(resource.url, `Crisis resource "${resource.id}" url`);
    assertRegions(resource.regions, `Crisis resource "${resource.id}" regions`);
  }

  console.log(`Validated ${resources.length} crisis resource(s).`);
}

const [referrals, crisisResources] = await Promise.all([
  readJson(referralPath),
  readJson(crisisPath),
]);

validateReferrals(referrals);
validateCrisisResources(crisisResources);
