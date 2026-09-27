// Shared browser helpers. Ports the watcher/typing/settle *concepts* from
// streetlight/tmp/stress-test/lib.cjs — never its Tailwind-class role
// detection (bg-[#1f5f43]) and never its replyText capture. This package
// uses data-message-role (added to the app in this PR, R5) for every bubble
// check, and tier 2's helper returns only counts/booleans/timings (R7).

// Injected before any navigation so the LCP/CLS observers are wired up from
// the very first paint of a cold load (tier 1 performance probe). This is
// the standard PerformanceObserver technique — Playwright doesn't expose
// LCP/CLS as raw CDP metrics the way it exposes heap/node counts, so "via
// CDP" in the spec is read here as "via the browser's own performance
// instrumentation," which is what CDP-based tools use under the hood too.
const PERF_INIT_SCRIPT = `
window.__uiSentryPerf = { lcp: null, cls: 0 };
try {
  new PerformanceObserver((list) => {
    const entries = list.getEntries();
    const last = entries[entries.length - 1];
    if (last) window.__uiSentryPerf.lcp = last.startTime;
  }).observe({ type: "largest-contentful-paint", buffered: true });
} catch {}
try {
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (!entry.hadRecentInput) {
        window.__uiSentryPerf.cls += entry.value;
      }
    }
  }).observe({ type: "layout-shift", buffered: true });
} catch {}
`;

// Blocks the client-side usage-event beacon in every sentry-driven browser
// context so scheduled page visits never pollute the site's real usage
// counters (spec R16). Fulfilled with 204 rather than aborted so the page
// never logs a console/network error about it.
export async function blockUsageEvents(context) {
  await context.route("**/api/usage/event", async (route) => {
    // A route handler throwing becomes an unhandledRejection at the
    // process level, detached from any case-level try/catch — that must
    // never be able to crash the whole run. This can race a page-level
    // "**/*" route (tier 1's slow-network case) also matching the same
    // request; swallow "already handled" rather than letting it escape.
    try {
      await route.fulfill({ status: 204, body: "" });
    } catch {
      // best-effort only
    }
  });
}

// Wires the same console/pageerror/dialog/failed-response watchers onto a
// page. Split out of launchPage (2026-09-27) so recreatePage below can
// re-arm the identical watchers on a freshly created page, rather than
// duplicating this listener set.
function wireWatchers(page, watch) {
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      // Truncate hard: this is a debugging aid, not a content channel. Real
      // user text never reaches console.error on this app (AGENTS.md), but
      // truncation keeps the guarantee even if that ever regressed.
      watch.consoleErrors.push(msg.text().slice(0, 200));
    }
  });
  page.on("pageerror", (err) => {
    const text = String(err).slice(0, 200);
    // Known WebKit/Next.js App Router noise: Next speculatively prefetches
    // same-origin routes for any <Link> that scrolls into view (an RSC
    // payload fetch with a `_rsc=` query param). WebKit surfaces a failed
    // background prefetch as an uncaught "access control checks" pageerror;
    // Chromium does not. Confirmed empirically against production: the
    // actual navigation and page content are unaffected either way (this is
    // background prefetch, not the real request), so this one specific
    // pattern is not treated as a structural failure. Everything else a
    // page throws still is.
    if (/Fetch API cannot load.*_rsc=.*access control checks/.test(text)) {
      return;
    }
    watch.pageErrors.push(text);
  });
  page.on("dialog", async (dialog) => {
    watch.dialogs.push(dialog.type());
    await dialog.dismiss().catch(() => {});
  });
  page.on("response", (response) => {
    if (response.url().includes("/api/") && response.status() >= 400) {
      watch.failedApiResponses.push(`${response.status()} ${new URL(response.url()).pathname}`);
    }
  });
}

// Launches a page with console/pageerror/dialog/failed-response watchers
// armed (tier 1 structural requirement) and the perf probe init script
// installed. Returns everything the caller needs to tear down cleanly.
export async function launchPage({ browserType, contextOptions = {}, browser }) {
  const ownBrowser = browser ?? (await launchTier1Browser(browserType));
  const context = await ownBrowser.newContext(contextOptions);
  await blockUsageEvents(context);
  await context.addInitScript(PERF_INIT_SCRIPT);

  const page = await context.newPage();
  const watch = {
    consoleErrors: [],
    pageErrors: [],
    dialogs: [],
    failedApiResponses: [],
  };
  wireWatchers(page, watch);

  return { browser: ownBrowser, ownsBrowser: !browser, context, page, watch };
}

// Closes `session.page` and replaces it with a fresh one in the same
// context, re-arming the same watchers (2026-09-27 — a timed-out
// navigation in tier 1 can leave a page in a state where the NEXT case's
// own navigation throws "interrupted by another navigation" instead of
// running its own check at all; reproduced against production on an
// overloaded host, where one hung case cascaded into 17 more failures
// that were never really about anything those cases checked). Mutates
// `session.page` and `session.watch` in place and returns the new page,
// so a caller holding onto `session` sees the replacement without needing
// its own bookkeeping. `initScripts`, if given, are re-run on the fresh
// page in order — a caller with its OWN page-level addInitScript calls
// (tier1.mjs's pageshow recorder) needs to redo them here, since a new
// Page object starts with none of them. Stale watcher state from the page
// that just failed describes a browsing context that no longer exists, so
// it is cleared rather than carried forward onto the replacement.
export async function recreatePage(session, initScripts = []) {
  await session.page.close().catch(() => {});
  const page = await session.context.newPage();
  session.watch.consoleErrors.length = 0;
  session.watch.pageErrors.length = 0;
  session.watch.dialogs.length = 0;
  session.watch.failedApiResponses.length = 0;
  wireWatchers(page, session.watch);
  for (const script of initScripts) {
    await page.addInitScript(script);
  }
  session.page = page;
  return page;
}

// Tier 1 is a deterministic structural check, so it always uses the
// Playwright browser installed by this standalone package. Real Chrome is
// intentionally reserved for tier 2, where the 2026-08-08 ADR requires it
// for Turnstile behavior. Letting tier 1 prefer the independently updated
// system Chrome defeated R11's version pin and caused the 2026-08-19 false
// failure: Playwright commands stalled early in that Chrome session even
// while the expected page element was already visible, while the pinned
// WebKit pass and the rest of the production UI were healthy.
export async function launchTier1Browser(browserType) {
  return browserType.launch({ headless: true });
}

export async function readPerf(page) {
  return page.evaluate(() => window.__uiSentryPerf ?? { lcp: null, cls: 0 });
}

export function watchProblems(watch) {
  const problems = [];
  if (watch.pageErrors.length) {
    problems.push(`pageErrors(${watch.pageErrors.length}):${watch.pageErrors.slice(0, 2).join(" | ")}`);
  }
  if (watch.dialogs.length) problems.push(`unexpectedDialogs:${watch.dialogs.length}`);
  if (watch.failedApiResponses.length) {
    problems.push(`apiFailures:${watch.failedApiResponses.join(",")}`);
  }
  return problems;
}
