import { spawnSync } from "node:child_process";

function fail(message) {
  console.error(message);
  process.exit(1);
}

function runNodeScript(scriptPath, args) {
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

  return result.stdout;
}

function runNodeScriptExpectingFailure(scriptPath, args) {
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
  });

  if (result.error) {
    fail(`Failed to run ${scriptPath}: ${result.error.message}`);
  }

  if (result.status === 0) {
    fail(`${scriptPath} unexpectedly passed.`);
  }

  return `${result.stderr}${result.stdout}`;
}

const newIncidentOutput = runNodeScript("scripts/new-incident.mjs", [
  "--slug",
  "ops-script-check",
  "--severity",
  "Sev-1",
  "--dry-run",
  "true",
]);

const forbiddenIntegrationsOutput = runNodeScript(
  "scripts/check-forbidden-integrations.mjs",
  [],
);

if (!forbiddenIntegrationsOutput.includes("Forbidden integration check passed.")) {
  fail("forbidden integration check did not include the expected pass output.");
}

const noTrackedSecretsOutput = runNodeScript(
  "scripts/check-no-tracked-secrets.mjs",
  [],
);

if (!noTrackedSecretsOutput.includes("Tracked secret check passed.")) {
  fail("tracked secret check did not include the expected pass output.");
}

const envShapeOutput = runNodeScript("scripts/check-env-shape.mjs", []);

if (!envShapeOutput.includes("Env shape check passed.")) {
  fail("env shape check did not include the expected pass output.");
}

if (
  !newIncidentOutput.includes("Would create incidents/") ||
  !newIncidentOutput.includes("Severity: Sev-1")
) {
  fail("new-incident dry run did not include the expected scaffold output.");
}

const sev3Output = runNodeScript("scripts/append-sev3-note.mjs", [
  "--what",
  "Synthetic ops script check",
  "--action",
  "Ran the dry-run validator",
  "--outcome",
  "Script output looked correct",
  "--follow-up",
  "None",
  "--dry-run",
  "true",
]);

if (
  !sev3Output.includes("Would update incidents/log.md") ||
  !sev3Output.includes("Synthetic ops script check")
) {
  fail("append-sev3-note dry run did not include the expected log preview.");
}

const invalidIncidentDateOutput = runNodeScriptExpectingFailure(
  "scripts/new-incident.mjs",
  [
    "--slug",
    "invalid-date-check",
    "--opened",
    "2026-02-31",
    "--dry-run",
    "true",
  ],
);

if (!invalidIncidentDateOutput.includes("Opened date must use YYYY-MM-DD.")) {
  fail("new-incident invalid date check did not fail as expected.");
}

const invalidIncidentRangeOutput = runNodeScriptExpectingFailure(
  "scripts/new-incident.mjs",
  [
    "--slug",
    "invalid-date-range-check",
    "--opened",
    "2026-03-02",
    "--resolved",
    "2026-03-01",
    "--dry-run",
    "true",
  ],
);

if (
  !invalidIncidentRangeOutput.includes(
    "Resolved date cannot be earlier than opened date.",
  )
) {
  fail("new-incident invalid date range check did not fail as expected.");
}

const invalidSev3DateOutput = runNodeScriptExpectingFailure(
  "scripts/append-sev3-note.mjs",
  [
    "--date",
    "2026-02-31",
    "--what",
    "Synthetic invalid date check",
    "--action",
    "Ran the dry-run validator",
    "--outcome",
    "Should fail",
    "--dry-run",
    "true",
  ],
);

if (!invalidSev3DateOutput.includes("valid YYYY-MM-DD calendar date")) {
  fail("append-sev3-note invalid date check did not fail as expected.");
}

const resourceStatusOutput = runNodeScript("scripts/print-resource-status.mjs", []);

if (
  !resourceStatusOutput.includes("Access Tool resource status") ||
  !resourceStatusOutput.includes("Referral resources") ||
  !resourceStatusOutput.includes("Crisis resources")
) {
  fail("print-resource-status output did not include the expected sections.");
}

const diagnosticsOutput = runNodeScript("scripts/print-local-diagnostics.mjs", []);

if (
  !diagnosticsOutput.includes("Access Tool local diagnostics") ||
  !diagnosticsOutput.includes("Report page snapshot") ||
  !diagnosticsOutput.includes("Referrals page snapshot")
) {
  fail("print-local-diagnostics output did not include the expected sections.");
}

const opsStatusOutput = runNodeScript("scripts/ops-status.mjs", []);

if (
  !opsStatusOutput.includes("Access Tool ops status") ||
  !opsStatusOutput.includes("Content contracts: Content contracts ok") ||
  !opsStatusOutput.includes("Safety checks: env shapes, forbidden integrations, and tracked secrets ok")
) {
  fail("ops-status output did not include the expected status summaries.");
}

console.log("Ops helper checks passed.");
