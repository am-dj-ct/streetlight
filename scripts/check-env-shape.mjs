import { access, readFile } from "node:fs/promises";
import path from "node:path";

const cwd = process.cwd();
const envFiles = [".env.example", ".env.local"];
const exampleEnvVariables = [
  "ANTHROPIC_API_KEY",
  "MAIN_MODEL",
  "CLASSIFIER_MODEL",
  "DEV_MOCK_CHAT",
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
  const duplicates = [];

  for (const line of contents.split("\n")) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");

    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex);

    if (values.has(key)) {
      duplicates.push(key);
    }

    values.set(key, trimmed.slice(separatorIndex + 1));
  }

  return {
    duplicates,
    values,
  };
}

function assertSameSet(label, expected, actual) {
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  const missing = expected.filter((value) => !actualSet.has(value));
  const extra = actual.filter((value) => !expectedSet.has(value));

  if (missing.length === 0 && extra.length === 0) {
    return;
  }

  const parts = [];

  if (missing.length > 0) {
    parts.push(`missing: ${missing.join(", ")}`);
  }

  if (extra.length > 0) {
    parts.push(`extra: ${extra.join(", ")}`);
  }

  fail(`${label} mismatch (${parts.join("; ")}).`);
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

    if (value === undefined || value.trim() === "") {
      continue;
    }

    const parsed = Number(value.trim());

    if (!Number.isFinite(parsed) || parsed < 0) {
      fail(`${relativePath}: ${variable} must be a non-negative number or empty.`);
    }
  }
}

for (const relativePath of envFiles) {
  if (!(await fileExists(relativePath))) {
    continue;
  }

  const { duplicates, values } = parseEnv(
    await readFile(path.join(cwd, relativePath), "utf8"),
  );

  if (duplicates.length > 0) {
    fail(`${relativePath}: duplicate variable(s): ${[...new Set(duplicates)].join(", ")}.`);
  }

  if (relativePath === ".env.example") {
    assertSameSet(`${relativePath} variables`, exampleEnvVariables, [...values.keys()]);
  }

  validateEnvValues(values, relativePath);
}

console.log("Env shape check passed.");
