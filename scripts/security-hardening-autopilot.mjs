import { spawnSync } from "node:child_process";
import { defaultBaseUrl, getHealth } from "./lib/access-tool-http.mjs";

function runCommand(command, args = [], { env = process.env } = {}) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    env,
  });

  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    throw new Error(`${command} ${args.join(" ")} failed.\n${output}`);
  }

  return result.stdout.trim();
}

function summarizeAbuseControls(health) {
  const controls = health.abuseControls ?? null;

  if (!controls) {
    return "not exposed by /healthz";
  }

  return [
    `turnstileSecret=${controls.turnstileSecretConfigured ? "yes" : "no"}`,
    `turnstileSiteKey=${controls.turnstileSiteKeyConfigured ? "yes" : "no"}`,
    `kv=${controls.kvConfigured ? "yes" : "no"}`,
    `hashedIpSalt=${controls.hashedIpSaltConfigured ? "yes" : "no"}`,
  ].join(", ");
}

async function main() {
  const mode = (process.argv[2] ?? "quick").trim().toLowerCase();
  const allowModes = new Set(["quick", "full"]);

  if (!allowModes.has(mode)) {
    throw new Error(`Unknown mode "${mode}". Use quick or full.`);
  }

  const baseUrl = process.env.ACCESS_TOOL_BASE_URL ?? defaultBaseUrl;
  const isLocal = /localhost|127\.0\.0\.1/.test(baseUrl);
  const smokeArgsEnv = isLocal
    ? process.env
    : { ...process.env, ACCESS_TOOL_BASE_URL: baseUrl };
  const health = await getHealth({
    baseUrl,
    fail(message) {
      throw new Error(message);
    },
  });
  const regressionEnv =
    health.chatMode === "mock-local"
      ? { ...smokeArgsEnv, ALLOW_MOCK_REGRESSION: "true" }
      : smokeArgsEnv;

  console.log(`Security hardening autopilot (${mode})`);
  console.log(`Base URL: ${baseUrl}`);
  console.log(`Chat mode: ${health.chatMode}`);
  console.log("");

  console.log("1) Static and build checks");
  runCommand("npm", ["run", "lint"]);
  runCommand("npm", ["run", "build"]);
  runCommand("npm", ["run", "check:content"]);
  runCommand("npm", ["run", "validate:data"]);
  console.log("   ok");
  console.log("");

  console.log("2) Runtime smoke checks");
  if (mode === "quick") {
    runCommand("npm", ["run", "smoke:quick"], { env: smokeArgsEnv });
  } else {
    runCommand("npm", ["run", "smoke"], { env: smokeArgsEnv });
  }
  console.log("   ok");
  console.log("");

  console.log("3) Regression checks");
  if (health.chatMode === "mock-local") {
    console.log("   note: running in mock-local mode (plumbing-only regression checks)");
  }
  runCommand("npm", ["run", "regression:stable-core"], { env: regressionEnv });
  runCommand("npm", ["run", "regression:watchlist"], { env: regressionEnv });
  console.log("   ok");
  console.log("");

  console.log("4) Health and abuse-controls snapshot");
  console.log(`   deployEnv=${health.deployEnv}`);
  console.log(`   chatMode=${health.chatMode}`);
  console.log(`   deployConfigOk=${health.deployConfigOk ? "yes" : "no"}`);
  console.log(`   abuseControls=${summarizeAbuseControls(health)}`);
  console.log(`   commitSha=${health.commitSha ?? "local-dev"}`);
  console.log("");

  if (health.deployEnv === "production" && health.deployConfigOk !== true) {
    throw new Error(
      "Production deployConfigOk is false. Block release until abuse controls and required runtime config are fixed.",
    );
  }

  console.log("Autopilot complete.");
}

main().catch((error) => {
  console.error(`Autopilot failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
