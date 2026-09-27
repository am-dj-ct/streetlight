// Covers recreatePage (lib/browser.mjs), 2026-09-27: on an overloaded
// host, a tier 1 case's navigation timed out mid-flight, and EVERY later
// case in that engine's run then failed too — cascading fabricated
// failures ("Navigation to X is interrupted by another navigation to
// <the previous case's URL>"), not 17 independent findings. Reproduced
// here with a real headless browser and a route that never resolves (a
// genuinely stalled request, not merely a slow one): a first navigation
// times out while the underlying request is still pending, and the very
// next case's own action — clicking a link, the way several real tier 1
// cases navigate — gets stuck waiting on THAT stale navigation instead of
// running its own check at all. Recreating the page after the failure —
// the fix — lets the next case run cleanly instead.
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import test from "node:test";
import { launchPage, recreatePage } from "./browser.mjs";

const FIXTURE_ORIGIN = "https://ui-sentry-recreate-fixture.test";

async function makeSession(browser) {
  const session = await launchPage({ browserType: chromium, browser });
  await session.context.route(`${FIXTURE_ORIGIN}/hangs`, () => {
    // Deliberately never calls fulfill/continue/abort — the request
    // stays pending forever, a real stalled-navigation reproduction.
  });
  await session.context.route(`${FIXTURE_ORIGIN}/fast`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<!doctype html><html><body><h1>fast page</h1><a href=\"/fast\">go</a></body></html>",
    }),
  );
  return session;
}

test("without recovery, a hung navigation poisons the very next case's own action", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const session = await makeSession(browser);
    // A real committed navigation first (matching every real tier 1 case,
    // which always starts from an already-loaded page, never a blank
    // one) — this is what makes the frame's own "still navigating"
    // tracking meaningful for the next check below.
    await session.page.goto(`${FIXTURE_ORIGIN}/fast`);

    const hungGoto = session.page.goto(`${FIXTURE_ORIGIN}/hangs`, { timeout: 500 }).catch((error) => error);
    await new Promise((resolve) => setTimeout(resolve, 100));

    // The next case's own action — a link click, exactly how several
    // real tier 1 cases navigate — never gets to run its own check: it
    // is stuck waiting on the PREVIOUS case's still-pending navigation.
    const nextCaseError = await session.page
      .locator("a")
      .click({ timeout: 2_000 })
      .then(() => null)
      .catch((error) => error);
    const hungResult = await hungGoto;

    assert.ok(hungResult instanceof Error, "the first, genuinely hung navigation must have failed on its own timeout");
    assert.ok(nextCaseError, "the unrecovered page must fail the very next case's own action too");
    assert.match(
      String(nextCaseError.message),
      /waiting for ".*\/hangs" navigation to finish/,
      "the next case's own action is blocked by the PREVIOUS case's stale navigation, not running its own check at all",
    );
    await browser.close();
  } catch (error) {
    await browser.close();
    throw error;
  }
});

// NOTE on why this test uses setContent(), not goto(), to load the "next
// case"'s content after recovery: an EXPLICIT goto() call — to ANY page,
// recreated or not — starts a brand-new navigation intent that cancels
// and supersedes whatever the frame was doing before. That means a test
// which calls recreatePage() and then immediately goto()s somewhere would
// pass even if recreatePage() were a complete no-op, because the goto()
// itself, not the recreation, is what cleared the stale navigation.
// (Caught in review: an earlier version of this file did exactly that,
// and it kept passing when recreatePage() was temporarily reduced to
// `return session.page`.) setContent() does not carry that same
// navigation-intent reset, so it stays a fair probe of whether THIS page
// — the one recreatePage() actually handed back — still carries the
// previous page's stale, still-pending navigation.
test("recreatePage frees the very next case's own action from the previous case's stale navigation", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const session = await makeSession(browser);
    await session.page.goto(`${FIXTURE_ORIGIN}/fast`);
    const hungGoto = session.page.goto(`${FIXTURE_ORIGIN}/hangs`, { timeout: 500 }).catch((error) => error);
    await new Promise((resolve) => setTimeout(resolve, 100));
    await hungGoto;

    await recreatePage(session, []);

    const startedAt = Date.now();
    await session.page.setContent(
      `<!doctype html><html><body><h1>fresh</h1><a href="${FIXTURE_ORIGIN}/fast">go</a></body></html>`,
      { waitUntil: "domcontentloaded", timeout: 5_000 },
    );
    // The same kind of action (a link click) that got stuck on the stale
    // navigation in the unrecovered reproduction above now runs cleanly.
    await session.page.locator("a").click({ timeout: 5_000 });
    const elapsedMs = Date.now() - startedAt;

    assert.equal(
      await session.page.evaluate(() => document.querySelector("h1")?.textContent),
      "fast page",
      "the click's own navigation must actually land, not merely resolve",
    );
    assert.ok(
      elapsedMs < 4_000,
      `a recovered page's next action must not be waiting behind the previous case's stale navigation (took ${elapsedMs}ms)`,
    );

    await browser.close();
  } catch (error) {
    await browser.close();
    throw error;
  }
});

test("recreatePage clears stale watcher state and re-arms the same watchers on the new page", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const session = await makeSession(browser);
    session.watch.consoleErrors.push("stale error from the page that just failed");
    session.watch.pageErrors.push("stale page error");

    const oldPage = session.page;
    const newPage = await recreatePage(session, []);
    assert.notEqual(newPage, oldPage);
    assert.equal(session.page, newPage);
    assert.deepEqual(session.watch.consoleErrors, []);
    assert.deepEqual(session.watch.pageErrors, []);

    // The re-armed watcher on the NEW page still actually works.
    await newPage.evaluate(() => console.error("fresh error on the new page"));
    await newPage.waitForTimeout(50);
    assert.deepEqual(session.watch.consoleErrors, ["fresh error on the new page"]);

    await browser.close();
  } catch (error) {
    await browser.close();
    throw error;
  }
});

test("recreatePage re-runs the given init scripts on the fresh page", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const session = await makeSession(browser);
    await recreatePage(session, [
      () => {
        window.__testInitScriptRan = true;
      },
    ]);
    await session.page.goto(`${FIXTURE_ORIGIN}/fast`);
    assert.equal(await session.page.evaluate(() => window.__testInitScriptRan), true);
    await browser.close();
  } catch (error) {
    await browser.close();
    throw error;
  }
});
