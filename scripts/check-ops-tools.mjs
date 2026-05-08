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

const newIncidentOutput = runNodeScript("scripts/new-incident.mjs", [
  "--slug",
  "ops-script-check",
  "--severity",
  "Sev-1",
  "--dry-run",
  "true",
]);

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

const resourceStatusOutput = runNodeScript("scripts/print-resource-status.mjs", []);

if (
  !resourceStatusOutput.includes("Access Tool resource status") ||
  !resourceStatusOutput.includes("Referral resources") ||
  !resourceStatusOutput.includes("Crisis resources")
) {
  fail("print-resource-status output did not include the expected sections.");
}

console.log("Ops helper checks passed.");
