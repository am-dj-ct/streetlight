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
import { runCase } from "../tier1.mjs";

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

// 2026-09-27, cross-vendor review of #52 finding 1: recreatePage() alone is
// NOT sufficient. It hands the next case a genuinely fresh, but BLANK,
// page — a case written to assume a PREVIOUS case already navigated
// somewhere useful (the original tier1.mjs shape) still fails against that
// blank page, recreating a version of the same cascade with a different
// error message. The real fix is that every tier1 case now navigates to
// its own start URL and waits for its own ready selector before acting.
// These two tests use the EXACT `runCase` mechanism tier1.mjs itself uses
// (imported directly, not reimplemented) to prove that shape, both ways.
test("a case written the OLD way (assuming a previous case's page state) fails after recovery, even with the fix's own recreatePage", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const session = await makeSession(browser);
    await session.context.route(`${FIXTURE_ORIGIN}/home`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html",
        body: '<!doctype html><html><body><h1>home</h1><a href="/fast">go</a></body></html>',
      }),
    );

    const cases = [];
    const recoverPage = () => recreatePage(session, []);

    // Case N: mimics "home loads" — its own navigation hangs and times out.
    await runCase(cases, "case N (hangs)", async () => {
      await session.page.goto(`${FIXTURE_ORIGIN}/hangs`, { timeout: 500 });
    }, recoverPage);

    // Case N+1, written the OLD (pre-fix) way: it assumes case N already
    // navigated somewhere with an "a" link on it, and just acts — no
    // navigation of its own.
    await runCase(cases, "case N+1 (assumes case N's page)", async () => {
      await session.page.locator("a").click({ timeout: 2_000 });
    }, recoverPage);

    assert.equal(cases[0].status, "fail");
    assert.equal(
      cases[1].status,
      "fail",
      `a case that assumes a previous case's page state must still fail on a blank recovered page: ${JSON.stringify(cases[1])}`,
    );

    await browser.close();
  } catch (error) {
    await browser.close();
    throw error;
  }
});

test("a self-sufficient case N+1 (navigates to its own start URL first) passes after case N hangs and gets recovered", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const session = await makeSession(browser);
    await session.context.route(`${FIXTURE_ORIGIN}/home`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html",
        body: `<!doctype html><html><body><h1>home</h1><a href="${FIXTURE_ORIGIN}/fast">go</a></body></html>`,
      }),
    );

    const cases = [];
    const recoverPage = () => recreatePage(session, []);

    // Case N: mimics "home loads" — its own navigation hangs and times out.
    await runCase(cases, "case N (hangs)", async () => {
      await session.page.goto(`${FIXTURE_ORIGIN}/hangs`, { timeout: 500 });
    }, recoverPage);

    // Case N+1, SELF-SUFFICIENT (the actual 2026-09-27 fix, mirrored from
    // tier1.mjs's real case bodies): navigates to its OWN start URL and
    // waits for its OWN ready selector before acting at all. It must pass
    // even though case N — which it "needed" a page from, under the old
    // design — never got there.
    await runCase(cases, "case N+1 (self-sufficient)", async () => {
      await session.page.goto(`${FIXTURE_ORIGIN}/home`, { waitUntil: "domcontentloaded", timeout: 5_000 });
      await session.page.waitForSelector("h1", { timeout: 5_000 });
      await session.page.locator("a").click({ timeout: 5_000 });
      const heading = await session.page.evaluate(() => document.querySelector("h1")?.textContent);
      if (heading !== "fast page") throw new Error(`unexpected heading after click: ${heading}`);
    }, recoverPage);

    assert.equal(cases[0].status, "fail");
    assert.equal(
      cases[1].status,
      "pass",
      `a self-sufficient case must pass on its own, regardless of case N's outcome: ${JSON.stringify(cases[1])}`,
    );

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
