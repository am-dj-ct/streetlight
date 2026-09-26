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

// Complementary FAST signal for the same "did THIS turn conclude blocked"
// question, for the timing case isSendControlBusy alone can miss (2nd
// cross-vendor review, 2026-09-26): if the app's Turnstile callback fires
// synchronously (reproduced with an in-memory probe against a failure
// callback — the monitor pass's OWN callback injection only ever fires
// synchronously for a GRANT, never a failure, but a real widget's
// error-callback firing that fast is not ruled out), `isPreparingTurnstile`
// can flip true -> false within a single tick, faster than any 100ms poll
// can ever observe "busy". Marks whichever `p[role="status"]` node
// currently carries the fixed send-failure text (or null if none is
// visible), so a caller can diff it against a value captured before
// sending — a genuinely NEW node appearing is unambiguous proof of a fresh
// failure, no grace window needed. It does NOT help a genuinely REPEATED
// identical-text block (the same node persists — see
// isSendControlBusy's header for why), which is exactly why this
// supplements the busy-cycle check below rather than replacing it.
async function currentFailureNoticeMarker(page) {
  return page.evaluate((expected) => {
    const nodes = [...document.querySelectorAll('p[role="status"]')].filter((node) =>
      (node.textContent ?? "").includes(expected),
    );
    if (nodes.length === 0) return null;
    const node = nodes[0];
    if (!node.dataset.uiSentryNoticeId) {
      window.__uiSentryNoticeCounter = (window.__uiSentryNoticeCounter ?? 0) + 1;
      node.dataset.uiSentryNoticeId = String(window.__uiSentryNoticeCounter);
    }
    return node.dataset.uiSentryNoticeId;
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

const TURN_POLL_TIMEOUT_MS = 45_000;
// The app clears `isPreparingTurnstile` (busy -> false) BEFORE it issues
// the /api/chat POST on a turn that is actually going through — the token
// resolves first, then the code that was waiting on it either takes the
// blocked early-return or continues on to fetch(). Concluding "blocked" on
// the very poll tick busy goes false (an earlier version of this fix did
// exactly that) raced ahead of that continuation and misclassified a real
// send as blocked. This grace window lets a POST that is already in flight
// actually land before giving up; the matched-request check (see runTurn)
// runs first on every tick regardless, so a POST that arrives at any point
// during (or after) the grace window still wins immediately.
const BUSY_FALL_GRACE_MS = 5000;

// Runs one turn: types the fixture text, sends via Enter, classifies the
// outcome per R1/R2/R3, waits for reply completion per R6 on a pass.
// The turn cap itself is enforced upstream by installTurnBudgetGuard
// (budget-guard.mjs), which aborts any /api/chat POST past the cap at the
// request boundary (R17) — this function only observes whatever response
// (real or aborted) results.
//
// Root cause fixed here (2nd cross-vendor review, 2026-09-26): the
// previous version listened for ANY `page.on("response")` matching
// /api/chat, with no notion of which SUBMISSION it answered. A response
// whose headers arrive after this turn's own 45s poll gave up — but before
// the NEXT turn's fresh listener was attached, or overlapping with it —
// could be credited to the wrong turn; an in-memory probe reproduced it.
// Fixed by capturing the specific Request object for THIS turn via
// page.waitForRequest, set up BEFORE Enter is pressed, and following ONLY
// that request's own .response() — a page-wide event stream is never
// consulted at all, so cross-turn misattribution is impossible by
// construction, not just unlikely.
export async function runTurn(page, { text, baseUrl, perTurnDeadlineMs = 180_000 }) {
  const before = await messageCounts(page);
  const beforeNoticeMarker = await currentFailureNoticeMarker(page);
  const turnStartedAt = Date.now();

  // Set up before Enter is pressed so it can never race the send itself.
  // Bounded to the same window this turn's own polling uses below; the
  // `.catch(() => null)` means a timeout here reads as "no request showed
  // up," never as an unhandled rejection.
  let matchedRequest = null;
  const requestWatch = page
    .waitForRequest(
      (request) => request.url().includes("/api/chat") && request.method() === "POST",
      { timeout: TURN_POLL_TIMEOUT_MS },
    )
    .then((request) => {
      matchedRequest = request;
      return request;
    })
    .catch(() => null);

  try {
    await humanType(page, text);
    await page.focus("#conversation-input");
    await page.keyboard.press("Enter");

    // Races three signals every 100ms: this turn's own request landing
    // (checked first, always wins — ground truth beats any inference), a
    // genuinely NEW failure notice appearing (fast path for a first-ever or
    // synchronously-resolved block — see currentFailureNoticeMarker's
    // header), and the busy-control rising/falling edge with its grace
    // window (the reliable path for a genuinely REPEATED identical-text
    // block, which the marker check alone cannot see). sawBusy/busyEndedAt
    // are scoped to this call, never carried across turns.
    let sawBusy = false;
    let busyEndedAt = null;
    const deadline = Date.now() + TURN_POLL_TIMEOUT_MS;
    for (;;) {
      if (matchedRequest) break;

      const marker = await currentFailureNoticeMarker(page);
      if (marker !== null && marker !== beforeNoticeMarker) break;

      if (await isSendControlBusy(page)) {
        sawBusy = true;
        busyEndedAt = null;
      } else if (sawBusy) {
        if (busyEndedAt === null) busyEndedAt = Date.now();
        if (Date.now() - busyEndedAt >= BUSY_FALL_GRACE_MS) break;
      }

      if (Date.now() >= deadline) {
        // Only wait out requestWatch's own remaining timeout HERE, where
        // we are already at (or past) the full poll ceiling anyway — a
        // blanket `await requestWatch` after every kind of break, including
        // the fast marker path and the busy-grace path above, would
        // silently re-impose the full 45s wait on paths whose entire point
        // is resolving well before that. requestWatch's own `.catch(() =>
        // null)` (set at creation, above) means never awaiting it further
        // in the fast-path cases is still safe: this closure's
        // `matchedRequest` is local to THIS call and cannot leak into the
        // next turn's own separate closure even if this promise settles
        // later, in the background, after this function has returned.
        await requestWatch;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    if (!matchedRequest) {
      return {
        label: "client_blocked",
        httpStatus: null,
        ttftMs: null,
        totalMs: Date.now() - turnStartedAt,
      };
    }

    // A real request exists — ground truth always wins over a provisional
    // blocked read from the loop above, even if both became true in the
    // same tick.
    const response = await matchedRequest.response();
    if (!response) {
      // The request fired but never got a response at all (aborted by the
      // turn-budget guard past the cap, or a genuine network failure) —
      // distinct from client_blocked, which means no request ever left the
      // browser.
      return {
        label: "no_response",
        httpStatus: null,
        ttftMs: null,
        totalMs: Date.now() - turnStartedAt,
      };
    }

    // Confirm the user bubble landed before entering reply-waiting (R1).
    await pollUntil({
      timeoutMs: 10_000,
      intervalMs: 150,
      check: async () => {
        const counts = await messageCounts(page);
        return counts.user > before.user ? true : null;
      },
    });

    const observed = observeChatResponse(response);
    const bodyText = observed.status === 200 ? null : await observed.bodyTextPromise;
    let classification = classifyChatResponse({ status: observed.status, bodyText });

    if (PAUSED_LABELS.has(classification.label)) {
      const healthz = await fetchHealthz(baseUrl);
      classification = healthzLooksOk(healthz)
        ? { label: "paused_confirmed", pausedReason: classification.label }
        : { label: classification.label };
    }

    if (classification.label !== "pass") {
      return {
        label: classification.label,
        httpStatus: observed.status,
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
        httpStatus: observed.status,
        ttftMs: firstTokenAt ? firstTokenAt - turnStartedAt : null,
        totalMs: Date.now() - turnStartedAt,
      };
    }

    return {
      label: "pass",
      httpStatus: observed.status,
      ttftMs: firstTokenAt ? firstTokenAt - turnStartedAt : null,
      totalMs: Date.now() - turnStartedAt,
    };
  } finally {
    // Best-effort: if the request/response promises above are somehow
    // still unsettled (e.g. an unexpected throw before the awaits ran),
    // never let this call leave a dangling rejection behind for the next
    // turn to inherit.
    requestWatch.catch(() => {});
  }
}
