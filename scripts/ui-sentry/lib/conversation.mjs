// Conversation-page helpers. Ports the sendAndAwaitReply *concept* from
// tmp/stress-test/lib.cjs, rebuilt to:
//   - use data-message-role instead of Tailwind class detection (R5)
//   - never hold a replyText variable, only counts/booleans/timings (R7)
//   - implement the R1/R2/R3/R6 send-classification state machine
import { humanType } from "./human-type.mjs";
import { classifyChatResponse, PAUSED_LABELS } from "./chat-status.mjs";
import { fetchHealthz, healthzLooksOk } from "./healthz.mjs";

const SEND_FAILURE_NOTICE_TEXT = "The response did not come through. Please try again.";

export async function gotoConversation(page, baseUrl, entryId, lang = "en") {
  await page.goto(new URL(`/conversation/${entryId}?lang=${lang}`, baseUrl).toString(), {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
  await page.waitForSelector("#conversation-input", { timeout: 15_000 });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(350);
}

export async function messageCounts(page) {
  return page.evaluate(() => ({
    user: document.querySelectorAll('article[data-message-role="user"]').length,
    assistant: document.querySelectorAll('article[data-message-role="assistant"]').length,
  }));
}

async function hasFailureNotice(page) {
  return page.evaluate((expected) => {
    const nodes = [...document.querySelectorAll('p[role="status"]')];
    return nodes.some((node) => (node.textContent ?? "").includes(expected));
  }, SEND_FAILURE_NOTICE_TEXT);
}

async function pollUntil({ timeoutMs, intervalMs, check }) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = await check();
    if (result) return result;
    if (Date.now() >= deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

// Waits for a new assistant bubble to appear with non-empty, non-placeholder
// text, returning only the wall-clock timestamp of that observation — the
// text itself is read inside page.evaluate and never returned or stored.
async function waitForFirstToken(page, beforeAssistantCount, deadlineMs) {
  const deadline = Date.now() + deadlineMs;
  for (;;) {
    const gotToken = await page.evaluate((before) => {
      const nodes = [...document.querySelectorAll('article[data-message-role="assistant"]')];
      if (nodes.length <= before) return false;
      const latest = nodes[nodes.length - 1];
      const text = latest.textContent ?? "";
      return text.length > 0 && text !== "Thinking...";
    }, beforeAssistantCount);
    if (gotToken) return Date.now();
    if (Date.now() >= deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}

async function waitForStreamDone(page, remainingMs) {
  if (remainingMs <= 0) return false;
  return page
    .waitForFunction(
      () => document.querySelector("section[aria-live]")?.getAttribute("aria-busy") === "false",
      null,
      { timeout: remainingMs },
    )
    .then(() => true)
    .catch(() => false);
}

// Runs one turn: types the fixture text, sends via Enter, classifies the
// outcome per R1/R2/R3, waits for reply completion per R6 on a pass.
// The turn cap itself is enforced upstream by installTurnBudgetGuard
// (budget-guard.mjs), which aborts any /api/chat POST past the cap at the
// request boundary (R17) — this function only observes whatever response
// (real or aborted) results.
export async function runTurn(page, { text, baseUrl, perTurnDeadlineMs = 180_000 }) {
  const before = await messageCounts(page);
  const chatResponses = [];

  const onResponse = async (response) => {
    if (!response.url().includes("/api/chat")) return;
    if (response.request().method() !== "POST") return;
    let bodyText = null;
    try {
      bodyText = await response.text();
    } catch {
      bodyText = null;
    }
    chatResponses.push({ status: response.status(), bodyText });
  };
  page.on("response", onResponse);

  const turnStartedAt = Date.now();
  try {
    await humanType(page, text);
    await page.focus("#conversation-input");
    await page.keyboard.press("Enter");

    const raced = await pollUntil({
      timeoutMs: 45_000,
      intervalMs: 200,
      check: async () => {
        if (chatResponses.length > 0) return "post";
        if (await hasFailureNotice(page)) return "notice";
        return null;
      },
    });

    if (raced === "notice" && chatResponses.length === 0) {
      return {
        label: "client_blocked",
        httpStatus: null,
        ttftMs: null,
        totalMs: Date.now() - turnStartedAt,
      };
    }

    if (raced === null) {
      return {
        label: "no_post_no_notice_timeout",
        httpStatus: null,
        ttftMs: null,
        totalMs: Date.now() - turnStartedAt,
      };
    }

    // POST fired. Confirm the user bubble landed before entering
    // reply-waiting (R1).
    await pollUntil({
      timeoutMs: 10_000,
      intervalMs: 150,
      check: async () => {
        const counts = await messageCounts(page);
        return counts.user > before.user ? true : null;
      },
    });

    const response = chatResponses[0];
    let classification = classifyChatResponse(response);

    if (PAUSED_LABELS.has(classification.label)) {
      const healthz = await fetchHealthz(baseUrl);
      classification = healthzLooksOk(healthz)
        ? { label: "paused_confirmed", pausedReason: classification.label }
        : { label: classification.label };
    }

    if (classification.label !== "pass") {
      return {
        label: classification.label,
        httpStatus: response.status,
        ttftMs: null,
        totalMs: Date.now() - turnStartedAt,
      };
    }

    const firstTokenAt = await waitForFirstToken(page, before.assistant, perTurnDeadlineMs);
    const remainingMs = perTurnDeadlineMs - (Date.now() - turnStartedAt);
    const streamDone = await waitForStreamDone(page, remainingMs);

    if (!streamDone) {
      return {
        label: "reply_timeout",
        httpStatus: response.status,
        ttftMs: firstTokenAt ? firstTokenAt - turnStartedAt : null,
        totalMs: Date.now() - turnStartedAt,
      };
    }

    return {
      label: "pass",
      httpStatus: response.status,
      ttftMs: firstTokenAt ? firstTokenAt - turnStartedAt : null,
      totalMs: Date.now() - turnStartedAt,
    };
  } finally {
    page.off("response", onResponse);
  }
}
