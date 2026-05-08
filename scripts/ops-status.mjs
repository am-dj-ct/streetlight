import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { defaultBaseUrl, getHealth as fetchHealth } from "./lib/access-tool-http.mjs";
import { getLanguagePersistenceSnapshot } from "./lib/language-persistence.mjs";

const baseUrl = defaultBaseUrl;
const envLocalPath = new URL("../.env.local", import.meta.url);
const localeDirectories = [
  "src/data/ui-copy",
  "src/data/conversation-content",
  "src/data/static-pages",
];
const launchFiles = [
  "README.md",
  "OPERATIONAL_RUNBOOK.md",
  "docs/partners/launch-packet.md",
  "docs/partners/launch_checklist.md",
];
const resourceFiles = [
  { label: "referrals", path: "src/data/referrals.json" },
  { label: "crisis", path: "src/data/crisis-resources.json" },
];
const placeholderChecks = [
  {
    pattern: /\[Screenshot:[^\]]+\]/g,
    reason: "runbook screenshots still missing",
  },
  {
    pattern: /\bADD-LIVE-URL-HERE\b/g,
    reason: "live URL placeholder still present",
  },
  {
    pattern: /\[ADD-[A-Z0-9-]+\]/g,
    reason: "launch contact placeholder still present",
  },
  {
    pattern: /\bTBD\b/g,
    reason: "TBD marker still present",
  },
];
const staleAfterDays = 180;

function fail(message) {
  console.error(message);
  process.exit(1);
}

function classifyLaunchDocIssue(issue) {
  return issue.includes("placeholder") || issue.includes("screenshots")
    ? "external"
    : "internal";
}

function runNodeScript(scriptPath, args = []) {
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
  });

  if (result.error) {
    fail(`Failed to run ${scriptPath}: ${result.error.message}`);
  }

  if (result.status !== 0) {
    fail(`${scriptPath} exited ${result.status}.\n${result.stderr || result.stdout}`);
  }

  return result.stdout.trim();
}

function readEnvValue(contents, variable) {
  const match = contents.match(new RegExp(`^${variable}=(.*)$`, "m"));
  return match ? match[1].trim() : null;
}

function summarizeBoolean(value) {
  return value ? "yes" : "no";
}

function parseIsoDate(value, label) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    fail(`${label} must use YYYY-MM-DD.`);
  }

  const parsed = Date.parse(`${value}T00:00:00Z`);

  if (Number.isNaN(parsed)) {
    fail(`${label} must be a valid calendar date.`);
  }

  return parsed;
}

function flattenObject(obj, prefix = "") {
  return Object.entries(obj).flatMap(([key, value]) => {
    const nextKey = prefix ? `${prefix}.${key}` : key;

    if (value && typeof value === "object" && !Array.isArray(value)) {
      return flattenObject(value, nextKey);
    }

    return [nextKey];
  });
}

function getMissingKeys(baseValue, compareValue, prefix = "") {
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

async function getEnvSnapshot() {
  try {
    const contents = await readFile(envLocalPath, "utf8");

    return {
      devMockChat: readEnvValue(contents, "DEV_MOCK_CHAT") ?? "unset",
      mainModel: readEnvValue(contents, "MAIN_MODEL") ?? "unset",
      classifierModel: readEnvValue(contents, "CLASSIFIER_MODEL") ?? "unset",
    };
  } catch {
    return {
      devMockChat: "missing .env.local",
      mainModel: "missing .env.local",
      classifierModel: "missing .env.local",
    };
  }
}

async function getLanguageSnapshot() {
  const snapshot = await getLanguagePersistenceSnapshot({ baseUrl, fail });

  return {
    homeLang: snapshot.homeLang ?? "(missing)",
    languageCookie: snapshot.languageCookie ?? "(missing)",
    privacyLang: snapshot.privacyLang ?? "(missing)",
  };
}

async function getPlaceholderSummary() {
  const results = [];

  for (const relativePath of launchFiles) {
    const contents = await readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");

    for (const check of placeholderChecks) {
      const matches = contents.match(check.pattern) ?? [];

      if (matches.length > 0) {
        results.push(`${relativePath}: ${check.reason} (${matches.length})`);
      }
    }
  }

  return results;
}

async function getResourceFreshnessSummary() {
  const summaries = [];

  for (const resourceFile of resourceFiles) {
    const resources = JSON.parse(
      await readFile(new URL(`../${resourceFile.path}`, import.meta.url), "utf8"),
    );

    if (!Array.isArray(resources) || resources.length === 0) {
      fail(`${resourceFile.path} must contain a non-empty array.`);
    }

    const ages = resources.map((resource) => {
      const verifiedAt = parseIsoDate(
        resource.lastVerified,
        `${resource.id ?? "unknown-id"} lastVerified`,
      );
      const ageInDays = Math.floor(
        (Date.now() - verifiedAt) / (1000 * 60 * 60 * 24),
      );

      return {
        ageInDays,
        id: resource.id ?? "unknown-id",
      };
    });

    const oldest = ages.sort((left, right) => right.ageInDays - left.ageInDays)[0];
    const staleCount = ages.filter((entry) => entry.ageInDays > staleAfterDays).length;

    summaries.push({
      label: resourceFile.label,
      oldestAgeInDays: oldest.ageInDays,
      oldestId: oldest.id,
      staleCount,
      total: ages.length,
    });
  }

  return summaries;
}

async function getTranslationSummary() {
  const localeFiles = ["es", "vi", "so", "ru", "am", "zh"];
  const summaries = [];

  for (const languageCode of localeFiles) {
    const sectionSummaries = [];

    for (const relativeDir of localeDirectories) {
      const baseDocument = JSON.parse(
        await readFile(new URL(`../${relativeDir}/en.json`, import.meta.url), "utf8"),
      );
      const localeDocument = JSON.parse(
        await readFile(new URL(`../${relativeDir}/${languageCode}.json`, import.meta.url), "utf8"),
      );
      const missingKeys = getMissingKeys(baseDocument, localeDocument);
      const baseKeys = flattenObject(baseDocument).length;

      if (missingKeys.length > 0 || localeDocument.meta?.translated === false) {
        sectionSummaries.push(
          `${relativeDir} (${missingKeys.length} missing, translated=${localeDocument.meta?.translated === true ? "true" : "false"}, ${baseKeys} baseline keys)`,
        );
      }
    }

    summaries.push({
      languageCode,
      sections: sectionSummaries,
    });
  }

  return summaries;
}

function getContentContractSummary() {
  return runNodeScript("scripts/check-content-contracts.mjs")
    .replace(/\s+/g, " ")
    .trim();
}

const [
  health,
  envSnapshot,
  languageSnapshot,
  placeholderSummary,
  resourceFreshnessSummary,
  translationSummary,
  contentContractSummary,
] = await Promise.all([
  fetchHealth({ baseUrl, fail }),
  getEnvSnapshot(),
  getLanguageSnapshot(),
  getPlaceholderSummary(),
  getResourceFreshnessSummary(),
  getTranslationSummary(),
  Promise.resolve(getContentContractSummary()),
]);

console.log("Access Tool ops status");
console.log("");
console.log(`Base URL: ${baseUrl}`);
console.log(`Health ok: ${summarizeBoolean(Boolean(health.ok))}`);
console.log(`Chat mode: ${health.chatMode}`);
console.log(`Deploy env: ${health.deployEnv}`);
console.log(`Commit SHA: ${health.commitSha ?? "local-dev"}`);
console.log(`Deploy config ok: ${summarizeBoolean(Boolean(health.deployConfigOk))}`);
console.log("");
console.log("Local env snapshot");
console.log(`- DEV_MOCK_CHAT: ${envSnapshot.devMockChat}`);
console.log(`- MAIN_MODEL: ${envSnapshot.mainModel}`);
console.log(`- CLASSIFIER_MODEL: ${envSnapshot.classifierModel}`);
console.log("");
console.log("Language snapshot");
console.log(`- /?lang=es html lang: ${languageSnapshot.homeLang}`);
console.log(`- language cookie: ${languageSnapshot.languageCookie}`);
console.log(`- /privacy with cookie html lang: ${languageSnapshot.privacyLang}`);
console.log("");
console.log("Resource freshness");

for (const summary of resourceFreshnessSummary) {
  console.log(
    `- ${summary.label}: ${summary.staleCount}/${summary.total} stale over ${staleAfterDays} days; oldest ${summary.oldestId} at ${summary.oldestAgeInDays} day(s)`,
  );
}

console.log("");
console.log(`Content contracts: ${contentContractSummary}`);
console.log("");
const incompleteTranslations = translationSummary.filter(
  (summary) => summary.sections.length > 0,
);

if (incompleteTranslations.length === 0) {
  console.log("Translation readiness: all supported language files complete");
} else {
  console.log(`Translation readiness: ${incompleteTranslations.length} language(s) still incomplete`);

  for (const summary of incompleteTranslations) {
    console.log(`- ${summary.languageCode}: ${summary.sections.join("; ")}`);
  }
}

console.log("");

if (placeholderSummary.length === 0) {
  console.log("Launch doc placeholders: none detected");
} else {
  const classifiedPlaceholderSummary = placeholderSummary.map((issue) => ({
    issue,
    scope: classifyLaunchDocIssue(issue),
  }));
  const externalCount = classifiedPlaceholderSummary.filter(
    (entry) => entry.scope === "external",
  ).length;
  const internalCount = classifiedPlaceholderSummary.length - externalCount;

  console.log(
    `Launch doc placeholders: ${classifiedPlaceholderSummary.length} file-level issue(s) (${internalCount} internal, ${externalCount} external)`,
  );

  for (const entry of classifiedPlaceholderSummary) {
    console.log(`- [${entry.scope}] ${entry.issue}`);
  }
}

console.log("");
const externalTranslationCount = incompleteTranslations.length;
const externalPlaceholderCount = placeholderSummary.length;
const externalLaunchBlockerCount = externalTranslationCount + externalPlaceholderCount;
console.log(
  `Known external launch blockers from repo checks: ${externalLaunchBlockerCount} (${externalTranslationCount} translation, ${externalPlaceholderCount} launch-doc placeholder)`,
);
