// Conversation-page helpers. Ports the sendAndAwaitReply *concept* from
// tmp/stress-test/lib.cjs, rebuilt to:
//   - use data-message-role instead of Tailwind class detection (R5)
//   - never hold a replyText variable, only counts/booleans/timings (R7)
//   - implement the R1/R2/R3/R6 send-classification state machine
import { humanType } from "./human-type.mjs";
import { classifyChatResponse, PAUSED_LABELS } from "./chat-status.mjs";
import { fetchHealthz, healthzLooksOk } from "./healthz.mjs";

const SEND_FAILURE_NOTICE_TEXT = "The response did not come through. Please try again.";

// Lets React finish hydrating before typing. On a fresh hard navigation OR
// a client-side Link click into the conversation page, keystrokes
// dispatched before hydration completes get dropped after the first few
// characters (confirmed empirically against production WebKit — this is
// exactly the race tmp/stress-test/lib.cjs's gotoConversation comment
// warns about). A real user reaches the composer well after this; the
// wait keeps programmatic typing realistic rather than racing hydration.
export async function settleAfterConversationLoad(page) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(350);
}

export async function gotoConversation(page, baseUrl, entryId, lang = "en") {
  await page.goto(new URL(`/conversation/${entryId}?lang=${lang}`, baseUrl).toString(), {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
  await page.waitForSelector("#conversation-input", { timeout: 15_000 });
  await settleAfterConversationLoad(page);
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

// Root cause this exists to fix (cross-vendor review, 2026-09-26):
// `hasFailureNotice` alone cannot tell "this turn just got blocked" apart
// from "a PRIOR turn left this exact node on screen." The failure text is
// one fixed string (`copy.sendFailure`) every time a turn is client-blocked
// — the app's own `client_blocked` branch never writes
// `lastSendFailureMessageRef`, so `setErrorMessage` is called with the
// IDENTICAL value on every consecutive blocked turn. React bails out of
// re-rendering on an unchanged primitive, so the SAME `<p role="status">`
// DOM node survives, untouched, across every consecutive blocked turn —
// not just the first repeat. A plain text/existence check therefore either
// fires instantly on turn N+1 from turn N's leftover notice (before turn
// N+1's own attempt has resolved at all — turns overlapping unfinished
// work), or, once diffed against "what was already there," never fires
// again for a genuinely repeated block, since nothing about that node ever
// changes.
//
// The submit button's `disabled` attribute doesn't have that problem: it
// is driven by `isPreparingTurnstile`, a plain boolean that cycles
// false -> true -> false on every real send attempt, blocked or not,
// completely independent of whether the eventual failure text repeats.
// The composer draft is guaranteed non-empty for the whole poll window
// here (a blocked send never clears it — `setDraft("")` only runs on the
// path that actually proceeds to fetch), and this sentry never attaches
// files, so `disabled` cannot be conflated with either of the button's
// other two disable reasons while this runs. Watching for that rising
// edge, then its falling edge, with no POST ever landing, is a per-turn
// signal that is never stale by construction.
async function isSendControlBusy(page) {
  return page.evaluate(() => {
    const input = document.getElementById("conversation-input");
    const button = input?.closest("form")?.querySelector('button[type="submit"]');
    return Boolean(button?.disabled);
  });
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
    if (gotToken) return { firstTokenAt: Date.now(), failureNoticeSeen: false };
    if (await hasFailureNotice(page)) {
      return { firstTokenAt: null, failureNoticeSeen: true };
    }
    if (Date.now() >= deadline) return { firstTokenAt: null, failureNoticeSeen: false };
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}

// Record the response as soon as Playwright exposes its headers. Awaiting
// response.text() here used to delay the array insertion until a stream
// finished (or failed), so a fixed failure notice could win the race and be
// mislabeled client_blocked even though the POST had reached the server.
export function observeChatResponse(response) {
  const observed = {
    status: response.status(),
    bodyTextPromise: Promise.resolve().then(() => response.text()).catch(() => null),
  };
  return observed;
}

export function successfulStreamLabel({ firstTokenAt, streamDone, failureNoticeSeen }) {
  if (failureNoticeSeen) return "stream_error";
  if (!firstTokenAt || !streamDone) return "reply_timeout";
  return "pass";
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

  const onResponse = (response) => {
    if (!response.url().includes("/api/chat")) return;
    if (response.request().method() !== "POST") return;
    chatResponses.push(observeChatResponse(response));
  };
  page.on("response", onResponse);

  const turnStartedAt = Date.now();
  try {
    await humanType(page, text);
    await page.focus("#conversation-input");
    await page.keyboard.press("Enter");

    // sawBusy tracks THIS turn's own rising edge of isSendControlBusy — see
    // its header for why that, not notice text, is what tells a genuinely
    // concluded (blocked) attempt apart from one still in flight. Only
    // count the falling edge as "concluded" once we've actually observed
    // it go busy first, so a poll tick landing between two turns (this
    // turn hasn't made the control busy yet) can't be misread as "already
    // finished."
    //
    // BUSY_FALL_GRACE_MS: the app clears `isPreparingTurnstile` (busy ->
    // false) BEFORE it issues the /api/chat POST on a turn that is actually
    // going through — the token resolves first, then the code that was
    // waiting on it either takes the blocked early-return or continues on
    // to fetch(). Concluding "blocked" on the very poll tick busy goes
    // false (an earlier version of this fix did exactly that) raced ahead
    // of that continuation and misclassified a real send as blocked. This
    // grace window lets a POST that is already in flight actually land
    // before giving up; `chatResponses.length > 0` is checked first on
    // every tick regardless, so a POST that arrives at any point during (or
    // after) the grace window still wins immediately.
    const BUSY_FALL_GRACE_MS = 5000;
    let sawBusy = false;
    let busyEndedAt = null;
    const raced = await pollUntil({
      timeoutMs: 45_000,
      intervalMs: 100,
      check: async () => {
        if (chatResponses.length > 0) return "post";
        if (await isSendControlBusy(page)) {
          sawBusy = true;
          busyEndedAt = null;
          return null;
        }
        if (!sawBusy) return null;
        if (busyEndedAt === null) busyEndedAt = Date.now();
        return Date.now() - busyEndedAt >= BUSY_FALL_GRACE_MS ? "notice" : null;
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
    const bodyText = response.status === 200 ? null : await response.bodyTextPromise;
    let classification = classifyChatResponse({ status: response.status, bodyText });

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

    const firstTokenResult = await waitForFirstToken(page, before.assistant, perTurnDeadlineMs);
    const firstTokenAt = firstTokenResult.firstTokenAt;
    const remainingMs = perTurnDeadlineMs - (Date.now() - turnStartedAt);
    const streamDone = firstTokenResult.failureNoticeSeen
      ? false
      : await waitForStreamDone(page, remainingMs);
    const failureNoticeSeen = firstTokenResult.failureNoticeSeen || await hasFailureNotice(page);
    const streamLabel = successfulStreamLabel({ firstTokenAt, streamDone, failureNoticeSeen });

    if (streamLabel !== "pass") {
      return {
        label: streamLabel,
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
