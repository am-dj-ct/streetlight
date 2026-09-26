// Covers ensurePageIdleBeforeNextTurn/isPageStreaming (lib/conversation.mjs),
// finding 4 of the 4th cross-vendor review (2026-09-26) — likely THE
// explanation for a live run that only ever made 3 POSTs across 6
// attempted turns. A non-"pass" turn (most notably response_timeout) can
// leave the page still streaming a reply this run gave up polling for;
// conversation-client.tsx queues a submit instead of sending it while
// isStreaming is true (confirmed by reading the component), so advancing
// straight onto a still-streaming page risks the next turn's prompt never
// becoming a request at all. This uses a real headless browser against a
// tiny static fixture, not a hand-rolled fake Page, so aria-busy timing
// behaves like real DOM state.
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import test from "node:test";
import { ensurePageIdleBeforeNextTurn, isPageStreaming } from "./conversation.mjs";

// window.__testLoadId gets a FRESH random value on every real document
// load (a reload creates a fresh JS context, re-running this script) — a
// value captured before a call, still matching after it, proves the page
// was NOT reloaded; a different value proves it WAS.
const FIXTURE_HTML = `<!doctype html>
<html><body>
<form id="composer-form">
  <textarea id="conversation-input"></textarea>
  <button type="submit">send</button>
</form>
<section aria-live="polite" aria-busy="false" id="messages"></section>
<script>
  window.__testLoadId = Math.random().toString(36).slice(2);
  window.__setStreaming = (value) => {
    document.getElementById("messages").setAttribute("aria-busy", value ? "true" : "false");
  };
</script>
</body></html>`;

const FIXTURE_ORIGIN = "https://ui-sentry-idle-fixture.test";

async function makePage(browser) {
  const page = await browser.newPage();
  await page.route(`${FIXTURE_ORIGIN}/**`, (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: FIXTURE_HTML }),
  );
  await page.goto(`${FIXTURE_ORIGIN}/conversation/fixture-entry?lang=en`);
  await page.waitForSelector("#conversation-input", { timeout: 5_000 });
  return page;
}

test("isPageStreaming reflects the messages section's aria-busy attribute directly", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await makePage(browser);
    assert.equal(await isPageStreaming(page), false);
    await page.evaluate(() => window.__setStreaming(true));
    assert.equal(await isPageStreaming(page), true);
    await page.evaluate(() => window.__setStreaming(false));
    assert.equal(await isPageStreaming(page), false);
    await browser.close();
  } catch (error) {
    await browser.close();
    throw error;
  }
});

test("a page that is not streaming is reported idle immediately, with no reload", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await makePage(browser);
    const loadIdBefore = await page.evaluate(() => window.__testLoadId);
    const result = await ensurePageIdleBeforeNextTurn(page, {
      baseUrl: FIXTURE_ORIGIN,
      entryId: "fixture-entry",
      maxWaitMs: 500,
    });
    assert.deepEqual(result, { streamingInProgress: false, reloaded: false });
    assert.equal(await page.evaluate(() => window.__testLoadId), loadIdBefore, "must not have reloaded a page that was never streaming");
    await browser.close();
  } catch (error) {
    await browser.close();
    throw error;
  }
});

test("a page still streaming that settles within the wait window reports streamingInProgress without reloading", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await makePage(browser);
    const loadIdBefore = await page.evaluate(() => window.__testLoadId);
    await page.evaluate(() => window.__setStreaming(true));
    setTimeout(() => {
      page.evaluate(() => window.__setStreaming(false)).catch(() => {});
    }, 200);

    const result = await ensurePageIdleBeforeNextTurn(page, {
      baseUrl: FIXTURE_ORIGIN,
      entryId: "fixture-entry",
      maxWaitMs: 5_000,
    });
    assert.deepEqual(result, { streamingInProgress: true, reloaded: false });
    assert.equal(await page.evaluate(() => window.__testLoadId), loadIdBefore, "settling on its own must not require a reload");
    await browser.close();
  } catch (error) {
    await browser.close();
    throw error;
  }
});

test("a page still streaming after the wait window is reloaded to force a known-idle state", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await makePage(browser);
    const loadIdBefore = await page.evaluate(() => window.__testLoadId);
    await page.evaluate(() => window.__setStreaming(true));
    // Never settles on its own within the test's short window — the
    // fixture has no timer to clear it, unlike the previous test.

    const result = await ensurePageIdleBeforeNextTurn(page, {
      baseUrl: FIXTURE_ORIGIN,
      entryId: "fixture-entry",
      maxWaitMs: 300,
    });
    assert.deepEqual(result, { streamingInProgress: true, reloaded: true });
    const loadIdAfter = await page.evaluate(() => window.__testLoadId);
    assert.notEqual(loadIdAfter, loadIdBefore, "a different load id proves a real reload happened, not just a claim of one");
    assert.equal(await isPageStreaming(page), false, "the reloaded page must not still claim to be streaming");
    await browser.close();
  } catch (error) {
    await browser.close();
    throw error;
  }
});
