import { readFile } from "node:fs/promises";

const baseUrl = process.env.ACCESS_TOOL_BASE_URL ?? "http://localhost:3000";
const envLocalPath = new URL("../.env.local", import.meta.url);
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

async function getHealth() {
  const response = await fetch(new URL("/healthz", baseUrl), {
    cache: "no-store",
  });

  if (!response.ok) {
    fail(`HTTP ${response.status} from /healthz.`);
  }

  const payload = await response.json();

  if (!payload?.ok || payload.service !== "access-tool") {
    fail("Unexpected /healthz response body.");
  }

  return payload;
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

const [health, envSnapshot, placeholderSummary, resourceFreshnessSummary] = await Promise.all([
  getHealth(),
  getEnvSnapshot(),
  getPlaceholderSummary(),
  getResourceFreshnessSummary(),
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
console.log("Resource freshness");

for (const summary of resourceFreshnessSummary) {
  console.log(
    `- ${summary.label}: ${summary.staleCount}/${summary.total} stale over ${staleAfterDays} days; oldest ${summary.oldestId} at ${summary.oldestAgeInDays} day(s)`,
  );
}

console.log("");

if (placeholderSummary.length === 0) {
  console.log("Launch doc placeholders: none detected");
} else {
  console.log(`Launch doc placeholders: ${placeholderSummary.length} file-level issue(s)`);

  for (const issue of placeholderSummary) {
    console.log(`- ${issue}`);
  }
}
