import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { defaultBaseUrl, getHealth as fetchHealth } from "./lib/access-tool-http.mjs";
import { getLanguageRoutingSnapshot } from "./lib/language-persistence.mjs";
import {
  collectLaunchDocPlaceholderIssues,
  getResourceFreshness,
  getTranslationReadiness,
  staleAfterDays,
} from "./lib/repo-readiness.mjs";

const baseUrl = defaultBaseUrl;
const envLocalPath = new URL("../.env.local", import.meta.url);

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

async function getEnvSnapshot() {
  try {
    const contents = await readFile(envLocalPath, "utf8");

    return {
      devMockChat: readEnvValue(contents, "DEV_MOCK_CHAT") ?? "unset",
      mainModel: readEnvValue(contents, "MAIN_MODEL") ?? "unset",
      fallbackMainModel: readEnvValue(contents, "FALLBACK_MAIN_MODEL") ?? "default: classifier model",
      cheapestMainModel: readEnvValue(contents, "CHEAPEST_MAIN_MODEL") ?? "unset",
      classifierModel: readEnvValue(contents, "CLASSIFIER_MODEL") ?? "unset",
      openAiFallbackModel: readEnvValue(contents, "OPENAI_FALLBACK_MODEL") ?? "default: gpt-5.5",
      openAiFallbackConfigured:
        readEnvValue(contents, "OPENAI_API_KEY") &&
        readEnvValue(contents, "OPENAI_FALLBACK_INPUT_COST_PER_MILLION_USD") &&
        readEnvValue(contents, "OPENAI_FALLBACK_OUTPUT_COST_PER_MILLION_USD")
          ? "yes"
          : "no",
    };
  } catch {
    return {
      devMockChat: "missing .env.local",
      mainModel: "missing .env.local",
      fallbackMainModel: "missing .env.local",
      cheapestMainModel: "missing .env.local",
      classifierModel: "missing .env.local",
      openAiFallbackConfigured: "missing .env.local",
      openAiFallbackModel: "missing .env.local",
    };
  }
}

async function getLanguageSnapshot() {
  const snapshot = await getLanguageRoutingSnapshot({ baseUrl, fail });

  return {
    acceptLanguagePrivacyLang: snapshot.acceptLanguageLang ?? "(missing)",
    homeLang: snapshot.homeLang ?? "(missing)",
    languageCookie: snapshot.languageCookie ? "unexpected" : "none",
    privacyLang: snapshot.privacyLang ?? "(missing)",
  };
}

async function getPlaceholderSummary() {
  const issues = await collectLaunchDocPlaceholderIssues(process.cwd());

  return issues.map(
    (issue) => `${issue.relativePath}: ${issue.reason} (${issue.matches.length})`,
  );
}

async function getResourceFreshnessSummary() {
  const summaries = await getResourceFreshness(process.cwd());

  for (const summary of summaries) {
    if (summary.error) {
      fail(summary.error);
    }

    if (summary.invalidDateCount > 0) {
      fail(`${summary.path} contains ${summary.invalidDateCount} invalid lastVerified value(s).`);
    }
  }

  return summaries;
}

async function getTranslationSummary() {
  const translationReadiness = await getTranslationReadiness(process.cwd());

  return translationReadiness.map((summary) => ({
    languageCode: summary.languageCode,
    sections: summary.sections
      .filter((section) => section.missingKeys.length > 0 || !section.translated)
      .map(
        (section) =>
          `${section.relativeDir} (${section.missingKeys.length} missing, translated=${section.translated ? "true" : "false"}, ${section.baseKeys} baseline keys)`,
      ),
  }));
}

function getContentContractSummary() {
  return runNodeScript("scripts/check-content-contracts.mjs")
    .replace(/\s+/g, " ")
    .trim();
}

function getSafetyCheckSummary() {
  runNodeScript("scripts/check-env-shape.mjs");
  runNodeScript("scripts/check-forbidden-integrations.mjs");
  runNodeScript("scripts/check-no-tracked-secrets.mjs");

  return "env shapes, forbidden integrations, and tracked secrets ok";
}

const [
  health,
  envSnapshot,
  languageSnapshot,
  placeholderSummary,
  resourceFreshnessSummary,
  translationSummary,
  contentContractSummary,
  safetyCheckSummary,
] = await Promise.all([
  fetchHealth({ baseUrl, fail }),
  getEnvSnapshot(),
  getLanguageSnapshot(),
  getPlaceholderSummary(),
  getResourceFreshnessSummary(),
  getTranslationSummary(),
  Promise.resolve(getContentContractSummary()),
  Promise.resolve(getSafetyCheckSummary()),
]);

console.log("Streetlight ops status");
console.log("");
console.log(`Base URL: ${baseUrl}`);
console.log(`Health ok: ${summarizeBoolean(Boolean(health.ok))}`);
console.log(`Chat mode: ${health.chatMode}`);
console.log(`Deploy env: ${health.deployEnv}`);
console.log(`Commit SHA: ${health.commitSha ?? "local-dev"}`);
console.log(`Deploy config ok: ${summarizeBoolean(Boolean(health.deployConfigOk))}`);
if (health.abuseControls) {
  console.log("Abuse controls");
  console.log(`- turnstile secret: ${summarizeBoolean(Boolean(health.abuseControls.turnstileSecretConfigured))}`);
  console.log(`- turnstile site key: ${summarizeBoolean(Boolean(health.abuseControls.turnstileSiteKeyConfigured))}`);
  console.log(`- kv configured: ${summarizeBoolean(Boolean(health.abuseControls.kvConfigured))}`);
  console.log(`- hashed ip salt: ${summarizeBoolean(Boolean(health.abuseControls.hashedIpSaltConfigured))}`);
}
console.log("");
console.log("Local env snapshot");
console.log(`- DEV_MOCK_CHAT: ${envSnapshot.devMockChat}`);
console.log(`- MAIN_MODEL: ${envSnapshot.mainModel}`);
console.log(`- FALLBACK_MAIN_MODEL: ${envSnapshot.fallbackMainModel}`);
console.log(`- CHEAPEST_MAIN_MODEL: ${envSnapshot.cheapestMainModel}`);
console.log(`- CLASSIFIER_MODEL: ${envSnapshot.classifierModel}`);
console.log(`- OPENAI_FALLBACK_MODEL: ${envSnapshot.openAiFallbackModel}`);
console.log(`- OpenAI fallback configured: ${envSnapshot.openAiFallbackConfigured}`);
console.log("");
console.log("Language snapshot");
console.log(`- /?lang=es html lang: ${languageSnapshot.homeLang}`);
console.log(`- language cookie: ${languageSnapshot.languageCookie}`);
console.log(`- /privacy?lang=es html lang: ${languageSnapshot.privacyLang}`);
console.log(`- /privacy with Accept-Language es html lang: ${languageSnapshot.acceptLanguagePrivacyLang}`);
console.log("");
console.log("Resource freshness");

for (const summary of resourceFreshnessSummary) {
  console.log(
    `- ${summary.label}: ${summary.staleCount}/${summary.total} stale over ${staleAfterDays} days; oldest ${summary.oldestId} at ${summary.oldestAgeInDays} day(s)`,
  );
}

console.log("");
console.log(`Content contracts: ${contentContractSummary}`);
console.log(`Safety checks: ${safetyCheckSummary}`);
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
