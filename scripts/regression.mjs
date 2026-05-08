import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const cwd = process.cwd();
const baseUrl = process.env.ACCESS_TOOL_BASE_URL ?? "http://localhost:3000";
const endpoint = new URL("/api/chat", baseUrl).toString();
const healthEndpoint = new URL("/healthz", baseUrl).toString();
const fixturesRoot = path.join(cwd, "tests/prompts");
const promptCaseLimit = Number.parseInt(process.env.PROMPT_CASE_LIMIT ?? "", 10);
const promptCaseFilter = (process.env.PROMPT_CASE_FILTER ?? "").trim().toLowerCase();
const allowMockRegression = process.env.ALLOW_MOCK_REGRESSION === "true";

const refusalPattern =
  /\b(i can't help with that|i cannot help with that|i can't assist with that|i cannot assist with that)\b/i;

function fail(message) {
  throw new Error(message);
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
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
    const cases = await readJson(filePath);

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

  if (Number.isFinite(promptCaseLimit) && promptCaseLimit > 0) {
    return filteredCases.slice(0, promptCaseLimit);
  }

  return filteredCases;
}

async function getChatMode() {
  const response = await fetch(healthEndpoint, {
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    fail(`HTTP ${response.status} from /healthz.`);
  }

  const body = await response.json().catch(() => null);

  if (
    !body ||
    body.ok !== true ||
    body.service !== "access-tool" ||
    (body.chatMode !== "live-model" && body.chatMode !== "mock-local")
  ) {
    fail("Unexpected /healthz response body.");
  }

  return body.chatMode;
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

const chatMode = await getChatMode();

if (chatMode === "mock-local" && !allowMockRegression) {
  fail(
    "Prompt regression is disabled in mock-local mode because it does not validate live model behavior. Turn off DEV_MOCK_CHAT or rerun with ALLOW_MOCK_REGRESSION=true if you only want a plumbing check.",
  );
}

const cases = await loadCases();
const results = [];

if (cases.length === 0) {
  fail("No regression cases matched the current filter/limit.");
}

console.log(`Regression chat mode: ${chatMode}`);
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
