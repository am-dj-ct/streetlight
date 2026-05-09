import path from "node:path";
import {
  defaultBaseUrl,
  extractHtmlLang,
  fetchHtmlPage,
  getHealth,
} from "./lib/access-tool-http.mjs";
import { isChatStreamEvent } from "./lib/chat-stream.mjs";
import { readJsonFile } from "./lib/json-file.mjs";
import { getLanguagePersistenceSnapshot } from "./lib/language-persistence.mjs";
import { getReferralsSnapshot, getReportProblemSnapshot } from "./lib/page-snapshots.mjs";
import { validateSmokeCases } from "./lib/prompt-fixtures.mjs";
import { readOptionalPositiveIntegerEnv } from "./lib/script-env.mjs";

const cwd = process.cwd();
const baseUrl = defaultBaseUrl;
const endpoint = new URL("/api/chat", baseUrl).toString();
const casesPath = path.join(cwd, "tests/prompts/smoke-cases.json");
const smokeCaseLimit = readOptionalPositiveIntegerEnv("SMOKE_CASE_LIMIT");
const smokeCaseFilter = (process.env.SMOKE_CASE_FILTER ?? "").trim().toLowerCase();
const pageChecks = [
  {
    expectedText: "What do you need?",
    expectedHtmlLang: "en",
    path: "/",
    reportLinkSnippet: "/report-problem?lang=en&amp;area=main-screen&amp;source=%2F%3Flang%3Den",
  },
  {
    expectedText: "Full UI translation is still being added for this language.",
    expectedHtmlLang: "es",
    path: "/?lang=es",
    reportLinkSnippet: "/report-problem?lang=es&amp;area=main-screen&amp;source=%2F%3Flang%3Des",
  },
  {
    expectedText: "What do you need?",
    expectedHtmlLang: "en",
    path: "/?lang=not-a-real-language",
    reportLinkSnippet: "/report-problem?lang=en&amp;area=main-screen&amp;source=%2F%3Flang%3Den",
  },
  {
    expectedText: "Paste the letter or form here",
    extraExpectedText: [
      'maxLength="8000"',
      'href="tel:988"',
      'href="tel:911"',
    ],
    path: "/conversation/understand-letter-or-form?lang=en",
    reportLinkSnippet:
      "/report-problem?lang=en&amp;area=conversation&amp;entryId=understand-letter-or-form&amp;source=%2Fconversation%2Funderstand-letter-or-form%3Flang%3Den",
  },
  {
    expectedText: "Paste the letter or form here",
    expectedHtmlLang: "en",
    path: "/conversation/understand-letter-or-form?lang=not-a-real-language",
    reportLinkSnippet:
      "/report-problem?lang=en&amp;area=conversation&amp;entryId=understand-letter-or-form&amp;source=%2Fconversation%2Funderstand-letter-or-form%3Flang%3Den",
  },
  {
    expectedText: "Find a human",
    extraExpectedText: [
      "Resource list checked through:",
      "Source:",
      "Verified:",
      'target="_blank" rel="noopener noreferrer"',
    ],
    path: "/find-human?entryId=understand-letter-or-form&lang=en",
    reportLinkSnippet:
      "/report-problem?lang=en&amp;area=find-human&amp;entryId=understand-letter-or-form&amp;source=%2Ffind-human%3FentryId%3Dunderstand-letter-or-form%26lang%3Den",
  },
  {
    expectedText: "Find a human",
    extraExpectedText: [
      'href="/conversation/understand-letter-or-form?lang=en"',
    ],
    expectedHtmlLang: "en",
    path: "/find-human?entryId=understand-letter-or-form&lang=not-a-real-language",
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
      "/report-problem?lang=en&amp;area=find-human&amp;source=%2Ffind-human%3Flang%3Den",
  },
  {
    expectedText: "Find a human",
    extraExpectedText: [
      "href=\"/conversation/understand-letter-or-form?lang=en\"",
    ],
    path: "/find-human?category=not-a-real-category&entryId=understand-letter-or-form&lang=en",
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
    expectedText: "About",
    expectedHtmlLang: "en",
    path: "/about?lang=not-a-real-language",
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
    expectedText: "Privacy",
    expectedHtmlLang: "en",
    path: "/privacy?lang=not-a-real-language",
    reportLinkSnippet:
      "/report-problem?lang=en&amp;area=privacy&amp;source=%2Fprivacy%3Flang%3Den",
  },
  {
    expectedText: "Report a problem",
    extraExpectedText: [
      'maxLength="800"',
      'maxLength="1200"',
    ],
    path: "/report-problem?lang=en",
    reportLinkSnippet: "/report-problem?lang=en&amp;area=other",
  },
  {
    expectedText: "Report a problem",
    expectedHtmlLang: "en",
    path: "/report-problem?lang=not-a-real-language",
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

function assertBrowserSecurityHeaders(response, label) {
  const expectedHeaders = [
    ["permissions-policy", "camera=(), geolocation=(), payment=(), usb=()"],
    ["referrer-policy", "strict-origin-when-cross-origin"],
    ["x-content-type-options", "nosniff"],
    ["x-frame-options", "DENY"],
  ];

  for (const [name, expectedValue] of expectedHeaders) {
    const actualValue = response.headers.get(name);

    if (actualValue !== expectedValue) {
      fail(
        `${label} must set ${name}: ${expectedValue}; received ${actualValue ?? "(missing)"}.`,
      );
    }
  }
}

function assertNoStore(response, label) {
  if (response.headers.get("cache-control") !== "no-store") {
    fail(`${label} must set Cache-Control: no-store.`);
  }
}

async function loadCases() {
  const allCases = validateSmokeCases(
    await readJsonFile(casesPath),
    "tests/prompts/smoke-cases.json",
  );
  const filteredCases = smokeCaseFilter
    ? allCases.filter((testCase) =>
        `${testCase.name}/${testCase.entryId}`.toLowerCase().includes(smokeCaseFilter),
      )
    : allCases;

  if (smokeCaseLimit !== null) {
    return filteredCases.slice(0, smokeCaseLimit);
  }

  return filteredCases;
}

async function checkPages() {
  for (const page of pageChecks) {
    const { html, response } = await fetchHtmlPage({
      baseUrl,
      fail,
      path: page.path,
    });

    assertBrowserSecurityHeaders(response, page.path);

    if (!html.includes(page.expectedText)) {
      fail(`Expected text not found on ${page.path}.`);
    }

    if (page.expectedHtmlLang && extractHtmlLang(html) !== page.expectedHtmlLang) {
      fail(`Unexpected html lang on ${page.path}.`);
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

  if (extractHtmlLang(snapshot.privacyHtml ?? "") !== "es") {
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

      if (!isChatStreamEvent(event)) {
        fail(`Unexpected stream event payload: ${payload}`);
      }

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
  await expectInvalidChatRequestShape(
    {
      entryId: "not-a-real-entry",
      language: "en",
      messages: [
        {
          id: "smoke-invalid-entry",
          role: "user",
          text: "hello",
        },
      ],
    },
    "invalid entryId",
  );
}

async function checkInvalidJsonBody() {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: "{this-is:not-json",
  });

  if (response.status !== 400) {
    fail(`Expected 400 from /api/chat for invalid JSON body, got ${response.status}.`);
  }

  const payload = await response.json().catch(() => null);

  if (payload?.error !== "Invalid JSON body.") {
    fail("Unexpected invalid-JSON response body from /api/chat.");
  }

  assertNoStore(response, "Invalid JSON response");
}

async function checkWrongChatMethod() {
  const response = await fetch(endpoint, {
    method: "GET",
  });

  if (response.status !== 405) {
    fail(`Expected 405 from /api/chat for GET, got ${response.status}.`);
  }
}

async function checkOversizedChatBody() {
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
          id: "smoke-oversized-body",
          role: "user",
          text: "x".repeat(65000),
        },
      ],
    }),
  });

  if (response.status !== 413) {
    fail(`Expected 413 from /api/chat for oversized body, got ${response.status}.`);
  }

  const payload = await response.json().catch(() => null);

  if (payload?.error !== "Request body too large.") {
    fail("Unexpected oversized-body response from /api/chat.");
  }

  assertNoStore(response, "Oversized body response");
}

async function checkNullJsonBody() {
  await expectInvalidChatRequestShape(null, "null JSON body");
}

async function checkStringJsonBody() {
  await expectInvalidChatRequestShape("hello", "string JSON body");
}

async function checkInvalidChatLanguage() {
  await expectInvalidChatRequestShape(
    {
      entryId: "understand-letter-or-form",
      language: "not-a-real-language",
      messages: [
        {
          id: "smoke-invalid-language",
          role: "user",
          text: "hello",
        },
      ],
    },
    "invalid language",
  );
}

async function checkInvalidTurnstileToken() {
  await expectInvalidChatRequestShape(
    {
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
    },
    "invalid turnstileToken",
  );
}

async function expectInvalidChatRequestShape(body, label) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (response.status !== 400) {
    fail(`Expected 400 from /api/chat for ${label}, got ${response.status}.`);
  }

  const payload = await response.json().catch(() => null);

  if (payload?.error !== "Invalid request shape.") {
    fail(`Unexpected ${label} response body from /api/chat.`);
  }
}

async function checkUnsafeReportProblemSource() {
  const unsafeSource = encodeURIComponent("https://evil.example/phish");
  const snapshot = await getReportProblemSnapshot({
    baseUrl,
    fail,
    path: `/report-problem?lang=en&source=${unsafeSource}`,
  });

  if (snapshot.html.includes('href="https://evil.example/phish"')) {
    fail("Unsafe external source link rendered on /report-problem.");
  }
}

async function checkReportProblemDoesNotPrerenderMailto() {
  const { html } = await fetchHtmlPage({
    baseUrl,
    fail,
    path: "/report-problem?lang=en",
  });

  if (html.includes("mailto:")) {
    fail("Report page must not pre-render a mailto href.");
  }
}

async function checkDisallowedInternalReportProblemSource() {
  const disallowedSource = encodeURIComponent("/api/chat?lang=en");
  const snapshot = await getReportProblemSnapshot({
    baseUrl,
    fail,
    path: `/report-problem?lang=en&source=${disallowedSource}`,
  });

  if (snapshot.sourceRoute !== "not supplied") {
    fail("Disallowed internal source path rendered on /report-problem.");
  }
}

async function checkMalformedInternalReportProblemSource() {
  const malformedSource = encodeURIComponent("//evil.example/path");
  const snapshot = await getReportProblemSnapshot({
    baseUrl,
    fail,
    path: `/report-problem?lang=en&source=${malformedSource}`,
  });

  if (snapshot.sourceRoute !== "not supplied") {
    fail("Malformed internal source path rendered on /report-problem.");
  }
}

async function checkOversizedReportProblemSource() {
  const oversizedSource = encodeURIComponent(`/privacy?lang=en&x=${"a".repeat(600)}`);
  const snapshot = await getReportProblemSnapshot({
    baseUrl,
    fail,
    path: `/report-problem?lang=en&source=${oversizedSource}`,
  });

  if (snapshot.sourceRoute !== "not supplied") {
    fail("Oversized internal source path rendered on /report-problem.");
  }
}

async function checkIncompleteConversationReportProblemSource() {
  const incompleteSource = encodeURIComponent("/conversation");
  const snapshot = await getReportProblemSnapshot({
    baseUrl,
    fail,
    path: `/report-problem?lang=en&source=${incompleteSource}`,
  });

  if (snapshot.sourceRoute !== "not supplied") {
    fail("Incomplete conversation source path rendered on /report-problem.");
  }

  const invalidConversationSource = encodeURIComponent(
    "/conversation/not-a-real-entry?lang=en",
  );
  const invalidSnapshot = await getReportProblemSnapshot({
    baseUrl,
    fail,
    path: `/report-problem?lang=en&source=${invalidConversationSource}`,
  });

  if (invalidSnapshot.sourceRoute !== "not supplied") {
    fail("Invalid conversation source path rendered on /report-problem.");
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

async function checkEmptyMessagesArray() {
  await expectInvalidChatRequestShape(
    {
      entryId: "understand-letter-or-form",
      language: "en",
      messages: [],
    },
    "empty messages array",
  );
}

async function checkMissingMessagesArray() {
  await expectInvalidChatRequestShape(
    {
      entryId: "understand-letter-or-form",
      language: "en",
      messages: {
        id: "smoke-invalid-messages",
        role: "user",
        text: "hello",
      },
    },
    "non-array messages",
  );
}

async function checkInvalidMessageTextShape() {
  await expectInvalidChatRequestShape(
    {
      entryId: "understand-letter-or-form",
      language: "en",
      messages: [
        {
          id: "smoke-invalid-text",
          role: "user",
          text: 42,
        },
      ],
    },
    "non-string message text",
  );
}

async function checkMissingMessageText() {
  await expectInvalidChatRequestShape(
    {
      entryId: "understand-letter-or-form",
      language: "en",
      messages: [
        {
          id: "smoke-missing-text",
          role: "user",
        },
      ],
    },
    "missing message text",
  );
}

async function checkOverlongMessageText() {
  await expectInvalidChatRequestShape(
    {
      entryId: "understand-letter-or-form",
      language: "en",
      messages: [
        {
          id: "smoke-overlong-text",
          role: "user",
          text: "x".repeat(8001),
        },
      ],
    },
    "overlong message text",
  );
}

async function checkTooManyMessages() {
  await expectInvalidChatRequestShape(
    {
      entryId: "understand-letter-or-form",
      language: "en",
      messages: Array.from({ length: 25 }, (_, index) => ({
        id: `smoke-too-many-${index}`,
        role: index % 2 === 0 ? "user" : "assistant",
        text: "hello",
      })),
    },
    "too many messages",
  );
}

async function checkInvalidMessageRole() {
  await expectInvalidChatRequestShape(
    {
      entryId: "understand-letter-or-form",
      language: "en",
      messages: [
        {
          id: "smoke-invalid-role",
          role: "system",
          text: "hello",
        },
      ],
    },
    "invalid message role",
  );
}

async function checkInvalidMessageWeakCategory() {
  await expectInvalidChatRequestShape(
    {
      entryId: "understand-letter-or-form",
      language: "en",
      messages: [
        {
          id: "smoke-invalid-weak-category",
          role: "assistant",
          text: "Previously generated text.",
          weakCategory: "not-a-real-category",
        },
        {
          id: "smoke-valid-user-after-invalid-category",
          role: "user",
          text: "hello",
        },
      ],
    },
    "invalid message weakCategory",
  );
}

async function checkMissingMessageRole() {
  await expectInvalidChatRequestShape(
    {
      entryId: "understand-letter-or-form",
      language: "en",
      messages: [
        {
          id: "smoke-missing-role",
          text: "hello",
        },
      ],
    },
    "missing message role",
  );
}

async function checkBlankMessageId() {
  await expectInvalidChatRequestShape(
    {
      entryId: "understand-letter-or-form",
      language: "en",
      messages: [
        {
          id: "   ",
          role: "user",
          text: "hello",
        },
      ],
    },
    "blank message id",
  );
}

async function checkMissingMessageId() {
  await expectInvalidChatRequestShape(
    {
      entryId: "understand-letter-or-form",
      language: "en",
      messages: [
        {
          role: "user",
          text: "hello",
        },
      ],
    },
    "missing message id",
  );
}

async function checkNonObjectMessageItem() {
  await expectInvalidChatRequestShape(
    {
      entryId: "understand-letter-or-form",
      language: "en",
      messages: ["hello"],
    },
    "non-object message item",
  );
}

async function checkAssistantOnlyMessages() {
  await expectInvalidChatRequestShape(
    {
      entryId: "understand-letter-or-form",
      language: "en",
      messages: [
        {
          id: "assistant-only",
          role: "assistant",
          text: "Previously generated text.",
        },
      ],
    },
    "assistant-only messages",
  );
}

async function checkTrailingAssistantMessages() {
  await expectInvalidChatRequestShape(
    {
      entryId: "understand-letter-or-form",
      language: "en",
      messages: [
        {
          id: "leading-user",
          role: "user",
          text: "Please help.",
        },
        {
          id: "trailing-assistant",
          role: "assistant",
          text: "Previously generated text.",
        },
      ],
    },
    "trailing assistant messages",
  );
}

async function checkBlankTrailingUserAfterAssistant() {
  await expectInvalidChatRequestShape(
    {
      entryId: "understand-letter-or-form",
      language: "en",
      messages: [
        {
          id: "leading-user",
          role: "user",
          text: "Please help.",
        },
        {
          id: "middle-assistant",
          role: "assistant",
          text: "Previously generated text.",
        },
        {
          id: "blank-trailing-user",
          role: "user",
          text: "   \n",
        },
      ],
    },
    "blank trailing user after assistant",
  );
}

async function checkInvalidReportProblemEntryId() {
  const snapshot = await getReportProblemSnapshot({
    baseUrl,
    fail,
    path: "/report-problem?lang=en&entryId=not-a-real-entry",
  });

  if (snapshot.entryButton !== null) {
    fail("Invalid report-problem entryId still rendered an entry-button label.");
  }
}

async function checkInvalidFindHumanCategory() {
  const snapshot = await getReferralsSnapshot({
    baseUrl,
    fail,
    path: "/find-human?category=not-a-real-category&entryId=understand-letter-or-form&lang=en",
  });

  if (snapshot.filteredState) {
    fail("Invalid find-human category still rendered the filtered-state banner.");
  }
}

async function checkInvalidConversationEntryRoute() {
  const { html } = await fetchHtmlPage({
    baseUrl,
    expectedStatus: 404,
    fail,
    path: "/conversation/not-a-real-entry?lang=en",
  });

  if (!html.includes("404")) {
    fail("Invalid conversation route did not render the 404 page.");
  }
}

async function checkInvalidReportProblemArea() {
  const snapshot = await getReportProblemSnapshot({
    baseUrl,
    fail,
    path: "/report-problem?lang=en&area=not-real",
  });

  if (snapshot.selectedArea !== "conversation") {
    fail("Invalid report-problem area did not fall back to Conversation.");
  }
}

const health = await getHealth({
  baseUrl,
  fail,
  requireDeployConfigOk: true,
});
const healthResponse = await fetch(new URL("/healthz", baseUrl), {
  headers: {
    Accept: "application/json",
  },
});
assertBrowserSecurityHeaders(healthResponse, "/healthz");
console.log(`Health check ok (/healthz, chatMode=${health.chatMode}).`);
await checkPages();
console.log("Page checks ok (landing, conversation, referrals, support pages).");
await checkLanguagePersistence();
console.log("Language persistence ok (query -> cookie -> later request).");
await checkInvalidJsonBody();
console.log("Invalid JSON handling ok (/api/chat rejects malformed JSON bodies).");
await checkWrongChatMethod();
console.log("Wrong method handling ok (/api/chat rejects GET requests).");
await checkOversizedChatBody();
console.log("Oversized body handling ok (/api/chat rejects huge JSON before parsing).");
await checkNullJsonBody();
console.log("Null JSON handling ok (/api/chat rejects null bodies).");
await checkStringJsonBody();
console.log("String JSON handling ok (/api/chat rejects non-object JSON bodies).");
await checkInvalidChatEntryId();
console.log("Invalid entryId handling ok (/api/chat rejects bad entry ids).");
await checkInvalidChatLanguage();
console.log("Invalid language handling ok (/api/chat rejects bad language codes).");
await checkInvalidTurnstileToken();
console.log("Invalid turnstileToken handling ok (/api/chat rejects bad token shapes).");
await checkUnsafeReportProblemSource();
console.log("Unsafe source handling ok (/report-problem ignores external source links).");
await checkReportProblemDoesNotPrerenderMailto();
console.log("Report email privacy ok (/report-problem does not pre-render mailto links).");
await checkDisallowedInternalReportProblemSource();
console.log("Disallowed internal source handling ok (/report-problem ignores unsafe app paths).");
await checkMalformedInternalReportProblemSource();
console.log("Malformed internal source handling ok (/report-problem ignores protocol-style paths).");
await checkOversizedReportProblemSource();
console.log("Oversized source handling ok (/report-problem ignores huge app paths).");
await checkIncompleteConversationReportProblemSource();
console.log("Incomplete conversation source handling ok (/report-problem ignores bare conversation paths).");
await checkBlankChatMessage();
console.log("Blank message handling ok (/api/chat rejects all-whitespace messages).");
await checkEmptyMessagesArray();
console.log("Empty messages handling ok (/api/chat rejects empty arrays).");
await checkMissingMessagesArray();
console.log("Malformed messages handling ok (/api/chat rejects non-array messages).");
await checkInvalidMessageTextShape();
console.log("Malformed message text handling ok (/api/chat rejects non-string text).");
await checkMissingMessageText();
console.log("Missing message text handling ok (/api/chat rejects messages without text).");
await checkOverlongMessageText();
console.log("Message length handling ok (/api/chat rejects overlong text).");
await checkTooManyMessages();
console.log("Message count handling ok (/api/chat rejects runaway history).");
await checkInvalidMessageRole();
console.log("Malformed message role handling ok (/api/chat rejects invalid roles).");
await checkInvalidMessageWeakCategory();
console.log("Malformed message weakCategory handling ok (/api/chat rejects invalid classifier labels).");
await checkMissingMessageRole();
console.log("Missing message role handling ok (/api/chat rejects messages without roles).");
await checkBlankMessageId();
console.log("Malformed message id handling ok (/api/chat rejects blank ids).");
await checkMissingMessageId();
console.log("Missing message id handling ok (/api/chat rejects messages without ids).");
await checkNonObjectMessageItem();
console.log("Non-object message item handling ok (/api/chat rejects primitive array items).");
await checkAssistantOnlyMessages();
console.log("Assistant-only message handling ok (/api/chat requires a real user turn).");
await checkTrailingAssistantMessages();
console.log("Trailing assistant handling ok (/api/chat rejects payloads that end on assistant text).");
await checkBlankTrailingUserAfterAssistant();
console.log("Blank trailing user handling ok (/api/chat rejects payloads whose last real turn is assistant text).");
await checkInvalidReportProblemEntryId();
console.log("Invalid report entryId handling ok (/report-problem ignores bad entry ids).");
await checkInvalidFindHumanCategory();
console.log("Invalid find-human category handling ok (/find-human drops bad category filters).");
await checkInvalidConversationEntryRoute();
console.log("Invalid conversation route handling ok (/conversation returns 404 for bad entry ids).");
await checkInvalidReportProblemArea();
console.log("Invalid report area handling ok (/report-problem falls back cleanly).");

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
