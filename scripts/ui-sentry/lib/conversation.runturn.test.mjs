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
    await new Promise((resolve) => setTimeout(resolve, Number(window.__nextDelayMs || 50)));
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

async function makePage(browser) {
  const page = await browser.newPage();
  await page.route(`${FIXTURE_ORIGIN}/`, (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: FIXTURE_HTML }),
  );
  await page.route(`${FIXTURE_ORIGIN}/api/chat`, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "{}" }),
  );
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
