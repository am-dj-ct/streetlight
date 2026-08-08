// Tier 2 — live LLM conversation, best-effort, THREE-STATE (pass / blocked
// / fail). Real Chrome channel (R11), request-boundary turn budget guard
// (R17), R1-R6 send/reply classification (see lib/conversation.mjs and
// lib/chat-status.mjs). Screenshots are hard-off in this tier always (R7) —
// even on error, this module never calls page.screenshot().
import { chromium } from "@playwright/test";
import { mobileDevice } from "./playwright.config.mjs";
import { blockUsageEvents } from "./lib/browser.mjs";
import { gotoConversation, runTurn } from "./lib/conversation.mjs";
import { installTurnBudgetGuard } from "./lib/budget-guard.mjs";
import { turnBucket } from "./lib/chat-status.mjs";
import { TIER2_ENTRY_ID, TIER2_TURNS } from "./fixtures/tier2-prompts.mjs";

const HARD_TURN_CAP = 8; // spec: hard cap 8 chat turns per run in code.

async function launchRealChrome({ headed }) {
  try {
    return await chromium.launch({ channel: "chrome", headless: !headed });
  } catch {
    // Fallback to the pinned bundled Chromium (R11) — real Chrome isn't
    // installed on this machine/runner.
    return chromium.launch({ headless: !headed });
  }
}

export async function runTier2({ baseUrl, logger, headed = false }) {
  const browser = await launchRealChrome({ headed });
  const context = await browser.newContext({ ...mobileDevice });
  await blockUsageEvents(context);
  const budget = installTurnBudgetGuard(context, HARD_TURN_CAP);

  const page = await context.newPage();
  const turns = [];
  let lastSuccessfulLiveChatAt = null;

  try {
    await gotoConversation(page, baseUrl, TIER2_ENTRY_ID);

    for (let i = 0; i < TIER2_TURNS.length; i += 1) {
      if (budget.used >= HARD_TURN_CAP) {
        logger.line(`tier2 turn ${i + 1}: skipped — turn budget cap (${HARD_TURN_CAP}) reached`);
        turns.push({ n: i + 1, label: "budget_exhausted", httpStatus: null, ttftMs: null, totalMs: 0 });
        continue;
      }

      const result = await runTurn(page, { text: TIER2_TURNS[i], baseUrl });
      turns.push({ n: i + 1, ...result });
      logger.line(
        `tier2 turn ${i + 1}/${TIER2_TURNS.length}: label=${result.label} httpStatus=${result.httpStatus ?? "none"} ` +
          `ttftMs=${result.ttftMs ?? "n/a"} totalMs=${result.totalMs}`,
      );
      if (result.label === "pass") {
        lastSuccessfulLiveChatAt = new Date().toISOString();
      }
    }
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }

  const buckets = turns.map((t) => turnBucket(t.label));
  const allPass = buckets.every((b) => b === "pass");
  const allBlocked = buckets.every((b) => b === "blocked");
  const anyFail = buckets.some((b) => b === "fail");

  let status;
  if (anyFail) {
    status = "fail";
  } else if (allPass) {
    status = "pass";
  } else if (allBlocked) {
    status = "blocked";
  } else {
    // A mix of pass and blocked turns — inconsistent, not the clean
    // "every automated request gets challenged" story validate-live.mjs
    // documents as expected. Spec: "Mixed or unexplained failures = red."
    status = "fail";
  }

  logger.line(
    `tier2 verdict: status=${status} turnsUsed=${budget.used}/${HARD_TURN_CAP} aborted=${budget.aborted}`,
  );

  return {
    status,
    turns,
    turnBudgetUsed: budget.used,
    turnBudgetCap: HARD_TURN_CAP,
    lastSuccessfulLiveChatAt,
  };
}
