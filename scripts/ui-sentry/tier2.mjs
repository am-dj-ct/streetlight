// Tier 2 — live LLM conversation, best-effort, THREE-STATE (pass / blocked
// / fail). Real Chrome channel (R11), request-boundary turn budget guard
// (R17), R1-R6 send/reply classification (see lib/conversation.mjs and
// lib/chat-status.mjs). Screenshots are hard-off in this tier always (R7) —
// even on error, this module never calls page.screenshot().
//
// Turnstile retry (2026-08-08 ADR amendment): a controlled experiment found
// Turnstile withholds a token from every automated browser unless
// --disable-blink-features=AutomationControlled is set, and even then one
// cold run in four still comes back fully blocked. One retry in a fresh
// browser/context is authorized — but ONLY when the first attempt was fully
// blocked, because a fully-blocked attempt never gets a token and therefore
// never makes a single /api/chat POST (see turnBucket in chat-status.mjs:
// "client_blocked" and "paused_confirmed" both mean the client withheld the
// request entirely). A mixed or failed attempt already spent real money and
// must never be retried — see the shared-budget note below and the "mixed
// or unexplained failures = red" rule this module already enforced before
// the retry existed.
import { chromium } from "@playwright/test";
import { mobileDevice } from "./playwright.config.mjs";
import { blockUsageEvents } from "./lib/browser.mjs";
import { gotoConversation, runTurn } from "./lib/conversation.mjs";
import { installTurnBudgetGuard } from "./lib/budget-guard.mjs";
import { turnBucket } from "./lib/chat-status.mjs";
import { TIER2_ENTRY_ID, TIER2_TURNS } from "./fixtures/tier2-prompts.mjs";

const HARD_TURN_CAP = 8; // spec: hard cap 8 chat turns per run in code.

// The ONE flag adopted by the 2026-08-08 ADR amendment, and nothing else.
// Do not "improve" this into a stealth library, fingerprint spoofing, or a
// CAPTCHA-solving service — that is the explicit no-escalation rule Jesse
// ratified alongside this flag. If Cloudflare tightens further and this
// stops being enough, this tier reports DEGRADED (via the existing
// blocked/fail verdict machinery below), same as today. It does not grow
// new evasion. A persistent or "warmed" browser profile was tested and
// does NOTHING for the block rate — the automation tell itself is what
// this flag addresses, not fingerprint novelty — so this stays a launch
// arg, never profile/storage-state machinery.
const CHROMIUM_LAUNCH_ARGS = ["--disable-blink-features=AutomationControlled"];

async function launchRealChrome({ headed }) {
  try {
    return await chromium.launch({
      channel: "chrome",
      headless: !headed,
      args: CHROMIUM_LAUNCH_ARGS,
    });
  } catch {
    // Fallback to the pinned bundled Chromium (R11) — real Chrome isn't
    // installed on this machine/runner. Same flag, same rule: behavior must
    // not silently differ between the two launch paths.
    return chromium.launch({
      headless: !headed,
      args: CHROMIUM_LAUNCH_ARGS,
    });
  }
}

// Runs one complete attempt (fresh browser, fresh context, fresh page) and
// returns its own three-state verdict plus whatever it observed. `budget`
// is shared across attempts by the caller — see runTier2 — so this never
// creates its own cap.
async function runAttempt({ attemptNum, baseUrl, logger, headed, budget }) {
  const browser = await launchRealChrome({ headed });
  const context = await browser.newContext({ ...mobileDevice });
  await blockUsageEvents(context);
  installTurnBudgetGuard(context, HARD_TURN_CAP, budget);

  const page = await context.newPage();
  const turns = [];
  let lastSuccessfulLiveChatAt = null;

  try {
    await gotoConversation(page, baseUrl, TIER2_ENTRY_ID);

    for (let i = 0; i < TIER2_TURNS.length; i += 1) {
      if (budget.used >= HARD_TURN_CAP) {
        logger.line(
          `tier2 attempt ${attemptNum} turn ${i + 1}: skipped — turn budget cap (${HARD_TURN_CAP}) reached`,
        );
        turns.push({ n: i + 1, label: "budget_exhausted", httpStatus: null, ttftMs: null, totalMs: 0 });
        continue;
      }

      const result = await runTurn(page, { text: TIER2_TURNS[i], baseUrl });
      turns.push({ n: i + 1, ...result });
      logger.line(
        `tier2 attempt ${attemptNum} turn ${i + 1}/${TIER2_TURNS.length}: label=${result.label} ` +
          `httpStatus=${result.httpStatus ?? "none"} ttftMs=${result.ttftMs ?? "n/a"} totalMs=${result.totalMs}`,
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
    `tier2 attempt ${attemptNum} verdict: status=${status} turnsUsed=${budget.used}/${HARD_TURN_CAP} aborted=${budget.aborted}`,
  );

  return { status, turns, lastSuccessfulLiveChatAt };
}

export async function runTier2({ baseUrl, logger, headed = false }) {
  // Shared across BOTH attempts on purpose — a fresh budget per attempt
  // would let a blocked-then-retried run spend up to 2x HARD_TURN_CAP
  // against production. installTurnBudgetGuard's route handler writes into
  // this same object no matter which attempt's context it is bound to, so
  // the cap is enforced cumulatively at the request boundary either way.
  const budget = { used: 0, cap: HARD_TURN_CAP, aborted: 0 };

  const first = await runAttempt({ attemptNum: 1, baseUrl, logger, headed, budget });

  let final = first;
  if (first.status === "blocked") {
    // Fully blocked means zero /api/chat POSTs were made (client withheld
    // the token every turn) — zero spend, so a second complete attempt in a
    // fresh browser/context is affordable and authorized. A "fail" verdict
    // is never retried here: fail can mean turns already spent money, and
    // re-running a run that already spent is the money trap this module
    // must not create.
    logger.line(
      "tier2 attempt 1 fully blocked (zero chat POSTs made, zero spend) — retrying once in a fresh browser/context",
    );
    final = await runAttempt({ attemptNum: 2, baseUrl, logger, headed, budget });
  }

  logger.line(
    `tier2 verdict: status=${final.status} turnsUsed=${budget.used}/${HARD_TURN_CAP} aborted=${budget.aborted} ` +
      `attempts=${final === first ? 1 : 2}`,
  );

  return {
    status: final.status,
    turns: final.turns,
    turnBudgetUsed: budget.used,
    turnBudgetCap: HARD_TURN_CAP,
    lastSuccessfulLiveChatAt: final.lastSuccessfulLiveChatAt,
  };
}
