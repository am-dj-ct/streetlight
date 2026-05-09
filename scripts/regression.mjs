import { readdir } from "node:fs/promises";
import path from "node:path";
import { defaultBaseUrl, getHealth } from "./lib/access-tool-http.mjs";
import { isChatStreamEvent } from "./lib/chat-stream.mjs";
import { readJsonFile } from "./lib/json-file.mjs";
import { validateRegressionCases } from "./lib/prompt-fixtures.mjs";
import {
  readBooleanEnv,
  readOptionalPositiveIntegerEnv,
} from "./lib/script-env.mjs";

const cwd = process.cwd();
const baseUrl = defaultBaseUrl;
const endpoint = new URL("/api/chat", baseUrl).toString();
const fixturesRoot = path.join(cwd, "tests/prompts");
const promptCaseLimit = readOptionalPositiveIntegerEnv("PROMPT_CASE_LIMIT");
const promptCaseFilter = (process.env.PROMPT_CASE_FILTER ?? "").trim().toLowerCase();
const allowMockRegression = readBooleanEnv("ALLOW_MOCK_REGRESSION");

const refusalPattern =
  /\b(i can't help with that|i cannot help with that|i can't assist with that|i cannot assist with that)\b/i;

function fail(message) {
  throw new Error(message);
}

async function loadCases() {
  const directories = await readdir(fixturesRoot, { withFileTypes: true });
  const allCases = [];

  for (const entry of directories) {
    if (!entry.isDirectory()) {
      continue;
    }

    const entryId = entry.name;
    const filePath = path.join(fixturesRoot, entryId, "cases.json");
    const cases = validateRegressionCases(await readJsonFile(filePath), filePath);

    for (const testCase of cases) {
      allCases.push({
        ...testCase,
        entryId,
      });
    }
  }

  const filteredCases = promptCaseFilter
    ? allCases.filter((testCase) => {
        const combined = `${testCase.entryId}/${testCase.name}`.toLowerCase();
        return combined.includes(promptCaseFilter);
      })
    : allCases;

  if (promptCaseLimit !== null) {
    return filteredCases.slice(0, promptCaseLimit);
  }

  return filteredCases;
}

async function readSse(response) {
  if (!response.ok) {
    fail(`HTTP ${response.status} from /api/chat.`);
  }

  if (!response.body) {
    fail("No response body from /api/chat.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let classifierCategory = null;

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });

    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";

    for (const eventBlock of events) {
      const dataLine = eventBlock
        .split("\n")
        .find((line) => line.startsWith("data: "));

      if (!dataLine) {
        continue;
      }

      const payload = dataLine.slice(6);

      if (payload === "[DONE]") {
        continue;
      }

      const event = JSON.parse(payload);

      if (!isChatStreamEvent(event)) {
        fail(`Unexpected stream event payload: ${payload}`);
      }

      if (event.type === "error") {
        fail(`Stream error for ${payload}`);
      }

      if (event.type === "delta") {
        text += event.text;
      }

      if (event.type === "classifier") {
        classifierCategory = event.category;
      }
    }

    if (done) {
      break;
    }
  }

  return {
    classifierCategory,
    text: text.trim(),
  };
}

async function runCase(testCase) {
  const startedAt = Date.now();
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      entryId: testCase.entryId,
      language: testCase.language ?? "en",
      messages: [
        {
          id: `regression-${testCase.entryId}-${testCase.name}`,
          role: "user",
          text: testCase.text,
        },
      ],
    }),
  });

  const result = await readSse(response);
  const durationMs = Date.now() - startedAt;

  if (!result.text) {
    fail(`Case ${testCase.entryId}/${testCase.name} returned no text.`);
  }

  if (refusalPattern.test(result.text)) {
    fail(`Case ${testCase.entryId}/${testCase.name} looked like a refusal.`);
  }

  if (!result.classifierCategory) {
    fail(`Case ${testCase.entryId}/${testCase.name} returned no classifier event.`);
  }

  if (
    chatMode !== "mock-local" &&
    testCase.expectedClassifier &&
    result.classifierCategory !== testCase.expectedClassifier
  ) {
    fail(
      `Case ${testCase.entryId}/${testCase.name} expected classifier ${testCase.expectedClassifier} but got ${result.classifierCategory}.`,
    );
  }

  return {
    classifierCategory: result.classifierCategory,
    durationMs,
    entryId: testCase.entryId,
    name: testCase.name,
    textLength: result.text.length,
  };
}

const { chatMode } = await getHealth({ baseUrl, fail });

if (chatMode === "mock-local" && !allowMockRegression) {
  fail(
    "Prompt regression is disabled in mock-local mode because it does not validate live model behavior. Turn off DEV_MOCK_CHAT or use npm run regression:quick if you only want a plumbing check.",
  );
}

const cases = await loadCases();
const results = [];

if (cases.length === 0) {
  fail("No regression cases matched the current filter/limit.");
}

console.log(
  `Regression chat mode: ${chatMode}${chatMode === "mock-local" ? " (plumbing-only)" : ""}`,
);
console.log(`Running ${cases.length} regression case(s).`);

for (const testCase of cases) {
  process.stdout.write(`Running ${testCase.entryId}/${testCase.name}... `);
  const result = await runCase(testCase);
  results.push(result);
  console.log(
    `ok (${result.durationMs}ms, ${result.textLength} chars, classifier=${result.classifierCategory})`,
  );
}

console.log("\nRegression summary");
for (const result of results) {
  console.log(
    `- ${result.entryId}/${result.name}: ${result.durationMs}ms, ${result.textLength} chars, classifier=${result.classifierCategory}`,
  );
}
