import { access, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import {
  collectLaunchDocPlaceholderIssues,
  getResourceFreshness,
  getTranslationReadiness,
  staleAfterDays as staleResourceThresholdDays,
} from "./lib/repo-readiness.mjs";

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
  "docs/resource_maintenance.md",
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

async function fileExists(relativePath) {
  try {
    await access(path.join(cwd, relativePath));
    return true;
  } catch {
    return false;
  }
}

function addFailure(failures, message, scope = "internal") {
  failures.push({
    message,
    scope,
  });
}

function runNodeScript(scriptPath) {
  const result = spawnSync(process.execPath, [scriptPath], {
    cwd,
    encoding: "utf8",
  });

  if (result.error) {
    return `Failed to run ${scriptPath}: ${result.error.message}`;
  }

  if (result.status !== 0) {
    return `${scriptPath} exited ${result.status}.\n${result.stderr || result.stdout}`;
  }

  return null;
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
  const issues = await collectLaunchDocPlaceholderIssues(cwd);

  for (const issue of issues) {
    for (const match of issue.matches) {
      const reason =
        issue.reason === "runbook screenshots still missing"
          ? "Runbook screenshot still missing"
          : issue.reason === "live URL placeholder still present"
            ? "Live URL placeholder still present"
            : issue.reason === "launch contact placeholder still present"
              ? "Required launch detail placeholder still present"
              : "TBD marker still present";

      addFailure(failures, `${issue.relativePath}: ${reason} (${match})`, issue.scope);
    }
  }
}

async function checkTranslations(failures) {
  const translationReadiness = await getTranslationReadiness(cwd);

  for (const summary of translationReadiness) {
    const incompleteSections = [];

    for (const section of summary.sections) {
      const sectionIssues = [];

      if (section.missingKeys.length > 0) {
        sectionIssues.push(`${section.missingKeys.length} missing key(s)`);
      }

      if (!section.translated) {
        sectionIssues.push("translated=false");
      }

      if (sectionIssues.length > 0) {
        incompleteSections.push(
          `${section.relativeDir} (${sectionIssues.join(", ")}, ${section.baseKeys} baseline keys)`,
        );
      }
    }

    if (incompleteSections.length > 0) {
      addFailure(
        failures,
        `${summary.languageCode}: ${incompleteSections.join("; ")}`,
        "external",
      );
    }
  }
}

async function checkResourceFreshness(failures) {
  const resourceFreshness = await getResourceFreshness(cwd);

  for (const summary of resourceFreshness) {
    if (summary.error) {
      addFailure(failures, summary.error);
      continue;
    }

    if (summary.invalidDateCount > 0) {
      addFailure(
        failures,
        `${summary.path} contains ${summary.invalidDateCount} invalid lastVerified value(s).`,
      );
    }

    if (
      summary.oldestAgeInDays !== null &&
      summary.oldestAgeInDays > staleResourceThresholdDays
    ) {
      addFailure(
        failures,
        `${summary.path} → ${summary.oldestId}: lastVerified is ${summary.oldestAgeInDays} days old (limit ${staleResourceThresholdDays}).`,
      );
    }
  }
}

function checkSafetyGuardrails(failures) {
  const scripts = [
    "scripts/check-env-shape.mjs",
    "scripts/check-forbidden-integrations.mjs",
    "scripts/check-no-tracked-secrets.mjs",
  ];

  for (const scriptPath of scripts) {
    const error = runNodeScript(scriptPath);

    if (error) {
      addFailure(failures, `${scriptPath}: ${error}`);
    }
  }
}

const failures = [];

await checkRequiredFiles(failures);
await checkEnvExample(failures);
await checkPlaceholders(failures);
await checkTranslations(failures);
await checkResourceFreshness(failures);
checkSafetyGuardrails(failures);

console.log("Launch readiness check");
console.log("");

if (failures.length === 0) {
  console.log("PASS: no blocking launch-readiness gaps found by this static check.");
} else {
  const internalFailures = failures.filter((failure) => failure.scope === "internal");
  const externalFailures = failures.filter((failure) => failure.scope === "external");

  console.log(
    `FAIL: ${failures.length} blocking issue(s) found (${internalFailures.length} internal, ${externalFailures.length} external).`,
  );
  console.log("");

  for (const failure of failures) {
    console.log(`- [${failure.scope}] ${failure.message}`);
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
