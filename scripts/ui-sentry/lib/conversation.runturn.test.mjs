// Covers runTurn's blocked-vs-sent classification (lib/conversation.mjs),
// specifically the race a cross-vendor review found 2026-09-26: the app
// re-renders its send-failure notice from a plain useState with one FIXED
// string, so two client-blocked turns in a row call setErrorMessage with
// the IDENTICAL value — React bails out of re-rendering, and the SAME
// `<p role="status">` DOM node survives untouched from turn N into turn
// N+1. A plain "does a notice exist" check therefore either fires
// instantly on turn N+1 from turn N's leftover node (before turn N+1's own
// attempt has resolved at all), or, once diffed against "what was already
// there," never fires again for a genuinely repeated block.
//
// This uses a real headless browser against a tiny static fixture — not a
// hand-rolled fake Page — so the classification logic runs against real
// DOM timing/mutation behavior, not an approximation of it. No network
// call, no model spend: fetch("/api/chat") is intercepted locally.
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import test from "node:test";
import { runTurn } from "./conversation.mjs";

const SEND_FAILURE_NOTICE_TEXT = "The response did not come through. Please try again.";

// Deliberately mirrors the real app's relevant mechanics only:
//   - a submit control that goes disabled/enabled around each attempt
//     (isSendControlBusy's rising/falling edge, standing in for
//     isPreparingTurnstile)
//   - a notice node that is only ever CREATED once and left alone on every
//     subsequent identical-text failure (React's setState bailout)
//   - a clean clear-then-send path when the attempt is not blocked
// window.__nextBlocked / window.__nextDelayMs steer each submit from the
// test, exactly like flipping Turnstile's real outcome turn to turn.
const FIXTURE_HTML = `<!doctype html>
<html><body>
<form id="composer-form">
  <textarea id="conversation-input"></textarea>
  <button type="submit">send</button>
</form>
<section aria-live="polite" aria-busy="false" id="messages"></section>
<div id="status-region"></div>
<script>
  let currentNotice = null;
  const form = document.getElementById("composer-form");
  const input = document.getElementById("conversation-input");
  const button = form.querySelector('button[type="submit"]');
  const messages = document.getElementById("messages");

  input.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    form.requestSubmit();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const text = input.value;
    input.value = "";
    button.disabled = true;
    // window.__nextDelayMs === 0 must mean a truly synchronous toggle (no
    // gap at all between button.disabled = true and = false) — "|| 50"
    // does not do that: 0 is falsy in JS, so it silently became 50ms,
    // which is why an earlier version of this fixture could not actually
    // reproduce a genuinely synchronous transition despite claiming to
    // (3rd cross-vendor review, 2026-09-26 — this is exactly the gap that
    // let the repeated+synchronous case go untested and unnoticed).
    const delayMs = window.__nextDelayMs === undefined ? 50 : Number(window.__nextDelayMs);
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    const blocked = window.__nextBlocked === true;
    button.disabled = false;

    if (blocked) {
      if (!currentNotice) {
        currentNotice = document.createElement("p");
        currentNotice.setAttribute("role", "status");
        currentNotice.textContent = ${JSON.stringify(SEND_FAILURE_NOTICE_TEXT)};
        document.getElementById("status-region").appendChild(currentNotice);
      }
      return;
    }

    if (currentNotice) {
      currentNotice.remove();
      currentNotice = null;
    }
    // Mirrors the real conversation page's <section aria-live aria-busy>
    // streaming contract that waitForStreamDone (conversation.mjs) polls.
    messages.setAttribute("aria-busy", "true");
    const user = document.createElement("article");
    user.setAttribute("data-message-role", "user");
    user.textContent = text;
    messages.appendChild(user);

    const response = await fetch("/api/chat", { method: "POST" });
    await response.text();

    const assistant = document.createElement("article");
    assistant.setAttribute("data-message-role", "assistant");
    assistant.textContent = "assistant reply";
    messages.appendChild(assistant);
    messages.setAttribute("aria-busy", "false");
  });
</script>
</body></html>`;

// A real origin, not page.setContent()'s "about:blank", so the fixture's
// relative fetch("/api/chat") resolves predictably and actually matches the
// /api/chat route below — setContent() left the page with no proper base
// to resolve a relative URL against, so the fetch (and therefore the
// "post" detection) never fired at all.
const FIXTURE_ORIGIN = "https://ui-sentry-fixture.test";

// `responseDelaysMs` is a Node-side FIFO queue (not page state): each real
// /api/chat request pops the next configured delay (default 0) before the
// route fulfills, letting a test control exactly how slow ONE specific
// turn's own response is without touching the page's own timing at all.
// `hangRequests` is a parallel FIFO queue of booleans: a `true` entry
// leaves that specific /api/chat request's route handler pending forever
// (never calling fulfill/continue/abort) — a real stalled-server hang,
// used to prove runTurn's response-wait bound (3rd cross-vendor review,
// 2026-09-26) actually terminates instead of waiting it out.
async function makePage(browser, { responseDelaysMs = [], hangRequests = [] } = {}) {
  const page = await browser.newPage();
  const delays = [...responseDelaysMs];
  const hangs = [...hangRequests];
  await page.route(`${FIXTURE_ORIGIN}/`, (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: FIXTURE_HTML }),
  );
  await page.route(`${FIXTURE_ORIGIN}/api/chat`, async (route) => {
    if (hangs.length > 0 && hangs.shift()) {
      return; // deliberately never resolved — simulates a genuine server hang
    }
    const delay = delays.length > 0 ? delays.shift() : 0;
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  await page.goto(`${FIXTURE_ORIGIN}/`);
  return page;
}

test("a turn that actually sends is not misclassified as blocked by a PRIOR turn's leftover notice", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await makePage(browser);

    await page.evaluate(() => {
      window.__nextBlocked = true;
      window.__nextDelayMs = 50;
    });
    const turn1 = await runTurn(page, { text: "turn one", baseUrl: FIXTURE_ORIGIN });
    assert.equal(turn1.label, "client_blocked");

    await page.evaluate(() => {
      window.__nextBlocked = false;
      window.__nextDelayMs = 50;
    });
    const turn2 = await runTurn(page, { text: "turn two", baseUrl: FIXTURE_ORIGIN });
    assert.equal(turn2.label, "pass", "turn 2 actually sent and must not read as blocked from turn 1's stale notice");

    await browser.close();
  } catch (error) {
    await browser.close();
    throw error;
  }
});

// 2nd cross-vendor review (2026-09-26), finding 1: the previous fix still
// tracked ANY page-wide `response` event matching /api/chat, with no
// notion of which submission it answered — a response arriving late (after
// this turn's own window) could be credited to the next turn's fresh
// listener. Fixed by binding to this turn's own Request object
// (page.waitForRequest, set up before Enter) and awaiting ITS OWN
// .response(); nothing page-wide is ever consulted. This proves the fix
// end to end: turn 1's own response is deliberately slow (arrives well
// after a real user would expect a fast one), and turn 2 immediately
// after it must still get ITS OWN fast response correctly — not something
// left over from turn 1's timing.
test("a turn whose own response is slow is still matched correctly, and does not affect the next turn's own (fast) response", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await makePage(browser, { responseDelaysMs: [1500, 0] });

    await page.evaluate(() => {
      window.__nextBlocked = false;
      window.__nextDelayMs = 50;
    });
    const turn1StartedAt = Date.now();
    const turn1 = await runTurn(page, { text: "turn one", baseUrl: FIXTURE_ORIGIN });
    const turn1ElapsedMs = Date.now() - turn1StartedAt;
    assert.equal(turn1.label, "pass", "turn 1's own (slow) response must still be matched to turn 1");
    assert.ok(turn1ElapsedMs >= 1500, `turn 1 resolved in ${turn1ElapsedMs}ms — should have waited out its own 1500ms response delay`);

    await page.evaluate(() => {
      window.__nextBlocked = false;
      window.__nextDelayMs = 50;
    });
    const turn2 = await runTurn(page, { text: "turn two", baseUrl: FIXTURE_ORIGIN });
    assert.equal(turn2.label, "pass", "turn 2 must get its own fast response, unaffected by turn 1's slower one");

    await browser.close();
  } catch (error) {
    await browser.close();
    throw error;
  }
});

// 2nd cross-vendor review, finding 1's second timing case: a Turnstile
// callback that resolves SYNCHRONOUSLY can flip isPreparingTurnstile
// true -> false within a single tick, faster than any 100ms poll can ever
// observe "busy" — the busy-cycle signal alone would then never fire, and
// this turn would silently ride out the full 45s poll ceiling as a false
// timeout instead of a fast, correct "blocked". delayMs: 0 reproduces
// that: the fixture's own busy toggle happens inside one JS task, with
// nothing to observe at 100ms granularity. The notice-marker fast path
// (currentFailureNoticeMarker) is what has to catch this instead.
test("a synchronously-resolved block (busy toggles faster than any poll could see) is still classified as blocked quickly via the notice marker, not a 45s false timeout", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await makePage(browser);

    await page.evaluate(() => {
      window.__nextBlocked = true;
      window.__nextDelayMs = 0;
    });
    const startedAt = Date.now();
    const turn1 = await runTurn(page, { text: "turn one", baseUrl: FIXTURE_ORIGIN });
    const elapsedMs = Date.now() - startedAt;

    assert.equal(turn1.label, "client_blocked", "a synchronous block must still read as blocked");
    assert.ok(
      elapsedMs < 5000,
      `turn 1 took ${elapsedMs}ms — a synchronous block should resolve via the notice-marker fast path almost immediately, not wait out any grace window or the 45s ceiling`,
    );

    await browser.close();
  } catch (error) {
    await browser.close();
    throw error;
  }
});

test("a genuinely repeated block (identical notice text) is still classified as blocked, quickly — not a false pass and not a 45s timeout", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await makePage(browser);

    await page.evaluate(() => {
      window.__nextBlocked = true;
      window.__nextDelayMs = 50;
    });
    const turn1 = await runTurn(page, { text: "turn one", baseUrl: FIXTURE_ORIGIN });
    assert.equal(turn1.label, "client_blocked");

    const startedAt = Date.now();
    await page.evaluate(() => {
      window.__nextBlocked = true;
      window.__nextDelayMs = 50;
    });
    const turn2 = await runTurn(page, { text: "turn two", baseUrl: FIXTURE_ORIGIN });
    const elapsedMs = Date.now() - startedAt;

    assert.equal(turn2.label, "client_blocked", "a real repeated block must still read as blocked, not fall through to a timeout label");
    // Bounded by BUSY_FALL_GRACE_MS (conversation.mjs), not the 45s poll
    // ceiling: the grace window exists specifically so a real send has time
    // to land after the busy control clears, so a genuine block still takes
    // that same ~5s to confirm — just nowhere near 45s.
    assert.ok(
      elapsedMs < 8000,
      `turn 2 took ${elapsedMs}ms — should resolve via the busy-cycle grace window (~5s), not the 45s poll ceiling`,
    );

    await browser.close();
  } catch (error) {
    await browser.close();
    throw error;
  }
});

// 3rd cross-vendor review, 2026-09-26: a repeated block (same fixed notice
// text, so the marker never changes) that ALSO toggles busy synchronously
// (no gap at all between disabled=true and disabled=false — delayMs: 0,
// now genuinely zero after the fixture's own falsy-zero fix above) hits
// neither the marker fast path NOR a live-observed busy edge, and used to
// ride out the full 45s poll ceiling. The in-page MutationObserver
// (busyFallCount in conversation.mjs) is what has to catch this: it runs
// inside the page and is guaranteed to see the mutation regardless of
// polling cadence from outside it.
test("a repeated block that ALSO resolves synchronously is still classified as blocked quickly, not the 45s poll ceiling", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await makePage(browser);

    await page.evaluate(() => {
      window.__nextBlocked = true;
      window.__nextDelayMs = 0;
    });
    const turn1 = await runTurn(page, { text: "turn one", baseUrl: FIXTURE_ORIGIN });
    assert.equal(turn1.label, "client_blocked");

    const startedAt = Date.now();
    await page.evaluate(() => {
      window.__nextBlocked = true;
      window.__nextDelayMs = 0;
    });
    const turn2 = await runTurn(page, { text: "turn two", baseUrl: FIXTURE_ORIGIN });
    const elapsedMs = Date.now() - startedAt;

    assert.equal(
      turn2.label,
      "client_blocked",
      "a repeated, synchronous block must still read as blocked, not fall through to a 45s timeout label",
    );
    assert.ok(
      elapsedMs < 8000,
      `turn 2 took ${elapsedMs}ms — should resolve via the in-page busy-fall observer (~5s grace), not the 45s poll ceiling`,
    );

    await browser.close();
  } catch (error) {
    await browser.close();
    throw error;
  }
});

// 3rd cross-vendor review, finding 1: matchedRequest.response() used to be
// awaited with no deadline of its own — a stalled server (a request that
// matches, so it is never client_blocked, but whose response never
// arrives at all) hung the turn indefinitely, past its own configured
// deadline, blocking completion and reporting outright. A short
// perTurnDeadlineMs keeps this test itself fast while still proving the
// bound is real and finite, not just "large."
test("a request that matches but whose response never arrives times out on the turn's own deadline, not indefinitely", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await makePage(browser, { hangRequests: [true] });

    await page.evaluate(() => {
      window.__nextBlocked = false;
      window.__nextDelayMs = 0;
    });
    const startedAt = Date.now();
    const turn1 = await runTurn(page, {
      text: "turn one",
      baseUrl: FIXTURE_ORIGIN,
      perTurnDeadlineMs: 1500,
    });
    const elapsedMs = Date.now() - startedAt;

    assert.equal(turn1.label, "response_timeout", "a matched request with no response must report a distinct timeout label, not hang or misreport");
    assert.ok(
      elapsedMs < 5000,
      `turn took ${elapsedMs}ms — must terminate on perTurnDeadlineMs (1500ms), not wait indefinitely for a response that will never arrive`,
    );

    await browser.close();
  } catch (error) {
    await browser.close();
    throw error;
  }
});
