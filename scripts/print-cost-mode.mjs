import { readFile } from "node:fs/promises";
import path from "node:path";

const cwd = process.cwd();
const envLocalPath = path.join(cwd, ".env.local");
const recommendedMainModel = "claude-haiku-4-5-20251001";
const recommendedClassifierModel = "claude-haiku-4-5-20251001";

function parseEnvFile(contents) {
  const entries = new Map();

  for (const rawLine of contents.split("\n")) {
    const line = rawLine.trim();

    if (!line || line.startsWith("#")) {
      continue;
    }

    const equalsIndex = line.indexOf("=");

    if (equalsIndex === -1) {
      continue;
    }

    const key = line.slice(0, equalsIndex).trim();
    const value = line.slice(equalsIndex + 1).trim();
    entries.set(key, value);
  }

  return entries;
}

let contents = "";

try {
  contents = await readFile(envLocalPath, "utf8");
} catch {
  console.log("No .env.local found.");
  process.exit(1);
}

const envEntries = parseEnvFile(contents);
const mainModel = envEntries.get("MAIN_MODEL") ?? "(unset)";
const classifierModel = envEntries.get("CLASSIFIER_MODEL") ?? "(unset)";
const devMockChat = envEntries.get("DEV_MOCK_CHAT") === "true";

console.log("Access Tool cost mode");
console.log("");
console.log(`MAIN_MODEL=${mainModel}`);
console.log(`CLASSIFIER_MODEL=${classifierModel}`);
console.log(`DEV_MOCK_CHAT=${devMockChat ? "true" : "false"}`);
console.log("");

if (devMockChat) {
  console.log("Status: zero-cost local mock mode is active.");
} else if (
  mainModel === recommendedMainModel &&
  classifierModel === recommendedClassifierModel
) {
  console.log("Status: low-cost local model mode is active.");
} else {
  console.log("Status: not in the recommended low-cost local mode.");
  console.log(`Recommended MAIN_MODEL=${recommendedMainModel}`);
  console.log(`Recommended CLASSIFIER_MODEL=${recommendedClassifierModel}`);
  console.log("Recommended DEV_MOCK_CHAT=true for zero-cost UI work.");
}

console.log("");
console.log("Cheaper local commands:");
console.log("- npm run dev:mock");
console.log("- npm run dev:live (when you want real model checks again)");
console.log("- npm run smoke:quick");
console.log("- npm run regression:quick");
console.log("- npm run verify:quick");
console.log("");
console.log("In mock mode, regression:quick is plumbing-only and avoids live-model validation.");
console.log("");
console.log("Note: full prompt regression still expects live-model mode.");
