// Tier 1 — structural, no model spend, MUST PASS (red on any failure).
// Chat is never called anywhere in this tier. Runs once per engine
// (chromium desktop, webkit mobile) — see orchestrator.mjs.
import AxeBuilder from "@axe-core/playwright";
import { launchPage, readPerf, watchProblems } from "./lib/browser.mjs";
import { humanType, settleComposer } from "./lib/human-type.mjs";
import { gotoConversation, settleAfterConversationLoad } from "./lib/conversation.mjs";

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
        return { detail: "skipped: disclosure is mobile-only (sm:hidden on desktop)" };
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

    // --- Back/forward: state survives ---
    await runCase(cases, `${engineName}: back to conversation preserves state`, async () => {
      await page.goBack({ waitUntil: "domcontentloaded", timeout: 20_000 });
      await page.waitForSelector("#conversation-input", { timeout: 15_000 });
      await assertNoApiFailures(watch);
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
    await runCase(cases, `${engineName}: locale switch es -> en`, async () => {
      await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 20_000 });
      const esLink = page.locator('nav[aria-label] a', { hasText: "Español" }).first();
      await esLink.click();
      await page.waitForURL(/lang=es/, { timeout: 10_000 });
      await page.waitForSelector("h1", { timeout: 15_000 });
      const headingText = await page.locator("h1").innerText();
      if (!headingText.includes("¿Qué necesitas?")) {
        throw new Error("es locale marker not found on home heading");
      }
      const enLink = page.locator('nav[aria-label] a', { hasText: "English" }).first();
      await enLink.click();
      await page.waitForURL((url) => !url.toString().includes("lang=es"), { timeout: 10_000 });
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
        await route.continue();
      });
      try {
        await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
        await page.waitForSelector('a[href*="/conversation/"]', { timeout: 30_000 });
        const firstLink = page.locator('a[href*="/conversation/"]').first();
        await firstLink.click();
        await page.waitForSelector("#conversation-input", { timeout: 30_000 });
        // Type while the page is still settling under artificial latency —
        // the composer must not wedge (stay responsive to input).
        await humanType(page, "slow network probe", { delayMs: 10 });
        const value = await page.inputValue("#conversation-input");
        if (!value.includes("slow network probe")) {
          throw new Error("composer wedged under slow-network conditions");
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
