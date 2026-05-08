import { readFile } from "node:fs/promises";
import path from "node:path";

const cwd = process.cwd();
const baseUrl = process.env.ACCESS_TOOL_BASE_URL ?? "http://localhost:3000";
const endpoint = new URL("/api/chat", baseUrl).toString();
const healthEndpoint = new URL("/healthz", baseUrl).toString();
const casesPath = path.join(cwd, "tests/prompts/smoke-cases.json");
const smokeCaseLimit = Number.parseInt(process.env.SMOKE_CASE_LIMIT ?? "", 10);
const smokeCaseFilter = (process.env.SMOKE_CASE_FILTER ?? "").trim().toLowerCase();
const pageChecks = [
  {
    expectedText: "What do you need?",
    path: "/",
    reportLinkSnippet: "/report-problem?lang=en&amp;area=main-screen&amp;source=%2F%3Flang%3Den",
  },
  {
    expectedText: "Paste the letter or form here",
    path: "/conversation/understand-letter-or-form?lang=en",
    reportLinkSnippet:
      "/report-problem?lang=en&amp;area=conversation&amp;entryId=understand-letter-or-form&amp;source=%2Fconversation%2Funderstand-letter-or-form%3Flang%3Den",
  },
  {
    expectedText: "Find a human",
    extraExpectedText: [
      "Resource list checked through:",
      "Source:",
      "Verified:",
    ],
    path: "/find-human?entryId=understand-letter-or-form&lang=en",
    reportLinkSnippet:
      "/report-problem?lang=en&amp;area=find-human&amp;entryId=understand-letter-or-form&amp;source=%2Ffind-human%3FentryId%3Dunderstand-letter-or-form%26lang%3Den",
  },
  {
    expectedText: "About",
    path: "/about?lang=en",
    reportLinkSnippet:
      "/report-problem?lang=en&amp;area=about&amp;source=%2Fabout%3Flang%3Den",
  },
  {
    expectedText: "Privacy",
    path: "/privacy?lang=en",
    reportLinkSnippet:
      "/report-problem?lang=en&amp;area=privacy&amp;source=%2Fprivacy%3Flang%3Den",
  },
  {
    expectedText: "Report a problem",
    path: "/report-problem?lang=en",
    reportLinkSnippet: "/report-problem?lang=en&amp;area=other",
  },
  {
    expectedText: "Source route:",
    extraExpectedText: [
      "Current resource scope: <!-- -->King County, WA",
      "Entry button: <!-- -->Understand a letter or form",
      "Current chat mode: <!-- -->local mock chat",
    ],
    path: "/report-problem?lang=en&area=conversation&entryId=understand-letter-or-form&source=%2Fconversation%2Funderstand-letter-or-form%3Flang%3Den",
    reportLinkSnippet:
      "href=\"/conversation/understand-letter-or-form?lang=en\"",
  },
];

function fail(message) {
  throw new Error(message);
}

async function loadCases() {
  const allCases = JSON.parse(await readFile(casesPath, "utf8"));
  const filteredCases = smokeCaseFilter
    ? allCases.filter((testCase) =>
        `${testCase.name}/${testCase.entryId}`.toLowerCase().includes(smokeCaseFilter),
      )
    : allCases;

  if (Number.isFinite(smokeCaseLimit) && smokeCaseLimit > 0) {
    return filteredCases.slice(0, smokeCaseLimit);
  }

  return filteredCases;
}

async function checkHealth() {
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
    (body.chatMode !== "live-model" && body.chatMode !== "mock-local") ||
    body.deployConfigOk !== true
  ) {
    fail("Unexpected /healthz response body.");
  }

  return body.chatMode;
}

async function checkPages() {
  for (const page of pageChecks) {
    const response = await fetch(new URL(page.path, baseUrl), {
      headers: {
        Accept: "text/html",
      },
    });

    if (!response.ok) {
      fail(`HTTP ${response.status} from ${page.path}.`);
    }

    const html = await response.text();

    if (!html.includes(page.expectedText)) {
      fail(`Expected text not found on ${page.path}.`);
    }

    for (const extraExpectedText of page.extraExpectedText ?? []) {
      if (!html.includes(extraExpectedText)) {
        fail(`Expected extra text not found on ${page.path}: ${extraExpectedText}`);
      }
    }

    if (page.reportLinkSnippet && !html.includes(page.reportLinkSnippet)) {
      fail(`Expected report-problem link not found on ${page.path}.`);
    }
  }
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

const chatMode = await checkHealth();
console.log(`Health check ok (/healthz, chatMode=${chatMode}).`);
await checkPages();
console.log("Page checks ok (landing, conversation, referrals, support pages).");

const smokeCases = await loadCases();
const results = [];

if (smokeCases.length === 0) {
  fail("No smoke cases matched the current filter/limit.");
}

console.log(`Running ${smokeCases.length} smoke case(s).`);

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
