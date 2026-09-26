// Tier 1 — structural, no model spend, MUST PASS (red on any failure).
// Chat is never called anywhere in this tier. Runs once per engine
// (chromium desktop, webkit mobile) — see orchestrator.mjs.
import AxeBuilder from "@axe-core/playwright";
import { launchPage, readPerf, watchProblems } from "./lib/browser.mjs";
import { humanType, settleComposer } from "./lib/human-type.mjs";
import { gotoConversation, settleAfterConversationLoad } from "./lib/conversation.mjs";
import { LOCALE_HEADING_MARKERS } from "./fixtures/locale-markers.mjs";

const AXE_SERIOUS_OR_CRITICAL = new Set(["serious", "critical"]);

async function runCase(cases, name, fn) {
  const startedAt = Date.now();
  try {
    const detail = await fn();
    cases.push({ name, status: "pass", durationMs: Date.now() - startedAt, ...detail });
  } catch (error) {
    cases.push({
      name,
      status: "fail",
      durationMs: Date.now() - startedAt,
      error: String(error?.message ?? error).slice(0, 300),
    });
  }
}

// Checks and CONSUMES the watcher arrays — a problem attributed to one case
// must not keep failing every later case for the rest of the session.
async function assertNoApiFailures(watch) {
  const problems = watchProblems(watch);
  watch.consoleErrors.length = 0;
  watch.pageErrors.length = 0;
  watch.dialogs.length = 0;
  watch.failedApiResponses.length = 0;
  if (problems.length > 0) {
    throw new Error(`watcher problems: ${problems.join("; ")}`);
  }
}

async function axeScan(page, pageName, warnings) {
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter((v) => AXE_SERIOUS_OR_CRITICAL.has(v.impact ?? ""));
  const minor = results.violations.filter((v) => !AXE_SERIOUS_OR_CRITICAL.has(v.impact ?? ""));
  if (minor.length > 0) {
    warnings.push(`axe(${pageName}): ${minor.length} non-serious violation(s) — ${minor.map((v) => v.id).join(",")}`);
  }
  if (serious.length > 0) {
    throw new Error(
      `axe(${pageName}): ${serious.length} serious/critical violation(s) — ${serious.map((v) => v.id).join(",")}`,
    );
  }
  return { violations: serious.length, warnings: minor.length };
}

export async function runTier1({ baseUrl, browserType, deviceOptions, engineName, isMobile, logger }) {
  const cases = [];
  const warnings = [];
  let perf = { lcp: null, cls: 0 };

  const session = await launchPage({ browserType, contextOptions: deviceOptions });
  const { page, watch } = session;

  // Records every `pageshow` event's own `persisted` flag (4th
  // cross-vendor review, 2026-09-26) — the back-navigation case below needs
  // to know for CERTAIN whether a given goBack() was actually served from
  // the browser's back-forward cache, and Navigation Timing's
  // `type === "back_forward"` (an earlier version of this fix used that)
  // is NOT that proof: the spec defines back_forward as ANY history
  // traversal, including one the browser did NOT restore from cache — an
  // ordinary reload-shaped navigation reached via history back still
  // reports back_forward. `pageshow`'s `persisted` boolean is the actual,
  // documented signal for "this is a live JS context that was frozen and
  // resumed," not merely "this happened via Back." Installed once, before
  // any navigation, via addInitScript so it re-attaches on every FRESH
  // document this page ever loads (including the very first one and any
  // ordinary reload) — it does not need to re-run on a bfcache resume,
  // because that never loads a new document at all: the same listener,
  // still resident in the same frozen-then-resumed JS heap, fires again on
  // its own.
  await page.addInitScript(() => {
    window.__uiSentryBfcachePersisted = null;
    window.addEventListener("pageshow", (event) => {
      window.__uiSentryBfcachePersisted = event.persisted;
    });
  });

  try {
    // --- Cold-load perf probe (first navigation in this fresh context) ---
    await runCase(cases, `${engineName}: home loads`, async () => {
      const response = await page.goto(baseUrl, { waitUntil: "load", timeout: 45_000 });
      if (!response || response.status() >= 400) {
        throw new Error(`home page responded ${response?.status() ?? "no response"}`);
      }
      await page.waitForSelector("h1", { timeout: 15_000 });
      await assertNoApiFailures(watch);
      perf = await readPerf(page);
      const promptButtonCount = await page.evaluate(
        () => document.querySelectorAll('a[href*="/conversation/"]').length,
      );
      if (promptButtonCount === 0) {
        throw new Error("no prompt buttons rendered on home page");
      }
      return { detail: `promptButtons=${promptButtonCount}` };
    });

    logger.line(
      `${engineName} perf probe: lcpMs=${perf.lcp !== null ? Math.round(perf.lcp) : "n/a"} cls=${perf.cls?.toFixed?.(3) ?? "n/a"}`,
    );
    if (perf.lcp !== null && perf.lcp > 4000) {
      warnings.push(`cold-load LCP ${Math.round(perf.lcp)}ms exceeds the 4s warn threshold`);
    }
    if (perf.cls !== null && perf.cls > 0.1) {
      warnings.push(`cold-load CLS ${perf.cls.toFixed(3)} exceeds the 0.1 warn threshold`);
    }

    // --- Journey: home -> conversation (real link click, not a teleport) ---
    await runCase(cases, `${engineName}: journey home -> conversation`, async () => {
      const firstPromptLink = page.locator('a[href*="/conversation/"]').first();
      await firstPromptLink.click();
      await page.waitForSelector("#conversation-input", { timeout: 20_000 });
      await settleAfterConversationLoad(page);
      await assertNoApiFailures(watch);
    });

    // --- Composer accepts typed text, then is cleared, never sent ---
    await runCase(cases, `${engineName}: composer types and clears`, async () => {
      const probeText = "sentry structural probe — not sent";
      await humanType(page, probeText, { delayMs: 15 });
      const typedValue = await page.inputValue("#conversation-input");
      if (!typedValue.includes("sentry structural probe")) {
        throw new Error("composer did not accept typed text");
      }
      // This sentry always runs on this Mac's actual keyboard engine
      // regardless of which viewport a WebKit/Chromium context is
      // emulating, so native select-all is always Meta+A here — but
      // setting the controlled input's value directly is simpler and
      // avoids any OS-keybinding assumption at all.
      await page.fill("#conversation-input", "");
      await settleComposer(page);
      const clearedValue = await page.inputValue("#conversation-input");
      if (clearedValue.length !== 0) {
        throw new Error("composer did not clear");
      }
      await assertNoApiFailures(watch);
    });

    // --- Phone-action dialog: crisis footer 911 button, never activates tel: ---
    // The compact footer renders both a mobile-mini and a desktop-full
    // variant in the DOM simultaneously (CSS-hidden by breakpoint), so the
    // selector is scoped to whichever copy of the button is actually
    // visible at this engine's viewport.
    await runCase(cases, `${engineName}: phone-action dialog opens and closes`, async () => {
      const footer = page.locator("#crisis-resources");
      await footer.scrollIntoViewIfNeeded();
      const trigger = footer.locator("button:visible").filter({ hasText: /911/ }).first();
      await trigger.click();
      const dialog = page.locator('div[role="dialog"][aria-modal="true"]').first();
      await dialog.waitFor({ state: "visible", timeout: 5_000 });
      const dialogText = await dialog.innerText();
      const hasCopy = dialogText.includes("Copy number");
      const hasOpenCalling = dialogText.includes("Open calling app");
      const hasClose = dialogText.includes("Close");
      if (!hasCopy || !hasOpenCalling || !hasClose) {
        throw new Error("phone-action dialog missing expected actions");
      }
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "hidden", timeout: 5_000 });
    });

    // --- Prompt buttons render (also checked structurally on home; here
    // confirm the alternate-actions row, e.g. "type your own", is present) ---
    await runCase(cases, `${engineName}: alternate actions render`, async () => {
      // We are on the conversation page now; go back home to re-check in
      // the DOM rather than trust the earlier home-page count alone.
      await page.goBack({ waitUntil: "domcontentloaded", timeout: 20_000 });
      await page.waitForSelector("h1", { timeout: 15_000 });
      const count = await page.evaluate(
        () => document.querySelectorAll('a[href*="/conversation/"]').length,
      );
      if (count === 0) throw new Error("prompt buttons missing after back navigation");
      await page.goForward({ waitUntil: "domcontentloaded", timeout: 20_000 });
      await page.waitForSelector("#conversation-input", { timeout: 15_000 });
      await assertNoApiFailures(watch);
    });

    // --- Disclosure tap: crisis-footer <details> (mobile-only; hidden via
    // CSS at sm and above, so this is a mobile-engine-only structural check) ---
    await runCase(cases, `${engineName}: disclosure toggles`, async () => {
      if (!isMobile) {
        // Desktop has no <details>/<summary> at all (crisis-footer.tsx:
        // the compact mobile wrapper with the disclosure is `sm:hidden`;
        // desktop's `hidden sm:block` copy renders fullFooterContent
        // directly, unconditionally expanded). There is nothing to click,
        // so this can never be a literal toggle test on desktop — but it
        // must still run a real assertion, not report "pass" for doing
        // nothing (no skipped-as-pass). The real desktop-equivalent
        // behavior is that the same content a mobile user has to expand is
        // already visible here without any interaction — assert that
        // directly, and fail loudly if a <details> shows up unexpectedly
        // (a sign the CSS breakpoint moved) or if the full content isn't
        // actually visible without a click.
        const footer = page.locator("#crisis-resources");
        await footer.scrollIntoViewIfNeeded();
        // The mobile <details> is always in the DOM (compact mode renders
        // both copies and lets CSS pick one via sm:hidden/hidden sm:block)
        // — so presence alone isn't the regression signal, VISIBILITY is:
        // a details element that is actually visible on desktop would mean
        // the breakpoint moved.
        const detailsLocator = footer.locator("details").first();
        if ((await detailsLocator.count()) > 0 && (await detailsLocator.isVisible())) {
          throw new Error("desktop unexpectedly shows a visible disclosure <details> — breakpoint may have changed");
        }
        // The compact wrapper renders BOTH copies of fullFooterContent (one
        // inside the closed, hidden <details>, one in the always-visible
        // `hidden sm:block` desktop copy) — `.first()` in DOM order would
        // grab the hidden one and report a false failure, so match only a
        // visible one instead.
        const visibleFindHumanCount = await footer.locator('a[href*="/find-human"]:visible').count();
        if (visibleFindHumanCount === 0) {
          throw new Error("desktop crisis footer does not show full content without a disclosure toggle");
        }
        return { detail: "desktop: full footer content visible; any disclosure <details> stays hidden (by design)" };
      }
      const details = page.locator("#crisis-resources details").first();
      const summary = details.locator("summary").first();
      await summary.click();
      const isOpen = await details.evaluate((el) => el.open);
      if (!isOpen) throw new Error("disclosure did not open");
      await summary.click();
      const isClosed = await details.evaluate((el) => !el.open);
      if (!isClosed) throw new Error("disclosure did not close");
    });

    // --- Navigation: find-human page (structural equivalent of the
    // in-thread referral sheet, which only opens after a live assistant
    // reply — out of reach in a tier that must never call chat; see
    // PR body "spec deviations"). Direct navigation rather than a footer
    // link click: the conversation page's compact footer only surfaces
    // "Find a human" inside the collapsed mobile disclosure, and the
    // desktop copy of the same link is DOM-present-but-hidden at mobile
    // widths, so a click-based selector is viewport-fragile here. ---
    await runCase(cases, `${engineName}: navigation to find-human page`, async () => {
      await page.goto(new URL("/find-human", baseUrl).toString(), {
        waitUntil: "domcontentloaded",
        timeout: 20_000,
      });
      await page.waitForSelector("h1", { timeout: 15_000 });
      const cardCount = await page.evaluate(() => document.querySelectorAll("article").length);
      if (cardCount === 0) throw new Error("no referral cards rendered on find-human page");
      await assertNoApiFailures(watch);
      return { detail: `referralCards=${cardCount}` };
    });

    // --- Back navigation (real history back, not a reload): the composer
    // draft's fate depends on HOW the browser actually served the
    // navigation, and both outcomes are asserted as hard checks now (2nd
    // cross-vendor review, 2026-09-26 — the previous body warned instead of
    // failing when the draft survived, which is an unproven skip of this
    // exact case: "nothing should skip anything designed"). `page.goBack()`
    // can be served either as a fresh navigation or as a resume from the
    // browser's own back-forward cache (bfcache) — a browser heuristic, not
    // this app's code, and NOT something this test should just accept
    // either result of without checking which one happened.
    // conversation-client.tsx holds `messages`/`draft` in plain useState
    // (confirmed by reading the component: no localStorage/sessionStorage
    // key for either), which matches this app's own non-negotiable — no
    // accounts, no per-user history, no session table (AGENTS.md). Which
    // signal actually PROVES a bfcache resume matters (4th cross-vendor
    // review, 2026-09-26): an earlier version of this fix used Navigation
    // Timing's `type === "back_forward"`, but the spec defines
    // back_forward as ANY history-traversal navigation, INCLUDING one the
    // browser did NOT restore from cache — it is not proof of bfcache at
    // all, only proof that Back was pressed. `pageshow`'s own `persisted`
    // boolean (recorded into window.__uiSentryBfcachePersisted by the
    // init script installed once above, before any navigation) is the
    // actual documented signal. The two intended states are both explicit
    // and both real bugs if violated: a fresh navigation must clear the
    // draft (no persistence layer exists, by design); a genuine bfcache
    // resume means the SAME live JS context — including React's in-memory
    // state — kept running, so the draft is expected to still be there,
    // and its absence in that case would itself indicate something
    // wrongly clearing state on resume. Hydration is awaited on EITHER
    // path before reading the composer: a fresh navigation needs it for
    // the same reason every other post-navigation read in this file does,
    // and awaiting it on a resumed page too is a harmless no-op (nothing
    // new needs to hydrate — the frozen JS context already has). ---
    await runCase(cases, `${engineName}: back navigation (history back) — composer draft state matches how the navigation was actually served`, async () => {
      await page.goBack({ waitUntil: "domcontentloaded", timeout: 20_000 });
      await page.waitForSelector("#conversation-input", { timeout: 15_000 });
      // Same pre-hydration keystroke-drop race gotoConversation guards
      // against (settleAfterConversationLoad's own comment) — a back
      // navigation that reloads this page needs the same settle before
      // typing, or the probe text below can land short/empty.
      await settleAfterConversationLoad(page);
      await assertNoApiFailures(watch);

      const probeText = "sentry back-nav probe — not sent";
      await humanType(page, probeText, { delayMs: 15 });
      const typedValue = await page.inputValue("#conversation-input");
      if (!typedValue.includes("sentry back-nav probe")) {
        throw new Error("composer did not accept typed text before navigating away");
      }

      await page.goto(new URL("/find-human", baseUrl).toString(), {
        waitUntil: "domcontentloaded",
        timeout: 20_000,
      });
      await page.waitForSelector("h1", { timeout: 15_000 });

      await page.goBack({ waitUntil: "domcontentloaded", timeout: 20_000 });
      await page.waitForSelector("#conversation-input", { timeout: 15_000 });
      // Wait for the pageshow listener to have actually recorded THIS
      // navigation's own persisted flag before reading it — it fires very
      // early (comparable to `load`), but reading it the instant the
      // selector above resolves is still a race in principle.
      await page
        .waitForFunction(() => window.__uiSentryBfcachePersisted !== null, null, { timeout: 5_000 })
        .catch(() => {});
      await settleAfterConversationLoad(page);
      await assertNoApiFailures(watch);

      const persisted = await page.evaluate(() => window.__uiSentryBfcachePersisted);
      const valueAfterBack = await page.inputValue("#conversation-input");
      if (persisted === true) {
        if (valueAfterBack.length === 0) {
          throw new Error(
            "pageshow reported persisted=true (a real bfcache resume) but the composer draft was gone — the resumed live JS state should still hold it, so something is wrongly clearing state on resume",
          );
        }
        return { detail: "bfcache-resumed (pageshow persisted=true); draft correctly persisted with the resumed live state" };
      }
      if (valueAfterBack.length !== 0) {
        throw new Error(
          `composer draft was still present after a back navigation that was NOT a bfcache resume (pageshow persisted=${persisted}) — no cross-navigation persistence layer exists, by design`,
        );
      }
      return { detail: `pageshow persisted=${persisted}; draft correctly cleared` };
    });

    // --- Reload (a real network fetch, no history/bfcache ambiguity at
    // all): the composer draft does NOT survive. This is a DIFFERENT
    // question from the back-navigation case above — "does a fresh load of
    // this page ever start with stale state" rather than "does going back
    // to it" — and it is the deterministic form of the same underlying
    // no-persistence design, since a reload can never be served from
    // history the way a back navigation sometimes can. ---
    await runCase(cases, `${engineName}: reloading the conversation page clears the composer draft (no persistence, by design)`, async () => {
      const conversationUrl = page.url();
      // The previous case's own last action was a fresh goBack() navigation
      // — same pre-hydration keystroke-drop race as everywhere else typing
      // follows a navigation in this file; without this, typing below can
      // land short/empty before React has hydrated.
      await settleAfterConversationLoad(page);

      const probeText = "sentry reload probe — not sent";
      await humanType(page, probeText, { delayMs: 15 });
      const typedValue = await page.inputValue("#conversation-input");
      if (!typedValue.includes("sentry reload probe")) {
        throw new Error("composer did not accept typed text before reloading");
      }

      await page.goto(conversationUrl, { waitUntil: "domcontentloaded", timeout: 20_000 });
      await page.waitForSelector("#conversation-input", { timeout: 15_000 });
      // Wait for hydration before asserting (cross-vendor review,
      // 2026-09-26) — reading the composer before React has hydrated after
      // a fresh load is the same keystroke-drop-shaped race
      // settleAfterConversationLoad's own header describes, and it would
      // make this assertion pass for the wrong reason (nothing hydrated
      // yet to hold onto a leaked value, not confirmed absence of one).
      await settleAfterConversationLoad(page);
      await assertNoApiFailures(watch);

      const valueAfterReload = await page.inputValue("#conversation-input");
      if (valueAfterReload.length !== 0) {
        throw new Error(
          "composer draft survived a reload — this app keeps no per-user history/session state by design",
        );
      }
    });

    // --- Navigation: report-problem page (structural only, never submitted —
    // the form only ever builds a mailto: link or copies to clipboard, no
    // server submit path exists to accidentally trigger) ---
    await runCase(cases, `${engineName}: report-problem page reachable`, async () => {
      await page.goto(new URL("/report-problem", baseUrl).toString(), {
        waitUntil: "domcontentloaded",
        timeout: 20_000,
      });
      await page.waitForSelector("form, section", { timeout: 15_000 });
      await assertNoApiFailures(watch);
    });

    // --- Scrolling ---
    await runCase(cases, `${engineName}: long-page scroll`, async () => {
      await page.goto(new URL("/about", baseUrl).toString(), {
        waitUntil: "domcontentloaded",
        timeout: 20_000,
      });
      await page.waitForSelector("h1", { timeout: 15_000 });
      // The app's layout scrolls an inner container (overflow-y-auto), not
      // window/body (main is overflow-hidden) — found structurally by
      // largest scrollable overflow rather than by matching a Tailwind
      // class (selector-discipline rule).
      const scrolled = await page.evaluate(() => {
        const candidates = [...document.querySelectorAll("body *")].filter(
          (el) => el.scrollHeight > el.clientHeight + 40,
        );
        if (candidates.length === 0) return null;
        candidates.sort(
          (a, b) => b.scrollHeight - b.clientHeight - (a.scrollHeight - a.clientHeight),
        );
        const target = candidates[0];
        const before = target.scrollTop;
        target.scrollTop = target.scrollHeight;
        return { before, after: target.scrollTop };
      });
      if (!scrolled) throw new Error("no scrollable container found on /about");
      if (!(scrolled.after > scrolled.before)) throw new Error("page did not scroll");
    });

    if (isMobile) {
      await runCase(cases, `${engineName}: horizontal overflow scan`, async () => {
        const overflowing = [];
        for (const path of ["/", "/find-human", "/about"]) {
          await page.goto(new URL(path, baseUrl).toString(), {
            waitUntil: "domcontentloaded",
            timeout: 20_000,
          });
          await page.waitForTimeout(300);
          const { scrollWidth, clientWidth } = await page.evaluate(() => ({
            scrollWidth: document.scrollingElement?.scrollWidth ?? 0,
            clientWidth: document.scrollingElement?.clientWidth ?? 0,
          }));
          if (scrollWidth > clientWidth + 1) {
            overflowing.push(`${path}(${scrollWidth}>${clientWidth})`);
          }
        }
        if (overflowing.length > 0) {
          throw new Error(`horizontal overflow: ${overflowing.join(", ")}`);
        }
      });
    }

    // --- Locale: switch to es, assert translated marker, switch back ---
    // Every shipped locale, not just es — a translation regression on any
    // of the other five (zh/so/am/vi/ru) previously had zero coverage
    // (cross-vendor review, 2026-08-08). Direct ?lang= navigation rather
    // than clicking each nav link: robust across non-Latin scripts and
    // covers all six in about the same wall-clock cost as one click-based
    // switch did.
    for (const [localeCode, marker] of Object.entries(LOCALE_HEADING_MARKERS)) {
      await runCase(cases, `${engineName}: locale ${localeCode} renders translated heading`, async () => {
        await page.goto(`${baseUrl}/?lang=${localeCode}`, {
          waitUntil: "domcontentloaded",
          timeout: 20_000,
        });
        await page.waitForSelector("h1", { timeout: 15_000 });
        const headingText = await page.locator("h1").innerText();
        if (!headingText.includes(marker)) {
          throw new Error(`${localeCode} locale marker not found on home heading`);
        }
      });
    }

    await runCase(cases, `${engineName}: locale switch back to en`, async () => {
      await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 20_000 });
      await page.waitForSelector("h1", { timeout: 15_000 });
      const headingText = await page.locator("h1").innerText();
      const stillTranslated = Object.values(LOCALE_HEADING_MARKERS).some((marker) =>
        headingText.includes(marker),
      );
      if (stillTranslated) {
        throw new Error("home heading still shows a translated marker after switching back to en");
      }
    });

    // --- Accessibility: keyboard-only walk ---
    // WebKit/Safari's DEFAULT tab order (without the OS "Full Keyboard
    // Access" setting, which a headless test runner doesn't have) skips
    // links and buttons entirely — Tab only visits form fields. That's a
    // platform default, not an app accessibility bug, so on WebKit this
    // falls back to confirming the link is programmatically focusable
    // (a real proxy for "assistive tech can reach it") instead of a
    // literal Tab-reaches-it walk, and navigates directly rather than via
    // simulated Tab+Enter.
    await runCase(cases, `${engineName}: keyboard-only walk`, async () => {
      await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 20_000 });
      await page.waitForSelector("h1", { timeout: 15_000 });

      let reachedPromptLink = false;
      for (let i = 0; i < 15 && !reachedPromptLink; i += 1) {
        await page.keyboard.press("Tab");
        reachedPromptLink = await page.evaluate(
          () => document.activeElement?.getAttribute("href")?.includes("/conversation/") ?? false,
        );
      }

      if (reachedPromptLink) {
        await page.keyboard.press("Enter");
        await page.waitForSelector("#conversation-input", { timeout: 15_000 });
      } else if (isMobile) {
        const focusable = await page.evaluate(() => {
          const link = document.querySelector('a[href*="/conversation/"]');
          link?.focus();
          return document.activeElement === link;
        });
        if (!focusable) throw new Error("prompt link is not programmatically focusable");
        await page.locator('a[href*="/conversation/"]').first().click();
        await page.waitForSelector("#conversation-input", { timeout: 15_000 });
      } else {
        throw new Error("Tab never reached a prompt button link");
      }
      await settleAfterConversationLoad(page);

      const composerFocusable = await page.evaluate(() => {
        const el = document.getElementById("conversation-input");
        el?.focus();
        return document.activeElement === el;
      });
      if (!composerFocusable) throw new Error("composer is not keyboard-focusable");
    });

    // --- Accessibility: axe-core scans (serious/critical fail, others warn) ---
    await runCase(cases, `${engineName}: axe scan home`, async () => {
      await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 20_000 });
      await page.waitForSelector("h1", { timeout: 15_000 });
      return await axeScan(page, "home", warnings);
    });
    await runCase(cases, `${engineName}: axe scan conversation`, async () => {
      await gotoConversation(page, baseUrl, "type-your-own");
      return await axeScan(page, "conversation", warnings);
    });
    await runCase(cases, `${engineName}: axe scan find-human`, async () => {
      await page.goto(new URL("/find-human", baseUrl).toString(), {
        waitUntil: "domcontentloaded",
        timeout: 20_000,
      });
      await page.waitForSelector("h1", { timeout: 15_000 });
      return await axeScan(page, "find-human", warnings);
    });

    // --- Slow-network pass: re-run the core journey with route delays ---
    await runCase(cases, `${engineName}: slow-network journey`, async () => {
      await page.unroute("**/*").catch(() => {});
      await page.route("**/*", async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 300));
        // Can race the context-level usage-event route (lib/browser.mjs)
        // matching the same request. A route handler throwing becomes an
        // unhandledRejection at the process level — must never crash the
        // whole run over a route-handling race.
        try {
          await route.continue();
        } catch {
          // best-effort only
        }
      });
      try {
        await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
        await page.waitForSelector('a[href*="/conversation/"]', { timeout: 30_000 });
        const firstLink = page.locator('a[href*="/conversation/"]').first();
        await firstLink.click();
        await page.waitForSelector("#conversation-input", { timeout: 30_000 });
        // Type immediately, while the page is still settling under
        // artificial latency — the composer must not wedge (stay
        // permanently unresponsive to input). A dropped first keystroke or
        // two here is the known pre-hydration race (see
        // settleAfterConversationLoad) — expected under artificial 300ms
        // latency, not a wedge. The bar for "not wedged" is that the
        // composer recovers and accepts input once hydration has actually
        // had a chance to finish, not that every keystroke typed before
        // hydration completes lands.
        await humanType(page, "slow network probe", { delayMs: 10 });
        let value = await page.inputValue("#conversation-input");
        if (!value.includes("slow network probe")) {
          await settleAfterConversationLoad(page);
          await page.fill("#conversation-input", "");
          await humanType(page, "slow network probe retry", { delayMs: 10 });
          value = await page.inputValue("#conversation-input");
          if (!value.includes("slow network probe retry")) {
            throw new Error("composer wedged under slow-network conditions");
          }
        }
      } finally {
        await page.unroute("**/*").catch(() => {});
      }
    });
  } finally {
    await session.context.close().catch(() => {});
    if (session.ownsBrowser) await session.browser.close().catch(() => {});
  }

  const failed = cases.filter((c) => c.status === "fail");
  return {
    status: failed.length === 0 ? "pass" : "fail",
    engine: engineName,
    cases,
    warnings,
    perf: { lcpMs: perf.lcp, cls: perf.cls },
  };
}
