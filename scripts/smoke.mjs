import { readFile } from "node:fs/promises";
import path from "node:path";
import { defaultBaseUrl, getHealth } from "./lib/access-tool-http.mjs";
import { getLanguagePersistenceSnapshot } from "./lib/language-persistence.mjs";

const cwd = process.cwd();
const baseUrl = defaultBaseUrl;
const endpoint = new URL("/api/chat", baseUrl).toString();
const casesPath = path.join(cwd, "tests/prompts/smoke-cases.json");
const smokeCaseLimit = Number.parseInt(process.env.SMOKE_CASE_LIMIT ?? "", 10);
const smokeCaseFilter = (process.env.SMOKE_CASE_FILTER ?? "").trim().toLowerCase();
const pageChecks = [
  {
    expectedText: "What do you need?",
    extraExpectedText: ['<html lang="en">'],
    path: "/",
    reportLinkSnippet: "/report-problem?lang=en&amp;area=main-screen&amp;source=%2F%3Flang%3Den",
  },
  {
    expectedText: "Full UI translation is still being added for this language.",
    extraExpectedText: ['<html lang="es">'],
    path: "/?lang=es",
    reportLinkSnippet: "/report-problem?lang=es&amp;area=main-screen&amp;source=%2F%3Flang%3Des",
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
    expectedText: "Show all resources",
    extraExpectedText: [
      "href=\"/find-human?entryId=understand-letter-or-form&amp;lang=en\"",
    ],
    path: "/find-human?category=benefits_eligibility&entryId=understand-letter-or-form&lang=en",
    reportLinkSnippet:
      "/report-problem?lang=en&amp;area=find-human&amp;entryId=understand-letter-or-form&amp;source=%2Ffind-human%3Fcategory%3Dbenefits_eligibility%26entryId%3Dunderstand-letter-or-form%26lang%3Den",
  },
  {
    expectedText: "Find a human",
    extraExpectedText: [
      "href=\"/?lang=en\"",
    ],
    path: "/find-human?entryId=not-a-real-entry&lang=en",
    reportLinkSnippet:
      "/report-problem?lang=en&amp;area=find-human&amp;entryId=not-a-real-entry&amp;source=%2Ffind-human%3FentryId%3Dnot-a-real-entry%26lang%3Den",
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
      "Current resource scope:<!-- --> <!-- -->King County, WA",
      "Entry button:<!-- --> <!-- -->Understand a letter or form",
      "Current chat mode:<!-- --> <!-- -->local mock chat",
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

async function checkLanguagePersistence() {
  const snapshot = await getLanguagePersistenceSnapshot({ baseUrl, fail });

  if (snapshot.languageCookie !== "access_tool_lang=es") {
    fail("Expected Spanish language cookie was not set.");
  }

  if (snapshot.homeContentLanguage !== "es") {
    fail("Expected Spanish Content-Language header on /?lang=es.");
  }

  if (!snapshot.privacyHtml?.includes('<html lang="es">')) {
    fail("Expected persisted Spanish html lang on /privacy.");
  }

  if (snapshot.privacyContentLanguage !== "es") {
    fail("Expected persisted Spanish Content-Language header on /privacy.");
  }

  if (
    !snapshot.privacyHtml?.includes(
      "This page is still showing the English version while human translation is being added.",
    )
  ) {
    fail("Expected non-English fallback notice on /privacy with persisted language cookie.");
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

async function checkInvalidChatEntryId() {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      entryId: "not-a-real-entry",
      language: "en",
      messages: [
        {
          id: "smoke-invalid-entry",
          role: "user",
          text: "hello",
        },
      ],
    }),
  });

  if (response.status !== 400) {
    fail(`Expected 400 from /api/chat for invalid entryId, got ${response.status}.`);
  }

  const payload = await response.json().catch(() => null);

  if (payload?.error !== "Invalid request shape.") {
    fail("Unexpected invalid-entry response body from /api/chat.");
  }
}

async function checkInvalidChatLanguage() {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      entryId: "understand-letter-or-form",
      language: "not-a-real-language",
      messages: [
        {
          id: "smoke-invalid-language",
          role: "user",
          text: "hello",
        },
      ],
    }),
  });

  if (response.status !== 400) {
    fail(`Expected 400 from /api/chat for invalid language, got ${response.status}.`);
  }

  const payload = await response.json().catch(() => null);

  if (payload?.error !== "Invalid request shape.") {
    fail("Unexpected invalid-language response body from /api/chat.");
  }
}

async function checkInvalidTurnstileToken() {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      entryId: "understand-letter-or-form",
      language: "en",
      messages: [
        {
          id: "smoke-invalid-turnstile",
          role: "user",
          text: "hello",
        },
      ],
      turnstileToken: { nope: true },
    }),
  });

  if (response.status !== 400) {
    fail(`Expected 400 from /api/chat for invalid turnstileToken, got ${response.status}.`);
  }

  const payload = await response.json().catch(() => null);

  if (payload?.error !== "Invalid request shape.") {
    fail("Unexpected invalid-turnstile response body from /api/chat.");
  }
}

async function checkUnsafeReportProblemSource() {
  const unsafeSource = encodeURIComponent("https://evil.example/phish");
  const response = await fetch(
    new URL(`/report-problem?lang=en&source=${unsafeSource}`, baseUrl),
    {
      headers: {
        Accept: "text/html",
      },
    },
  );

  if (!response.ok) {
    fail(`HTTP ${response.status} from /report-problem with unsafe source.`);
  }

  const html = await response.text();

  if (html.includes('href="https://evil.example/phish"')) {
    fail("Unsafe external source link rendered on /report-problem.");
  }
}

async function checkBlankChatMessage() {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      entryId: "understand-letter-or-form",
      language: "en",
      messages: [
        {
          id: "smoke-blank-message",
          role: "user",
          text: "   \n   ",
        },
      ],
    }),
  });

  if (response.status !== 400) {
    fail(`Expected 400 from /api/chat for blank message content, got ${response.status}.`);
  }

  const payload = await response.json().catch(() => null);

  if (payload?.error !== "No messages to send.") {
    fail("Unexpected blank-message response body from /api/chat.");
  }
}

const health = await getHealth({
  baseUrl,
  fail,
  requireDeployConfigOk: true,
});
console.log(`Health check ok (/healthz, chatMode=${health.chatMode}).`);
await checkPages();
console.log("Page checks ok (landing, conversation, referrals, support pages).");
await checkLanguagePersistence();
console.log("Language persistence ok (query -> cookie -> later request).");
await checkInvalidChatEntryId();
console.log("Invalid entryId handling ok (/api/chat rejects bad entry ids).");
await checkInvalidChatLanguage();
console.log("Invalid language handling ok (/api/chat rejects bad language codes).");
await checkInvalidTurnstileToken();
console.log("Invalid turnstileToken handling ok (/api/chat rejects bad token shapes).");
await checkUnsafeReportProblemSource();
console.log("Unsafe source handling ok (/report-problem ignores external source links).");
await checkBlankChatMessage();
console.log("Blank message handling ok (/api/chat rejects all-whitespace messages).");

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
