#!/usr/bin/env node
// Zero-spend probe: builds the tier2 browser context EXACTLY the way
// runAttempt (tier2.mjs) does — same launch args, same context options,
// same blockUsageEvents/installTurnBudgetGuard/installMonitorPass calls,
// in the same order — opens the real conversation page, waits, and
// reports whether window.turnstile ever became an object plus any
// failed/aborted requests to challenges.cloudflare.com. Sends NO chat
// message; installTurnBudgetGuard's own abort-past-cap logic never
// triggers because nothing ever calls /api/chat here.
import { chromium } from "@playwright/test";
import { desktopViewport } from "./playwright.config.mjs";
import { blockUsageEvents } from "./lib/browser.mjs";
import { gotoConversation } from "./lib/conversation.mjs";
import { installMonitorPass } from "./lib/monitor-pass.mjs";
import { installTurnBudgetGuard } from "./lib/budget-guard.mjs";
import { TIER2_ENTRY_ID } from "./fixtures/tier2-prompts.mjs";

const BASE_URL = process.env.UI_SENTRY_BASE_URL ?? "https://streetlight.help";
const CHROMIUM_LAUNCH_ARGS = ["--disable-blink-features=AutomationControlled"];

async function launchRealChrome() {
  try {
    return await chromium.launch({ channel: "chrome", headless: false, args: CHROMIUM_LAUNCH_ARGS });
  } catch {
    return chromium.launch({ headless: false, args: CHROMIUM_LAUNCH_ARGS });
  }
}

async function main() {
  const browser = await launchRealChrome();
  const context = await browser.newContext({ viewport: desktopViewport });
  await blockUsageEvents(context);
  const budget = { used: 0, cap: 8, aborted: 0 };
  installTurnBudgetGuard(context, 8, budget, process.env.OPS_READ_TOKEN, BASE_URL);
  await installMonitorPass(context, BASE_URL);

  const page = await context.newPage();
  const consoleMessages = [];
  const pageErrors = [];
  page.on("console", (msg) => consoleMessages.push(`${msg.type()}: ${msg.text()}`));
  page.on("pageerror", (err) => pageErrors.push(String(err?.stack ?? err)));
  const cloudflareEvents = [];
  page.on("requestfailed", (request) => {
    if (request.url().includes("challenges.cloudflare.com")) {
      cloudflareEvents.push({ url: request.url(), failure: request.failure()?.errorText ?? "unknown" });
    }
  });
  page.on("response", (response) => {
    if (response.url().includes("challenges.cloudflare.com")) {
      cloudflareEvents.push({ url: response.url(), status: response.status() });
    }
  });

  await gotoConversation(page, BASE_URL, TIER2_ENTRY_ID);
  await page.waitForTimeout(10_000);

  const turnstileType = await page.evaluate(() => typeof window.turnstile);
  const wrapped = await page.evaluate(() => Boolean(window.turnstile?.__streetlightWrapped));
  const descriptor = await page.evaluate(() => {
    const d = Object.getOwnPropertyDescriptor(window, "turnstile");
    if (!d) return null;
    return { hasGetter: typeof d.get === "function", hasSetter: typeof d.set === "function", configurable: d.configurable, writable: d.writable };
  });
  const widgetsRendered = await page.evaluate(() =>
    document.querySelectorAll("[id^='cf-chl-widget'], .cf-turnstile, iframe[src*='challenges.cloudflare.com']").length,
  );

  console.log(JSON.stringify({ turnstileType, wrapped, descriptor, widgetsRendered, cloudflareEvents, consoleMessages, pageErrors }, null, 2));

  await context.close().catch(() => {});
  await browser.close().catch(() => {});
}

main().catch((error) => {
  console.error("probe failed:", error);
  process.exitCode = 1;
});
