import { readFile } from "node:fs/promises";
import path from "node:path";

const cwd = process.cwd();
const baseUrl = process.env.ACCESS_TOOL_BASE_URL ?? "http://localhost:3000";
const endpoint = new URL("/api/chat", baseUrl).toString();
const casesPath = path.join(cwd, "tests/prompts/smoke-cases.json");

function fail(message) {
  throw new Error(message);
}

async function loadCases() {
  return JSON.parse(await readFile(casesPath, "utf8"));
}

async function parseSseResponse(response) {
  if (!response.ok) {
    const text = await response.text();
    fail(`HTTP ${response.status} from /api/chat: ${text.slice(0, 300)}`);
  }

  if (!response.body) {
    fail("No response body from /api/chat.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let classifierCategory = null;
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

      if (event.type === "error") {
        fail(`Stream returned error event: ${event.error}`);
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
    sawDone,
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
      language: testCase.language,
      messages: [
        {
          id: `smoke-${testCase.name}`,
          role: "user",
          text: testCase.text,
        },
      ],
    }),
  });

  const result = await parseSseResponse(response);
  const durationMs = Date.now() - startedAt;

  if (!result.text) {
    fail(`Case "${testCase.name}" returned no assistant text.`);
  }

  if (!result.classifierCategory) {
    fail(`Case "${testCase.name}" returned no classifier event.`);
  }

  if (!result.sawDone) {
    fail(`Case "${testCase.name}" never emitted [DONE].`);
  }

  if (durationMs > 15000) {
    fail(`Case "${testCase.name}" took too long: ${durationMs}ms.`);
  }

  return {
    classifierCategory: result.classifierCategory,
    durationMs,
    name: testCase.name,
    textLength: result.text.length,
  };
}

const smokeCases = await loadCases();
const results = [];

for (const testCase of smokeCases) {
  process.stdout.write(`Running ${testCase.name}... `);
  const result = await runCase(testCase);
  results.push(result);
  console.log(
    `ok (${result.durationMs}ms, ${result.textLength} chars, classifier=${result.classifierCategory})`,
  );
}

console.log("\nSmoke summary");
for (const result of results) {
  console.log(
    `- ${result.name}: ${result.durationMs}ms, ${result.textLength} chars, classifier=${result.classifierCategory}`,
  );
}
