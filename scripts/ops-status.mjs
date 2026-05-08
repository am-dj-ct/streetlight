import { readFile } from "node:fs/promises";

const baseUrl = process.env.ACCESS_TOOL_BASE_URL ?? "http://localhost:3000";
const envLocalPath = new URL("../.env.local", import.meta.url);
const launchFiles = [
  "README.md",
  "OPERATIONAL_RUNBOOK.md",
  "docs/partners/launch-packet.md",
  "docs/partners/launch_checklist.md",
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

const [health, envSnapshot, placeholderSummary] = await Promise.all([
  getHealth(),
  getEnvSnapshot(),
  getPlaceholderSummary(),
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

if (placeholderSummary.length === 0) {
  console.log("Launch doc placeholders: none detected");
} else {
  console.log(`Launch doc placeholders: ${placeholderSummary.length} file-level issue(s)`);

  for (const issue of placeholderSummary) {
    console.log(`- ${issue}`);
  }
}
