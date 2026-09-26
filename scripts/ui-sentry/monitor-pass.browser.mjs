// Local-only rendered regression; no production calls or model spend.
// Build/start with DEV_MOCK_CHAT=true, NEXT_PUBLIC_TURNSTILE_ENABLED=true,
// NEXT_PUBLIC_TURNSTILE_SITE_KEY=synthetic-sitekey. Use the same build env.
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { installMonitorPass, monitorTokenHeader } from "./lib/monitor-pass.mjs";
import { installTurnBudgetGuard } from "./lib/budget-guard.mjs";
import { gotoConversation, runTurn } from "./lib/conversation.mjs";
import { mkdir } from "node:fs/promises";

const baseUrl = process.env.MONITOR_PASS_TEST_URL ?? "http://127.0.0.1:3451";
if (!["127.0.0.1", "localhost"].includes(new URL(baseUrl).hostname)) {
  throw new Error("This regression may run only against a local mock server");
}
const health = await (await fetch(`${baseUrl}/healthz`)).json();
assert.equal(health.chatMode, "mock-local");
assert.equal(health.abuseControls.turnstileEnabled, true);
process.env.STREETLIGHT_MONITOR_TOKEN = "synthetic-browser-monitor-credential";
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  for (const withPass of [false, true]) {
    const context = await browser.newContext();
    // No upstream traffic, even Cloudflare. The first execution succeeds;
    // later executions model the token withholding seen by the monitor.
    await context.route("https://challenges.cloudflare.com/**", (route) => route.fulfill({
      contentType: "application/javascript",
      body: `(() => {
        let options;
        window.syntheticExecutions = 0;
        window.turnstile = {
          render: (_el, config) => { options = config; return 'widget'; },
          reset: () => {}, remove: () => {},
          execute: () => {
            window.syntheticExecutions++;
            if (window.syntheticExecutions === 1) options.callback('synthetic-first');
            else options['error-callback']();
          }
        };
      })();`,
    }));
    const budget = installTurnBudgetGuard(context, 8, undefined, "synthetic-ops", baseUrl);
    const pass = withPass ? await installMonitorPass(context, baseUrl) : null;
    const page = await context.newPage();
    const headersSeen = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/api/chat") {
        // Record booleans only, never header values or content.
        headersSeen.push(Boolean(request.headers()[monitorTokenHeader]));
      }
    });
    await gotoConversation(page, baseUrl, "understand-letter-or-form");
    const results = [];
    for (let turn = 1; turn <= 2; turn++) {
      await pass?.selectTurn(page, turn, results[0]?.label === "pass");
      results.push(await runTurn(page, { text: "Help me understand a synthetic letter.", baseUrl }));
    }
    assert.equal(results[0].label, "pass");
    assert.equal(results[1].label, withPass ? "pass" : "client_blocked");
    assert.equal(await page.evaluate(() => window.syntheticExecutions), withPass ? 1 : 2);
    assert.equal(budget.used, withPass ? 2 : 1);
    // Playwright request events precede route overrides; server unit tests
    // and helper route tests separately assert the actual outgoing header.
    assert.equal(headersSeen[0], false);
    if (withPass) {
      await mkdir("verify-artifacts", { recursive: true });
      await page.screenshot({ path: "verify-artifacts/monitor-pass-local.png", fullPage: true });
    }
    console.log(`PASS rendered ${withPass ? "monitor bridge" : "baseline reproduction"}: ${results.map((r) => r.label).join(", ")}`);
    await context.close();
  }
} finally {
  await browser.close();
}
