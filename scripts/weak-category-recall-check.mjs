import { readFile } from "node:fs/promises";
import path from "node:path";
import { defaultBaseUrl, getHealth } from "./lib/access-tool-http.mjs";
import { isChatStreamEvent } from "./lib/chat-stream.mjs";
import {
  isWeakCategory,
  supportedLanguageCodes,
  weakCategories,
} from "./lib/taxonomy.mjs";
import {
  readBooleanEnv,
  readOptionalPositiveIntegerEnv,
} from "./lib/script-env.mjs";

const cwd = process.cwd();
const baseUrl = defaultBaseUrl;
const endpoint = new URL("/api/chat", baseUrl).toString();
const casesPath = path.join(cwd, "tests", "prompts", "weak-category-recall-cases.json");
const caseLimit = readOptionalPositiveIntegerEnv("WEAK_CATEGORY_RECALL_CASE_LIMIT");
const caseFilter = (process.env.WEAK_CATEGORY_RECALL_FILTER ?? "")
  .trim()
  .toLowerCase();
const allowMockRecall = readBooleanEnv("ALLOW_MOCK_RECALL");
const supportedLanguageCodeSet = new Set(supportedLanguageCodes);
const categorySet = new Set(weakCategories);

function fail(message) {
  throw new Error(message);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function validateCase(testCase, index) {
  const label = `weak-category-recall-cases.json[${index}]`;

  if (!testCase || typeof testCase !== "object") {
    fail(`${label} must be an object.`);
  }

  if (!isNonEmptyString(testCase.name)) {
    fail(`${label} must include a non-empty name.`);
  }

  if (!isNonEmptyString(testCase.entryId)) {
    fail(`${label} must include a non-empty entryId.`);
  }

  if (!isNonEmptyString(testCase.tier)) {
    fail(`${label} must include a non-empty tier.`);
  }

  if (!isNonEmptyString(testCase.text)) {
    fail(`${label} must include non-empty text.`);
  }

  if (
    testCase.language !== undefined &&
    !supportedLanguageCodeSet.has(testCase.language)
  ) {
    fail(`${label} has an invalid language.`);
  }

  const hasExpectedClassifier =
    testCase.expectedClassifier !== undefined &&
    isWeakCategory(testCase.expectedClassifier);
  const hasExpectedAnyOf =
    Array.isArray(testCase.expectedAnyOf) &&
    testCase.expectedAnyOf.length > 0 &&
    testCase.expectedAnyOf.every((category) => isWeakCategory(category));

  if (!hasExpectedClassifier && !hasExpectedAnyOf) {
    fail(`${label} must include expectedClassifier or expectedAnyOf.`);
  }

  return {
    entryId: testCase.entryId,
    expectedAnyOf: hasExpectedAnyOf
      ? [...new Set(testCase.expectedAnyOf)]
      : [testCase.expectedClassifier],
    language: testCase.language ?? "en",
    name: testCase.name,
    text: testCase.text,
    tier: testCase.tier,
  };
}

async function loadCases() {
  const raw = await readFile(casesPath, "utf8");
  const parsed = JSON.parse(raw);

  if (!Array.isArray(parsed)) {
    fail("weak-category-recall-cases.json must contain an array.");
  }

  const seenNames = new Set();
  const cases = parsed.map((testCase, index) => {
    const validated = validateCase(testCase, index);

    if (seenNames.has(validated.name)) {
      fail(`Duplicate recall case name: ${validated.name}`);
    }

    seenNames.add(validated.name);
    return validated;
  });

  const filteredCases = caseFilter
    ? cases.filter((testCase) => {
        const combined = `${testCase.expectedAnyOf.join(",")}/${testCase.tier}/${testCase.name}`.toLowerCase();
        return combined.includes(caseFilter);
      })
    : cases;

  if (caseLimit !== null) {
    return filteredCases.slice(0, caseLimit);
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
  let classifierCategory = null;
  let responseChars = 0;
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
        fail(`Unexpected stream event type.`);
      }

      if (event.type === "error") {
        fail("Stream returned an error event.");
      }

      if (event.type === "delta") {
        responseChars += event.text.length;
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
    responseChars,
    sawDone,
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
      language: testCase.language,
      messages: [
        {
          id: `weak-category-recall-${testCase.name}`,
          role: "user",
          text: testCase.text,
        },
      ],
    }),
  });
  const result = await readSse(response);
  const durationMs = Date.now() - startedAt;

  if (!result.sawDone) {
    fail(`${testCase.name} never emitted [DONE].`);
  }

  if (result.responseChars === 0) {
    fail(`${testCase.name} returned no assistant text.`);
  }

  if (!result.classifierCategory) {
    fail(`${testCase.name} returned no classifier event.`);
  }

  return {
    actual: result.classifierCategory,
    durationMs,
    expectedAnyOf: testCase.expectedAnyOf,
    matched: testCase.expectedAnyOf.includes(result.classifierCategory),
    name: testCase.name,
    responseChars: result.responseChars,
    tier: testCase.tier,
  };
}

function incrementSummary(map, key, matched) {
  const existing = map.get(key) ?? { failed: 0, passed: 0 };

  if (matched) {
    existing.passed += 1;
  } else {
    existing.failed += 1;
  }

  map.set(key, existing);
}

const { chatMode } = await getHealth({ baseUrl, fail });

if (chatMode === "mock-local" && !allowMockRecall) {
  fail(
    "Weak-category recall checks require live model mode. Turn off DEV_MOCK_CHAT, or set ALLOW_MOCK_RECALL=true only for plumbing checks.",
  );
}

const cases = await loadCases();

if (cases.length === 0) {
  fail("No weak-category recall cases matched the current filter/limit.");
}

console.log(
  `Weak-category recall chat mode: ${chatMode}${chatMode === "mock-local" ? " (plumbing-only)" : ""}`,
);
console.log(`Running ${cases.length} weak-category recall case(s).`);

const categorySummary = new Map();
const tierSummary = new Map();
const failures = [];
let passed = 0;

for (const testCase of cases) {
  const expectedLabel = testCase.expectedAnyOf.join("|");
  process.stdout.write(
    `Running ${expectedLabel}/${testCase.tier}/${testCase.name}... `,
  );

  const result = await runCase(testCase);
  const expectedPrimary = testCase.expectedAnyOf[0];
  incrementSummary(categorySummary, expectedPrimary, result.matched);
  incrementSummary(tierSummary, testCase.tier, result.matched);

  if (result.matched) {
    passed += 1;
    console.log(
      `ok (${result.durationMs}ms, classifier=${result.actual}, chars=${result.responseChars})`,
    );
    continue;
  }

  failures.push(result);
  console.log(
    `FAIL (${result.durationMs}ms, expected=${expectedLabel}, got=${result.actual})`,
  );
}

console.log("");
console.log(`Weak-category recall summary: ${passed}/${cases.length} passed, ${failures.length} failed`);

console.log("");
console.log("By expected category");
for (const category of categorySet) {
  const summary = categorySummary.get(category);

  if (!summary) {
    continue;
  }

  const total = summary.passed + summary.failed;
  console.log(`- ${category}: ${summary.passed}/${total}`);
}

console.log("");
console.log("By tier");
for (const [tier, summary] of [...tierSummary.entries()].sort(([left], [right]) =>
  left.localeCompare(right),
)) {
  const total = summary.passed + summary.failed;
  console.log(`- ${tier}: ${summary.passed}/${total}`);
}

if (failures.length > 0) {
  console.log("");
  console.log("Failures");
  for (const failure of failures) {
    console.log(
      `- ${failure.name}: expected ${failure.expectedAnyOf.join("|")}, got ${failure.actual}`,
    );
  }

  process.exit(1);
}
