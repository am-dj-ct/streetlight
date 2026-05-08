import { access, readFile } from "node:fs/promises";
import path from "node:path";

const cwd = process.cwd();
const envFiles = [".env.example", ".env.local"];
const booleanVariables = [
  "DEV_MOCK_CHAT",
  "SOFT_PAUSE_ENABLED",
  "HARD_PAUSE_ENABLED",
];
const numericVariables = [
  "DAILY_SPEND_LIMIT_USD",
  "MAIN_MODEL_INPUT_COST_PER_MILLION_USD",
  "MAIN_MODEL_OUTPUT_COST_PER_MILLION_USD",
  "CLASSIFIER_MODEL_INPUT_COST_PER_MILLION_USD",
  "CLASSIFIER_MODEL_OUTPUT_COST_PER_MILLION_USD",
];

function fail(message) {
  throw new Error(message);
}

async function fileExists(relativePath) {
  try {
    await access(path.join(cwd, relativePath));
    return true;
  } catch {
    return false;
  }
}

function parseEnv(contents) {
  const values = new Map();

  for (const line of contents.split("\n")) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");

    if (separatorIndex === -1) {
      continue;
    }

    values.set(
      trimmed.slice(0, separatorIndex),
      trimmed.slice(separatorIndex + 1),
    );
  }

  return values;
}

function validateEnvValues(values, relativePath) {
  for (const variable of booleanVariables) {
    const value = values.get(variable);

    if (value === undefined || value === "") {
      continue;
    }

    if (value !== "true" && value !== "false") {
      fail(`${relativePath}: ${variable} must be "true", "false", or empty.`);
    }
  }

  for (const variable of numericVariables) {
    const value = values.get(variable);

    if (value === undefined || value === "") {
      continue;
    }

    const parsed = Number(value);

    if (!Number.isFinite(parsed) || parsed < 0) {
      fail(`${relativePath}: ${variable} must be a non-negative number or empty.`);
    }
  }
}

for (const relativePath of envFiles) {
  if (!(await fileExists(relativePath))) {
    continue;
  }

  const values = parseEnv(await readFile(path.join(cwd, relativePath), "utf8"));
  validateEnvValues(values, relativePath);
}

console.log("Env shape check passed.");
