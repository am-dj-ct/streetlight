// Execute a category-aware verification plan, and always report the result.
//
// The old workflow's shape was: run everything, build, start `next dev`,
// smoke it. Two things change here.
//
// First, the plan decides what runs, so a docs change does not build and a
// resource-data change does not lint TypeScript it never touched.
//
// Second, when a change does need the rendered app, this runs it against the
// PRODUCTION build (`next build` + `next start`) rather than the development
// server -- but only after scripts/check-build-runtime-parity.mjs has proved
// that the mock build and the real runtime actually agree. Next inlines
// NEXT_PUBLIC_* values into the client bundle at build time and reads
// everything else per request, so a production build verified under a
// different environment than it was built in is a test of nothing. The parity
// step is what earns the right to test the production build; it is not
// optional decoration, and the plan cannot select a runtime check without it.
//
// Reporting is unconditional. Every run ends with a per-check table and a
// verdict line, pass or fail, so a run that selected nothing is visibly
// "selected nothing" rather than an absent or skipped check.

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const options = { manifest: null, port: 3000, receiptDir: "verify-artifacts" };

for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  const value = args[index + 1];

  if (arg === "--manifest") {
    options.manifest = value;
    index += 1;
  } else if (arg === "--port") {
    options.port = Number(value);
    index += 1;
  } else if (arg === "--receipt-dir") {
    options.receiptDir = value;
    index += 1;
  } else {
    console.error(`Unsupported argument: ${arg}`);
    process.exit(2);
  }
}

if (!options.manifest) {
  console.error("Pass --manifest <path> (produced by scripts/plan-verify.mjs).");
  process.exit(2);
}

const manifest = JSON.parse(readFileSync(options.manifest, "utf8"));

if (manifest.status === "blocked") {
  console.error("Plan is blocked: unmapped changed paths.");

  for (const entry of manifest.unmapped) {
    console.error(`  ${entry}`);
  }

  process.exit(2);
}

mkdirSync(options.receiptDir, { recursive: true });

const baseUrl = `http://127.0.0.1:${options.port}`;
const mockEnv = {
  ...process.env,
  ACCESS_TOOL_BASE_URL: baseUrl,
  DEV_MOCK_CHAT: "true",
  NEXT_TELEMETRY_DISABLED: "1",
};

const buildEnvPath = path.join(options.receiptDir, "build-env.json");

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) {
    return {};
  }

  const parsed = {};

  for (const line of readFileSync(filePath, "utf8").split("\n")) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);

    if (!match) {
      continue;
    }

    parsed[match[1]] = match[2]
      .trim()
      .replace(/^["'](.*)["']$/s, "$1");
  }

  return parsed;
}

function collectBuildConfiguration(env) {
  // Next's precedence for a production start, lowest first.
  const fromFiles = {
    ...parseEnvFile(".env"),
    ...parseEnvFile(".env.production"),
    ...parseEnvFile(".env.local"),
  };
  const merged = { ...fromFiles, ...env };
  const keys = Object.keys(merged)
    .filter((key) => key.startsWith("NEXT_PUBLIC_") || key === "DEV_MOCK_CHAT" || key === "VERCEL_ENV")
    .sort();

  return Object.fromEntries(keys.map((key) => [key, merged[key] ?? null]));
}
const results = [];
let appProcess = null;

function record(id, label, phase, status, seconds, detail = "") {
  results.push({ detail, durationSeconds: seconds, id, label, phase, status });
  const marker = status === "passed" ? "PASS" : status === "skipped" ? "SKIP" : "FAIL";
  console.log(`\n==> ${marker}  ${id} (${seconds}s)  ${label}`);
}

function substituteBase(check) {
  if (!check.command.some((part) => part.includes("{{base}}"))) {
    return { command: check.command, skipReason: null };
  }

  if (!manifest.diffBase) {
    return { command: null, skipReason: "no comparison base in the plan" };
  }

  return {
    command: check.command.map((part) => part.replace("{{base}}", manifest.diffBase)),
    skipReason: null,
  };
}

function runCheck(rawCheck, extraEnv = {}) {
  const { command: resolvedCommand, skipReason } = substituteBase(rawCheck);

  if (skipReason) {
    // Skipped, said out loud, with a reason. Never silently green.
    record(rawCheck.id, rawCheck.label, rawCheck.phase, "skipped", 0, skipReason);
    return true;
  }

  const check = { ...rawCheck, command: resolvedCommand };
  const [command, ...commandArgs] = check.command;
  console.log(`\n--- ${check.id}: ${check.command.join(" ")}`);
  const started = Date.now();
  const result = spawnSync(command, commandArgs, {
    env: { ...mockEnv, ...extraEnv },
    stdio: "inherit",
  });
  const seconds = Number(((Date.now() - started) / 1000).toFixed(1));
  const ok = result.status === 0;
  record(check.id, check.label, check.phase, ok ? "passed" : "failed", seconds, ok ? "" : `exit ${result.status}`);
  return ok;
}

async function waitForHealth(timeoutMs) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/healthz`, { headers: { Accept: "application/json" } });

      if (response.ok) {
        return await response.json();
      }
    } catch {
      // Not listening yet.
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  return null;
}

function stopApp() {
  if (appProcess && appProcess.exitCode === null) {
    appProcess.kill("SIGTERM");
  }
}

process.on("exit", stopApp);

let failed = false;
const byPhase = (phase) => manifest.checks.filter((check) => check.phase === phase);

for (const check of byPhase("static")) {
  if (!runCheck(check)) {
    failed = true;
  }
}

if (!failed) {
  for (const check of byPhase("build")) {
    // Record the exact environment the build baked in. The parity proof
    // compares this against the environment the server later runs under;
    // without it "we tested the production build" is an unbacked claim.
    // Next loads .env, .env.production and .env.local itself; those values
    // never appear in this process's environment, so a snapshot built only
    // from process.env could not see the values Next actually inlines. Read
    // the same files Next would, then let the real environment win, which is
    // Next's own precedence.
    const snapshot = collectBuildConfiguration(mockEnv);

    if (!runCheck(check)) {
      failed = true;
    }

    // Written after the build, not before: `next build` clears .next/, so a
    // snapshot placed there first is gone by the time parity reads it. The
    // values are captured from the environment this process handed the build.
    writeFileSync(buildEnvPath, `${JSON.stringify(snapshot, null, 2)}\n`);
  }
}

if (!failed) {
  const parityChecks = manifest.checks.filter((check) => check.phase === "parity");

  for (const check of parityChecks) {
    const receipt = path.join(options.receiptDir, "build-runtime-parity.json");

    if (!runCheck({ ...check, command: [...check.command, "--receipt", receipt, "--build-env", buildEnvPath] })) {
      failed = true;
    }
  }
}

const runtimeChecks = byPhase("runtime");

if (!failed && runtimeChecks.length > 0) {
  const parityProved = manifest.checks.some((check) => check.phase === "parity");

  if (!parityProved) {
    console.error(
      "\nRefusing to run rendered checks against the production build without a parity proof in the plan.",
    );
    record("parity", "mock build / runtime parity proof", "parity", "failed", 0, "missing from plan");
    failed = true;
  } else {
    console.log(`\n--- starting production server: next start -p ${options.port}`);
    const started = Date.now();
    appProcess = spawn("npx", ["next", "start", "-p", String(options.port), "-H", "127.0.0.1"], {
      env: mockEnv,
      stdio: "inherit",
    });

    const health = await waitForHealth(120_000);
    const bootSeconds = Number(((Date.now() - started) / 1000).toFixed(1));

    if (!health) {
      record("app:start", "production server boot", "runtime", "failed", bootSeconds, "no /healthz");
      failed = true;
    } else {
      record("app:start", "production server boot", "runtime", "passed", bootSeconds, JSON.stringify(health));
      writeFileSync(
        path.join(options.receiptDir, "runtime-health.json"),
        `${JSON.stringify(health, null, 2)}\n`,
      );

      for (const check of runtimeChecks) {
        if (!runCheck(check)) {
          failed = true;
        }
      }
    }

    stopApp();
  }
}

// Every planned check that never ran gets a row saying so. A report that
// silently omits them under-states what was not verified.
for (const check of manifest.checks) {
  if (!results.some((entry) => entry.id === check.id)) {
    record(check.id, check.label, check.phase, "skipped", 0, "not reached: an earlier check failed");
  }
}

// Always report, whatever happened above.
const report = {
  base: manifest.base,
  categories: manifest.categories,
  changedPathCount: manifest.changedPathCount,
  checks: results,
  finishedAt: new Date().toISOString(),
  status: failed ? "FAIL" : "PASS",
  totalSeconds: Number(results.reduce((sum, entry) => sum + entry.durationSeconds, 0).toFixed(1)),
};

writeFileSync(path.join(options.receiptDir, "verify-report.json"), `${JSON.stringify(report, null, 2)}\n`);

console.log("");
console.log("================ verify report ================");
console.log(`categories: ${report.categories.length > 0 ? report.categories.join(", ") : "(none)"}`);
console.log(`changed paths: ${report.changedPathCount}`);
console.log("");

for (const entry of results) {
  console.log(
    `  ${entry.status.toUpperCase().padEnd(7)} ${entry.id.padEnd(28)} ${String(entry.durationSeconds).padStart(7)}s  ${entry.detail}`,
  );
}

if (results.length === 0) {
  console.log("  (plan selected no checks)");
}

console.log("");
console.log(`total check time: ${report.totalSeconds}s`);
console.log(`VERIFY ${report.status}`);
console.log("==============================================");

process.exitCode = failed ? 1 : 0;
