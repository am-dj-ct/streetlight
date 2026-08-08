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
  await context.route("**/api/usage/event", (route) =>
    route.fulfill({ status: 204, body: "" }),
  );
}

// Launches a page with console/pageerror/dialog/failed-response watchers
// armed (tier 1 structural requirement) and the perf probe init script
// installed. Returns everything the caller needs to tear down cleanly.
export async function launchPage({ browserType, contextOptions = {}, browser }) {
  const ownBrowser = browser ?? (await launchBrowser(browserType));
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

  page.on("console", (msg) => {
    if (msg.type() === "error") {
      // Truncate hard: this is a debugging aid, not a content channel. Real
      // user text never reaches console.error on this app (AGENTS.md), but
      // truncation keeps the guarantee even if that ever regressed.
      watch.consoleErrors.push(msg.text().slice(0, 200));
    }
  });
  page.on("pageerror", (err) => watch.pageErrors.push(String(err).slice(0, 200)));
  page.on("dialog", async (dialog) => {
    watch.dialogs.push(dialog.type());
    await dialog.dismiss().catch(() => {});
  });
  page.on("response", (response) => {
    if (response.url().includes("/api/") && response.status() >= 400) {
      watch.failedApiResponses.push(`${response.status()} ${new URL(response.url()).pathname}`);
    }
  });

  return { browser: ownBrowser, ownsBrowser: !browser, context, page, watch };
}

async function launchBrowser(browserType) {
  if (browserType.name() === "chromium") {
    try {
      return await browserType.launch({ channel: "chrome", headless: true });
    } catch {
      // Fall through to the pinned bundled Chromium (R11).
    }
  }
  return browserType.launch({ headless: true });
}

export async function readPerf(page) {
  return page.evaluate(() => window.__uiSentryPerf ?? { lcp: null, cls: 0 });
}

export function watchProblems(watch) {
  const problems = [];
  if (watch.pageErrors.length) problems.push(`pageErrors:${watch.pageErrors.length}`);
  if (watch.dialogs.length) problems.push(`unexpectedDialogs:${watch.dialogs.length}`);
  if (watch.failedApiResponses.length) {
    problems.push(`apiFailures:${watch.failedApiResponses.join(",")}`);
  }
  return problems;
}
