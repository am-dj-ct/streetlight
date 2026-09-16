// Prove that the mock build and the real runtime agree, before anything
// claims a result from testing the production build.
//
// Why this exists. Verification used to run against `next dev`. Testing the
// production build instead is better -- it is what Vercel serves -- but only
// if the production build and the development path actually behave the same
// under the mock configuration. Next does not make that free:
//
//   * NEXT_PUBLIC_* values are inlined into the client bundle at `next build`
//     time. `next dev` reads them per compile. A build produced under one
//     environment and served under another is a test of the wrong artifact,
//     and nothing in the output says so.
//   * Everything else (DEV_MOCK_CHAT, VERCEL_ENV, provider keys) is read per
//     request by src/lib/env.ts, so those can drift the other way.
//
// So this does two separate things and records both:
//
//   1. Build-time vs runtime configuration. The build-env snapshot is written
//      by scripts/run-verify-plan.mjs from the environment it handed to
//      `next build` (after the build, because `next build` clears .next/).
//      Any baked key whose value differs from the environment this runs under
//      is a hard failure naming the key.
//   2. Observed behaviour. It starts the production server and a development
//      server side by side on scratch ports under one identical environment,
//      and compares what they actually serve: the /healthz configuration
//      surface, the rendered text of real pages, and the mock chat stream's
//      event shape.
//
// The receipt it writes is the proof a later production-build test leans on.
// No receipt, no production-build claim.

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const options = {
  buildEnv: "verify-artifacts/build-env.json",
  devPort: 3311,
  prodPort: 3310,
  receipt: "verify-artifacts/build-runtime-parity.json",
};

for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  const value = args[index + 1];

  if (arg === "--build-env") {
    options.buildEnv = value;
    index += 1;
  } else if (arg === "--receipt") {
    options.receipt = value;
    index += 1;
  } else if (arg === "--dev-port") {
    options.devPort = Number(value);
    index += 1;
  } else if (arg === "--prod-port") {
    options.prodPort = Number(value);
    index += 1;
  } else {
    console.error(`Unsupported argument: ${arg}`);
    process.exit(2);
  }
}

const comparedPages = ["/?lang=en", "/find-human?entryId=understand-letter-or-form&lang=en"];
const failures = [];
const processes = [];

function fail(message) {
  failures.push(message);
  console.log(`  FAIL  ${message}`);
}

function pass(message) {
  console.log(`  ok    ${message}`);
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

// Compare what a human would read, not what a bundler emitted. Script tags,
// style tags, Next's development overlay portal and build-id-stamped asset
// URLs legitimately differ between the two servers; the text of the page must
// not.
function renderedTextSignature(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<nextjs-portal[\s\S]*?<\/nextjs-portal>/gi, " ")
    .replace(/<template[\s\S]*?<\/template>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function startServer(label, command, commandArgs, env) {
  console.log(`  starting ${label}: ${command} ${commandArgs.join(" ")}`);
  const child = spawn(command, commandArgs, { env, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", () => {});
  child.stderr.on("data", (chunk) => process.stderr.write(`[${label}] ${chunk}`));
  processes.push(child);
  return child;
}

async function waitForHealth(baseUrl, timeoutMs) {
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

async function readChatShape(baseUrl) {
  const response = await fetch(`${baseUrl}/api/chat`, {
    body: JSON.stringify({
      entryId: "understand-letter-or-form",
      language: "en",
      messages: [{ id: "parity-probe", role: "user", text: "Synthetic parity probe." }],
    }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });

  const body = await response.text();
  const kinds = [
    ...new Set(
      body
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice("data:".length).trim())
        .filter((payload) => payload.startsWith("{"))
        .map((payload) => {
          try {
            return JSON.parse(payload).type ?? "unknown";
          } catch {
            return "unparseable";
          }
        }),
    ),
  ].sort();

  return {
    contentType: response.headers.get("content-type"),
    eventKinds: kinds,
    // Mock chat text is not asserted to be identical: parity is about
    // configuration and plumbing, not about pinning model output.
    nonEmpty: body.trim().length > 0,
    status: response.status,
  };
}

console.log("Build/runtime parity proof");
console.log("");

// 1. Is there even a production build to talk about?
if (!existsSync(".next/BUILD_ID")) {
  fail("no production build found (.next/BUILD_ID missing); run `npm run build` first");
}

// 2. Build-time versus runtime configuration.
const snapshotPath = options.buildEnv;
let snapshot = null;

if (!existsSync(snapshotPath)) {
  fail(`${snapshotPath} missing; the build did not record the environment it baked in (run through \`npm run verify:plan\`)`);
} else {
  snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"));
  const runtimeEnv = { ...process.env, DEV_MOCK_CHAT: "true" };
  let drifted = 0;

  for (const [key, bakedValue] of Object.entries(snapshot)) {
    const runtimeValue = runtimeEnv[key] ?? null;

    if (bakedValue !== runtimeValue) {
      drifted += 1;
      fail(`configuration drift on ${key}: built with ${JSON.stringify(bakedValue)}, running with ${JSON.stringify(runtimeValue)}`);
    }
  }

  if (drifted === 0) {
    pass(`${Object.keys(snapshot).length} build-time configuration key(s) match the runtime environment`);
  }
}

const parityEnv = {
  ...process.env,
  DEV_MOCK_CHAT: "true",
  NEXT_TELEMETRY_DISABLED: "1",
};

// `next dev` rewrites tsconfig.json to register its own generated types.
// Pointing it at a scratch build directory means it wants to add that
// directory's paths, which would leave a confusing unrelated diff in the
// working tree after every parity run. Put the file back exactly as it was.
const tsconfigPath = "tsconfig.json";
const tsconfigBefore = existsSync(tsconfigPath) ? readFileSync(tsconfigPath, "utf8") : null;

const prodBase = `http://127.0.0.1:${options.prodPort}`;
const devBase = `http://127.0.0.1:${options.devPort}`;
const observation = { dev: {}, prod: {} };

if (failures.length === 0) {
  startServer("prod", "npx", ["next", "start", "-p", String(options.prodPort), "-H", "127.0.0.1"], parityEnv);
  // Separate build directory for the development side: `next dev` rewrites
  // .next as it compiles, which would pull the production server's own build
  // out from under it mid-comparison. next.config.ts reads NEXT_DIST_DIR.
  startServer("dev", "npx", ["next", "dev", "-p", String(options.devPort), "-H", "127.0.0.1"], {
    ...parityEnv,
    NEXT_DIST_DIR: ".next-parity-dev",
  });

  const [prodHealth, devHealth] = await Promise.all([
    waitForHealth(prodBase, 180_000),
    waitForHealth(devBase, 180_000),
  ]);

  if (!prodHealth) {
    fail("production server never served /healthz");
  }

  if (!devHealth) {
    fail("development server never served /healthz");
  }

  if (prodHealth && devHealth) {
    observation.prod.health = prodHealth;
    observation.dev.health = devHealth;
    const prodJson = JSON.stringify(prodHealth, Object.keys(prodHealth).sort());
    const devJson = JSON.stringify(devHealth, Object.keys(devHealth).sort());

    if (prodJson === devJson) {
      pass(`/healthz configuration surface identical (chatMode=${prodHealth.chatMode}, deployEnv=${prodHealth.deployEnv}, deployConfigOk=${prodHealth.deployConfigOk})`);
    } else {
      fail(`/healthz differs between the production build and the development runtime:\n    prod ${prodJson}\n    dev  ${devJson}`);
    }

    observation.prod.pages = {};
    observation.dev.pages = {};

    for (const pagePath of comparedPages) {
      const [prodHtml, devHtml] = await Promise.all([
        fetch(new URL(pagePath, prodBase)).then((response) => response.text()),
        fetch(new URL(pagePath, devBase)).then((response) => response.text()),
      ]);
      const prodSignature = renderedTextSignature(prodHtml);
      const devSignature = renderedTextSignature(devHtml);
      observation.prod.pages[pagePath] = { digest: digest(prodSignature), length: prodSignature.length };
      observation.dev.pages[pagePath] = { digest: digest(devSignature), length: devSignature.length };

      if (prodSignature === devSignature) {
        pass(`rendered text identical for ${pagePath} (${prodSignature.length} chars, ${digest(prodSignature)})`);
      } else {
        const firstDifference = [...prodSignature].findIndex((character, index) => character !== devSignature[index]);
        fail(
          `rendered text differs for ${pagePath} at offset ${firstDifference}:\n    prod ...${prodSignature.slice(Math.max(0, firstDifference - 60), firstDifference + 60)}...\n    dev  ...${devSignature.slice(Math.max(0, firstDifference - 60), firstDifference + 60)}...`,
        );
      }
    }

    const [prodChat, devChat] = await Promise.all([readChatShape(prodBase), readChatShape(devBase)]);
    observation.prod.chat = prodChat;
    observation.dev.chat = devChat;

    // Both servers rejecting the probe identically would also be "identical".
    // The probe has to reach the real mock chat path for the comparison to
    // mean anything, so an unhealthy status is its own failure.
    if (prodChat.status !== 200 || devChat.status !== 200) {
      fail(
        `mock chat parity probe never reached the chat path (prod ${prodChat.status}, dev ${devChat.status}); comparing two refusals proves nothing`,
      );
    } else if (JSON.stringify(prodChat) === JSON.stringify(devChat)) {
      pass(`mock chat stream shape identical (status ${prodChat.status}, events ${prodChat.eventKinds.join("|")})`);
    } else {
      fail(
        `mock chat stream shape differs:\n    prod ${JSON.stringify(prodChat)}\n    dev  ${JSON.stringify(devChat)}`,
      );
    }
  }
}

for (const child of processes) {
  child.kill("SIGTERM");
}

if (tsconfigBefore !== null && readFileSync(tsconfigPath, "utf8") !== tsconfigBefore) {
  writeFileSync(tsconfigPath, tsconfigBefore);
  console.log("  note  restored tsconfig.json after the development server rewrote it");
}

const receipt = {
  buildEnvSnapshot: snapshot,
  buildId: existsSync(".next/BUILD_ID") ? readFileSync(".next/BUILD_ID", "utf8").trim() : null,
  comparedPages,
  failures,
  generatedAt: new Date().toISOString(),
  observation,
  status: failures.length === 0 ? "parity-proved" : "parity-failed",
};

mkdirSync(path.dirname(options.receipt), { recursive: true });
writeFileSync(options.receipt, `${JSON.stringify(receipt, null, 2)}\n`);

console.log("");
console.log(`parity receipt: ${options.receipt}`);
console.log(`PARITY ${receipt.status.toUpperCase()}`);

process.exitCode = failures.length === 0 ? 0 : 1;
