import { readFile } from "node:fs/promises";
import path from "node:path";
import { readJsonFile } from "./json-file.mjs";

export const localeDirectories = [
  "src/data/ui-copy",
  "src/data/conversation-content",
  "src/data/static-pages",
];

export const launchFiles = [
  "README.md",
  "OPERATIONAL_RUNBOOK.md",
  "docs/partners/launch-packet.md",
  "docs/partners/launch_checklist.md",
];

export const resourceFiles = [
  { label: "referrals", path: "src/data/referrals.json" },
  { label: "crisis", path: "src/data/crisis-resources.json" },
];

export const placeholderChecks = [
  {
    pattern: /\[Screenshot:[^\]]+\]/g,
    reason: "runbook screenshots still missing",
    scope: "external",
  },
  {
    pattern: /\bADD-LIVE-URL-HERE\b/g,
    reason: "live URL placeholder still present",
    scope: "external",
  },
  {
    pattern: /\[ADD-[A-Z0-9-]+\]/g,
    reason: "launch contact placeholder still present",
    scope: "external",
  },
  {
    pattern: /\bTBD\b/g,
    reason: "TBD marker still present",
    scope: "external",
  },
];

export const supportedTranslationLanguageCodes = [
  "es",
  "vi",
  "so",
  "ru",
  "am",
  "zh",
];

export const staleAfterDays = 180;

export function flattenObject(obj, prefix = "") {
  return Object.entries(obj).flatMap(([key, value]) => {
    const nextKey = prefix ? `${prefix}.${key}` : key;

    if (value && typeof value === "object" && !Array.isArray(value)) {
      return flattenObject(value, nextKey);
    }

    return [nextKey];
  });
}

export function getMissingKeys(baseValue, compareValue, prefix = "") {
  return Object.entries(baseValue).flatMap(([key, value]) => {
    const nextKey = prefix ? `${prefix}.${key}` : key;
    const compareEntry = compareValue?.[key];

    if (Array.isArray(value)) {
      return Array.isArray(compareEntry) && compareEntry.length > 0 ? [] : [nextKey];
    }

    if (value && typeof value === "object") {
      return getMissingKeys(value, compareEntry ?? {}, nextKey);
    }

    return compareEntry === undefined ? [nextKey] : [];
  });
}

export function parseIsoDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const parsed = Date.parse(`${value}T00:00:00Z`);
  return Number.isNaN(parsed) ? null : parsed;
}

async function readJsonFromCwd(cwd, relativePath) {
  return readJsonFile(path.join(cwd, relativePath));
}

export async function collectLaunchDocPlaceholderIssues(cwd) {
  const issues = [];

  for (const relativePath of launchFiles) {
    const contents = await readFile(path.join(cwd, relativePath), "utf8");

    for (const check of placeholderChecks) {
      const matches = contents.match(check.pattern) ?? [];

      if (matches.length === 0) {
        continue;
      }

      issues.push({
        matches,
        reason: check.reason,
        relativePath,
        scope: check.scope,
      });
    }
  }

  return issues;
}

export async function getTranslationReadiness(cwd) {
  const summaries = [];

  for (const languageCode of supportedTranslationLanguageCodes) {
    const sections = [];

    for (const relativeDir of localeDirectories) {
      const baseDocument = await readJsonFromCwd(cwd, `${relativeDir}/en.json`);
      const localeDocument = await readJsonFromCwd(
        cwd,
        `${relativeDir}/${languageCode}.json`,
      );
      const missingKeys = getMissingKeys(baseDocument, localeDocument);
      const baseKeys = flattenObject(baseDocument).length;

      sections.push({
        baseKeys,
        missingKeys,
        relativeDir,
        translated: localeDocument.meta?.translated === true,
      });
    }

    summaries.push({
      languageCode,
      sections,
    });
  }

  return summaries;
}

export async function getResourceFreshness(cwd) {
  const summaries = [];

  for (const resourceFile of resourceFiles) {
    const resources = await readJsonFromCwd(cwd, resourceFile.path);

    if (!Array.isArray(resources) || resources.length === 0) {
      summaries.push({
        error: `${resourceFile.path} must contain a non-empty array.`,
        label: resourceFile.label,
        path: resourceFile.path,
      });
      continue;
    }

    const ages = resources.map((resource) => {
      const parsed = parseIsoDate(resource.lastVerified);

      return {
        ageInDays:
          parsed === null
            ? null
            : Math.floor((Date.now() - parsed) / (1000 * 60 * 60 * 24)),
        id: resource.id ?? "unknown-id",
        invalidDate: parsed === null,
      };
    });

    const oldest = ages
      .filter((entry) => entry.ageInDays !== null)
      .sort((left, right) => (right.ageInDays ?? -1) - (left.ageInDays ?? -1))[0];
    const staleCount = ages.filter(
      (entry) => entry.ageInDays !== null && entry.ageInDays > staleAfterDays,
    ).length;

    summaries.push({
      invalidDateCount: ages.filter((entry) => entry.invalidDate).length,
      label: resourceFile.label,
      oldestAgeInDays: oldest?.ageInDays ?? null,
      oldestId: oldest?.id ?? null,
      path: resourceFile.path,
      staleCount,
      total: ages.length,
    });
  }

  return summaries;
}
