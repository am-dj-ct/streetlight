import path from "node:path";
import { defaultBaseUrl, getHealth } from "./lib/access-tool-http.mjs";
import { isChatStreamEvent } from "./lib/chat-stream.mjs";
import { readJsonFile } from "./lib/json-file.mjs";
import {
  readBooleanEnv,
  readOptionalPositiveIntegerEnv,
} from "./lib/script-env.mjs";
import { isWeakCategory } from "./lib/taxonomy.mjs";

const cwd = process.cwd();
const baseUrl = defaultBaseUrl;
const endpoint = new URL("/api/chat", baseUrl).toString();
const casesPath = path.join(cwd, "tests/prompts/response-style-cases.json");
const caseLimit = readOptionalPositiveIntegerEnv("RESPONSE_STYLE_CASE_LIMIT");
const caseFilter = (process.env.RESPONSE_STYLE_CASE_FILTER ?? "")
  .trim()
  .toLowerCase();
const allowMockStyleCheck = readBooleanEnv("ALLOW_MOCK_RESPONSE_STYLE");
const refusalPattern =
  /\b(i can't help with that|i cannot help with that|i can't assist with that|i cannot assist with that)\b/i;

const validEntryIds = new Set([
  "understand-letter-or-form",
  "write-something",
  "think-it-through",
  "figure-out-next",
  "explain-like-new",
  "prepare-for-hard",
  "am-i-being-unreasonable",
  "embarrassed-to-ask",
  "type-your-own",
  "talk-instead",
]);

function fail(message) {
  throw new Error(message);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function wordCount(text) {
  return (text.trim().match(/\S+/g) ?? []).length;
}

function validateCases(value) {
  if (!Array.isArray(value)) {
    fail(`${casesPath} must contain an array.`);
  }

  const seenNames = new Set();

  for (const [caseIndex, testCase] of value.entries()) {
    const label = `${casesPath}[${caseIndex}]`;

    if (!testCase || typeof testCase !== "object") {
      fail(`${label} must be an object.`);
    }

    if (!isNonEmptyString(testCase.name)) {
      fail(`${label} must include a non-empty name.`);
    }

    if (seenNames.has(testCase.name)) {
      fail(`${label} duplicates case name "${testCase.name}".`);
    }

    seenNames.add(testCase.name);

    if (!validEntryIds.has(testCase.entryId)) {
      fail(`${label} must include a valid entryId.`);
    }

    if (!Array.isArray(testCase.turns) || testCase.turns.length === 0) {
      fail(`${label} must include at least one turn.`);
    }

    for (const [turnIndex, turn] of testCase.turns.entries()) {
      const turnLabel = `${label}.turns[${turnIndex}]`;

      if (!turn || typeof turn !== "object") {
        fail(`${turnLabel} must be an object.`);
      }

      if (!isNonEmptyString(turn.text)) {
        fail(`${turnLabel} must include non-empty text.`);
      }

      if (
        !Number.isSafeInteger(turn.minWords) ||
        !Number.isSafeInteger(turn.maxWords) ||
        turn.minWords < 1 ||
        turn.maxWords < turn.minWords
      ) {
        fail(`${turnLabel} must include valid minWords and maxWords.`);
      }

      if (
        turn.expectedClassifier !== undefined &&
        !isWeakCategory(turn.expectedClassifier)
      ) {
        fail(`${turnLabel} has an invalid expectedClassifier.`);
      }
    }
  }

  return value;
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
  let suggestions = null;
  let sawDone = false;

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
        sawDone = true;
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

      if (event.type === "suggestions") {
        suggestions = event.suggestions;
      }
    }

    if (done) {
      break;
    }
  }

  return {
    classifierCategory,
    sawDone,
    suggestions,
    text: text.trim(),
  };
}

async function runTurn({ entryId, messages, testCase, turn, turnIndex }) {
  const startedAt = Date.now();
  messages.push({
    id: `response-style-${testCase.name}-${turnIndex}-user`,
    role: "user",
    text: turn.text,
  });

  const response = await fetch(endpoint, {
    body: JSON.stringify({
      entryId,
      language: "en",
      messages,
    }),
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  const result = await readSse(response);
  const durationMs = Date.now() - startedAt;
  const words = wordCount(result.text);

  if (!result.text) {
    fail(`${testCase.name} turn ${turnIndex + 1} returned no text.`);
  }

  if (refusalPattern.test(result.text)) {
    fail(`${testCase.name} turn ${turnIndex + 1} looked like a refusal.`);
  }

  if (!result.sawDone) {
    fail(`${testCase.name} turn ${turnIndex + 1} never emitted [DONE].`);
  }

  if (!result.classifierCategory) {
    fail(`${testCase.name} turn ${turnIndex + 1} returned no classifier event.`);
  }

  if (!result.suggestions || result.suggestions.length === 0) {
    fail(`${testCase.name} turn ${turnIndex + 1} returned no suggestions.`);
  }

  if (words < turn.minWords || words > turn.maxWords) {
    fail(
      `${testCase.name} turn ${turnIndex + 1} returned ${words} words; expected ${turn.minWords}-${turn.maxWords}.`,
    );
  }

  if (
    chatMode !== "mock-local" &&
    turn.expectedClassifier &&
    result.classifierCategory !== turn.expectedClassifier
  ) {
    fail(
      `${testCase.name} turn ${turnIndex + 1} expected classifier ${turn.expectedClassifier} but got ${result.classifierCategory}.`,
    );
  }

  messages.push({
    id: `response-style-${testCase.name}-${turnIndex}-assistant`,
    role: "assistant",
    text: result.text,
  });

  return {
    classifierCategory: result.classifierCategory,
    durationMs,
    maxWords: turn.maxWords,
    minWords: turn.minWords,
    suggestions: result.suggestions.length,
    turn: turnIndex + 1,
    words,
  };
}

const { chatMode } = await getHealth({ baseUrl, fail });

if (chatMode === "mock-local" && !allowMockStyleCheck) {
  fail(
    "Response style check is disabled in mock-local mode because it needs live model behavior. Turn off DEV_MOCK_CHAT or set ALLOW_MOCK_RESPONSE_STYLE=true for a plumbing-only check.",
  );
}

const allCases = validateCases(await readJsonFile(casesPath));
const filteredCases = caseFilter
  ? allCases.filter((testCase) =>
      `${testCase.entryId}/${testCase.name}`.toLowerCase().includes(caseFilter),
    )
  : allCases;
const cases =
  caseLimit === null ? filteredCases : filteredCases.slice(0, caseLimit);

if (cases.length === 0) {
  fail("No response style cases matched the current filter/limit.");
}

const results = [];

console.log(
  `Response style chat mode: ${chatMode}${chatMode === "mock-local" ? " (plumbing-only)" : ""}`,
);
console.log(`Running ${cases.length} response style case(s).`);

for (const testCase of cases) {
  process.stdout.write(`Running ${testCase.entryId}/${testCase.name}... `);
  const messages = [];
  const turnResults = [];

  for (const [turnIndex, turn] of testCase.turns.entries()) {
    turnResults.push(
      await runTurn({
        entryId: testCase.entryId,
        messages,
        testCase,
        turn,
        turnIndex,
      }),
    );
  }

  results.push({
    entryId: testCase.entryId,
    name: testCase.name,
    turns: turnResults,
  });
  console.log(
    turnResults
      .map(
        (result) =>
          `turn ${result.turn}: ${result.words} words, classifier=${result.classifierCategory}`,
      )
      .join("; "),
  );
}

console.log("\nResponse style summary");
for (const result of results) {
  for (const turn of result.turns) {
    console.log(
      `- ${result.entryId}/${result.name} turn ${turn.turn}: ${turn.words} words (${turn.minWords}-${turn.maxWords}), ${turn.durationMs}ms, classifier=${turn.classifierCategory}, suggestions=${turn.suggestions}`,
    );
  }
}
