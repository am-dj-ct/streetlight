import { access, readFile } from "node:fs/promises";
import path from "node:path";

const cwd = process.cwd();

const requiredFiles = [
  "README.md",
  "OPERATIONAL_RUNBOOK.md",
  "docs/partners/README.md",
  "docs/partners/bug-report.md",
  "docs/partners/current-limits.md",
  "docs/partners/launch-packet.md",
  "docs/partners/launch_checklist.md",
  "docs/partners/one-sentence-framing.md",
  "docs/translation_handoff.md",
  "docs/translation_worklist.md",
  "incidents/log.md",
];

const requiredEnvVars = [
  "ANTHROPIC_API_KEY",
  "MAIN_MODEL",
  "CLASSIFIER_MODEL",
  "NEXT_PUBLIC_TURNSTILE_SITE_KEY",
  "TURNSTILE_SECRET_KEY",
  "HASHED_IP_SALT",
  "KV_REST_API_URL",
  "KV_REST_API_TOKEN",
  "SOFT_PAUSE_ENABLED",
  "HARD_PAUSE_ENABLED",
  "DAILY_SPEND_LIMIT_USD",
  "MAIN_MODEL_INPUT_COST_PER_MILLION_USD",
  "MAIN_MODEL_OUTPUT_COST_PER_MILLION_USD",
  "CLASSIFIER_MODEL_INPUT_COST_PER_MILLION_USD",
  "CLASSIFIER_MODEL_OUTPUT_COST_PER_MILLION_USD",
];

const placeholderChecks = [
  {
    pattern: /\[Screenshot:[^\]]+\]/g,
    reason: "Runbook screenshot still missing",
  },
  {
    pattern: /\bADD-LIVE-URL-HERE\b/g,
    reason: "Live URL placeholder still present",
  },
  {
    pattern: /\[ADD-[A-Z0-9-]+\]/g,
    reason: "Required launch detail placeholder still present",
  },
  {
    pattern: /\bTBD\b/g,
    reason: "TBD marker still present",
  },
];

const localeDirectories = [
  "src/data/ui-copy",
  "src/data/conversation-content",
  "src/data/static-pages",
];
const resourceFiles = [
  "src/data/referrals.json",
  "src/data/crisis-resources.json",
];
const staleResourceThresholdDays = 180;

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

async function readJson(relativePath) {
  const filePath = path.join(cwd, relativePath);
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function fileExists(relativePath) {
  try {
    await access(path.join(cwd, relativePath));
    return true;
  } catch {
    return false;
  }
}

function addFailure(failures, message) {
  failures.push(message);
}

function parseIsoDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const parsed = Date.parse(`${value}T00:00:00Z`);
  return Number.isNaN(parsed) ? null : parsed;
}

async function checkRequiredFiles(failures) {
  for (const relativePath of requiredFiles) {
    if (!(await fileExists(relativePath))) {
      addFailure(failures, `Missing required file: ${relativePath}`);
    }
  }
}

async function checkEnvExample(failures) {
  const envExamplePath = path.join(cwd, ".env.example");
  const contents = await readFile(envExamplePath, "utf8");

  for (const variable of requiredEnvVars) {
    const pattern = new RegExp(`^${variable}=`, "m");

    if (!pattern.test(contents)) {
      addFailure(failures, `.env.example is missing ${variable}`);
    }
  }
}

async function checkPlaceholders(failures) {
  const filesToScan = [
    "README.md",
    "OPERATIONAL_RUNBOOK.md",
    "docs/partners/launch-packet.md",
    "docs/partners/launch_checklist.md",
  ];

  for (const relativePath of filesToScan) {
    const contents = await readFile(path.join(cwd, relativePath), "utf8");

    for (const check of placeholderChecks) {
      const matches = contents.match(check.pattern) ?? [];

      for (const match of matches) {
        addFailure(failures, `${relativePath}: ${check.reason} (${match})`);
      }
    }
  }
}

async function checkTranslations(failures) {
  const localeFiles = ["es", "vi", "so", "ru", "am", "zh"];

  for (const languageCode of localeFiles) {
    const incompleteSections = [];

    for (const relativeDir of localeDirectories) {
      const baseDocument = await readJson(`${relativeDir}/en.json`);
      const baseKeys = flattenObject(baseDocument).length;
      const relativePath = `${relativeDir}/${languageCode}.json`;
      const localeDocument = await readJson(relativePath);
      const missingKeys = getMissingKeys(baseDocument, localeDocument);
      const translatedFlag = localeDocument.meta?.translated;
      const sectionIssues = [];

      if (missingKeys.length > 0) {
        sectionIssues.push(`${missingKeys.length} missing key(s)`);
      }

      if (translatedFlag === false) {
        sectionIssues.push("translated=false");
      }

      if (sectionIssues.length > 0) {
        incompleteSections.push(
          `${relativeDir} (${sectionIssues.join(", ")}, ${baseKeys} baseline keys)`,
        );
      }
    }

    if (incompleteSections.length > 0) {
      addFailure(
        failures,
        `${languageCode}: ${incompleteSections.join("; ")}`,
      );
    }
  }
}

async function checkResourceFreshness(failures) {
  for (const relativePath of resourceFiles) {
    const resources = await readJson(relativePath);

    if (!Array.isArray(resources)) {
      addFailure(failures, `${relativePath} must contain an array.`);
      continue;
    }

    for (const resource of resources) {
      const label = `${relativePath} → ${resource.id ?? "unknown-id"}`;
      const parsed = parseIsoDate(resource.lastVerified);

      if (parsed === null) {
        addFailure(failures, `${label}: lastVerified must use YYYY-MM-DD.`);
        continue;
      }

      const ageInDays = Math.floor(
        (Date.now() - parsed) / (1000 * 60 * 60 * 24),
      );

      if (ageInDays > staleResourceThresholdDays) {
        addFailure(
          failures,
          `${label}: lastVerified is ${ageInDays} days old (limit ${staleResourceThresholdDays}).`,
        );
      }
    }
  }
}

const failures = [];

await checkRequiredFiles(failures);
await checkEnvExample(failures);
await checkPlaceholders(failures);
await checkTranslations(failures);
await checkResourceFreshness(failures);

console.log("Launch readiness check");
console.log("");

if (failures.length === 0) {
  console.log("PASS: no blocking launch-readiness gaps found by this static check.");
} else {
  console.log(`FAIL: ${failures.length} blocking issue(s) found.`);
  console.log("");

  for (const failure of failures) {
    console.log(`- ${failure}`);
  }
}

if (failures.length === 0) {
  console.log("");
  console.log("Still do the manual launch checks:");
  console.log("- npm run verify");
  console.log("- soft-pause drill");
  console.log("- hard-pause drill");
  console.log("- live dashboard screenshot pass");
}

process.exitCode = failures.length === 0 ? 0 : 1;
