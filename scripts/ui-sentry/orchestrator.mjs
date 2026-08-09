#!/usr/bin/env node
// Single doppler-wrapped orchestrator: runs tier 0/1/2 AND sends the email,
// so RESEND_API_KEY reaches the mailer in the same process that ran the
// tests (R14). One finalizer path (R13): whatever happens, including an
// early crash, state is written atomically, the email is attempted with a
// bounded timeout, and the correct exit code is preserved.
import { chromium, webkit } from "@playwright/test";
import { desktopViewport, mobileDevice } from "./playwright.config.mjs";
import { Logger } from "./lib/logger.mjs";
import { LOG_DIR } from "./lib/paths.mjs";
import { readPreviousState, writeStateAtomic } from "./lib/state.mjs";
import { sendReportEmail } from "./lib/email.mjs";
import { buildEmailBody, buildSubject, computeOverallLevel } from "./lib/report.mjs";
import { runTier0 } from "./tier0.mjs";
import { runTier1 } from "./tier1.mjs";
import { runTier2 } from "./tier2.mjs";

const BASE_URL = process.env.UI_SENTRY_BASE_URL ?? "https://streetlight.help";
// Skips tier 2 (no /api/chat calls, no model spend) for structural-only
// verification — needed for post-merge commissioning (R9: prove the
// launchd path works without spending on every commissioning check) and
// for re-verifying tier 0/1 fixes without burning turns each time.
// Scheduled/manual live runs never set this.
const SKIP_TIER2 =
  process.argv.includes("--skip-tier2") || process.env.UI_SENTRY_SKIP_TIER2 === "1";
const REPORT_FROM = process.env.RESOURCE_REVIEW_EMAIL_FROM ?? "Streetlight UI Sentry <onboarding@resend.dev>";
// The shared agent-secrets RESEND_API_KEY's Resend account has no verified
// domain (only balancedlivingtherapy.com, status "not_started" — a BLT
// domain, not appropriate for this public-good project's FROM address
// anyway) so the sandbox onboarding@resend.dev sender is in play, which
// Resend restricts to delivering only to the account's own registered
// address. Confirmed empirically (403 "You can only send testing emails to
// your own email address (jesse.c.dunn@outlook.com)") — that address is
// the only one this API key can actually deliver to today. Flagged as an
// open question in the PR body; not a default to keep assuming silently.
const REPORT_TO = process.env.RESOURCE_REVIEW_EMAIL_TO ?? "jesse.c.dunn@outlook.com";
// send-resend-email.mjs reads these exact env names (R14: FROM/TO exported
// inside the doppler-wrapped child).
process.env.RESOURCE_REVIEW_EMAIL_FROM = REPORT_FROM;
process.env.RESOURCE_REVIEW_EMAIL_TO = REPORT_TO;

const startedAt = new Date();
const logPath = `${LOG_DIR}/${startedAt.toISOString().replace(/[:.]/g, "-")}.log`;
const logger = new Logger(logPath);

const previousState = readPreviousState();

const partial = { tier0: null, tier1: null, tier2: null, tier2Skipped: false, crashError: null };
let finalized = false;

async function runTier1BothEngines() {
  logger.line("tier1 starting: chromium-desktop");
  const chromiumResult = await runTier1({
    baseUrl: BASE_URL,
    browserType: chromium,
    deviceOptions: { viewport: desktopViewport },
    engineName: "chromium-desktop",
    isMobile: false,
    logger,
  });
  logger.line(`tier1 chromium-desktop: ${chromiumResult.status} (${chromiumResult.cases.length} cases)`);

  logger.line("tier1 starting: webkit-mobile");
  const webkitResult = await runTier1({
    baseUrl: BASE_URL,
    browserType: webkit,
    deviceOptions: { ...mobileDevice },
    engineName: "webkit-mobile",
    isMobile: true,
    logger,
  });
  logger.line(`tier1 webkit-mobile: ${webkitResult.status} (${webkitResult.cases.length} cases)`);

  const status = chromiumResult.status === "pass" && webkitResult.status === "pass" ? "pass" : "fail";
  return { status, engines: [chromiumResult, webkitResult] };
}

async function finalize() {
  if (finalized) return;
  finalized = true;

  const finishedAt = new Date();
  const { level, siteDown } = computeOverallLevel(partial);

  // R4, revised after review: three consecutive BLOCKED runs escalates the
  // subject to FAIL exactly ONCE (the run that first crosses the
  // threshold), not on every run thereafter. A structurally blocked chat
  // path is a known, standing condition once it's been flagged — repeating
  // FAIL forever trains the reader to stop opening the one alert that
  // matters. Subsequent blocked runs report a steady
  // "DEGRADED (chat blocked, Nth consecutive)" instead. The escalation
  // state persists in last-run.json (blockedEscalationActive) and clears
  // the moment a live turn actually succeeds, which also sends a
  // recovery-flavored subject.
  //
  // A deliberately skipped tier 2 (--skip-tier2, structural-only) makes no
  // observation about the chat path at all, so it must not disturb the
  // real streak — carry the previous values forward unchanged rather than
  // resetting to "not blocked."
  const previousConsecutiveBlocked = previousState?.consecutiveBlockedRuns ?? 0;
  const previousBlockedEscalationActive = previousState?.blockedEscalationActive ?? false;

  let consecutiveBlockedRuns = previousConsecutiveBlocked;
  let blockedEscalationActive = previousBlockedEscalationActive;
  let blockedNarrative = "none";

  if (!partial.tier2Skipped) {
    const tier2Status = partial.tier2?.status ?? null;
    consecutiveBlockedRuns = tier2Status === "blocked" ? previousConsecutiveBlocked + 1 : 0;
    blockedEscalationActive = previousBlockedEscalationActive;

    if ((tier2Status === "pass" || tier2Status === "partial") && previousBlockedEscalationActive) {
      blockedNarrative = "recovery";
      blockedEscalationActive = false;
    } else if (tier2Status === "blocked") {
      if (consecutiveBlockedRuns >= 3 && !previousBlockedEscalationActive) {
        blockedNarrative = "escalated_once";
        blockedEscalationActive = true;
      } else if (previousBlockedEscalationActive || consecutiveBlockedRuns >= 3) {
        blockedNarrative = "steady_blocked";
      }
    }

    // The recovery subject is "good news" framing — never let it mask a
    // concurrent, unrelated real failure (e.g. tier 1 broke this same run).
    if (blockedNarrative === "recovery" && level !== "PASS") {
      blockedNarrative = "none";
    }
  }

  const effectiveLevel = blockedNarrative === "escalated_once" ? "FAIL" : level;

  const lastSuccessfulLiveChatAt =
    partial.tier2?.lastSuccessfulLiveChatAt ?? previousState?.lastSuccessfulLiveChatAt ?? null;

  let exitCode;
  if (siteDown) exitCode = 2;
  else if (effectiveLevel === "FAIL") exitCode = 1;
  else exitCode = 0;

  const state = {
    status: effectiveLevel,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    exitCode,
    logPath,
    baseUrl: BASE_URL,
    tier0: partial.tier0 ?? { status: "fail", reason: "crashed", cases: [] },
    tier1: partial.tier1
      ? { status: partial.tier1.status, engines: partial.tier1.engines }
      : null,
    tier2: partial.tier2
      ? {
          status: partial.tier2.status,
          turns: partial.tier2.turns,
          turnBudgetUsed: partial.tier2.turnBudgetUsed,
          turnBudgetCap: partial.tier2.turnBudgetCap,
          lastSuccessfulLiveChatAt: partial.tier2.lastSuccessfulLiveChatAt,
        }
      : null,
    tier2Skipped: Boolean(partial.tier2Skipped),
    consecutiveBlockedRuns,
    lastSuccessfulLiveChatAt,
    blockedEscalationActive,
    blockedNarrative,
    crashError: partial.crashError,
    overallLevel: effectiveLevel,
    emailAccepted: null,
    emailHttpStatus: null,
  };

  if (partial.crashError) {
    logger.line(`orchestrator crash: ${partial.crashError}`);
  }
  logger.line(
    `overall status: ${effectiveLevel} (exitCode=${exitCode}, blockedNarrative=${blockedNarrative}, consecutiveBlockedRuns=${consecutiveBlockedRuns}, tier2Skipped=${Boolean(partial.tier2Skipped)})`,
  );

  const subject = buildSubject({
    level,
    siteDown,
    blockedNarrative,
    consecutiveBlockedRuns,
    tier2Skipped: partial.tier2Skipped,
    tier2Status: partial.tier2?.status ?? null,
  });
  const body = buildEmailBody(state);

  let emailResult;
  try {
    emailResult = await sendReportEmail({ subject, bodyText: body });
  } catch (error) {
    emailResult = { accepted: false, httpStatus: null, error: String(error).slice(0, 300) };
  }
  state.emailAccepted = emailResult.accepted;
  state.emailHttpStatus = emailResult.httpStatus ?? null;
  logger.line(
    `email: accepted=${emailResult.accepted} httpStatus=${emailResult.httpStatus ?? "n/a"} attempts=${emailResult.attempts ?? "n/a"}` +
      (emailResult.error ? ` error=${emailResult.error}` : ""),
  );

  // State is written last, after the email fields are known, still inside
  // the same atomic write (R13).
  writeStateAtomic(state);

  process.exitCode = exitCode;
}

function crashInto(label) {
  return (error) => {
    partial.crashError = `${label}: ${String(error?.stack ?? error).slice(0, 400)}`;
    finalize().catch((finalizeError) => {
      console.error(`finalizer itself failed: ${String(finalizeError).slice(0, 300)}`);
      process.exitCode = 1;
    });
  };
}

process.on("uncaughtException", crashInto("uncaughtException"));
process.on("unhandledRejection", crashInto("unhandledRejection"));

function handleSignal(name) {
  return () => {
    partial.crashError = `${name}: run interrupted`;
    finalize()
      .catch(() => {
        process.exitCode = 1;
      })
      .finally(() => process.exit(process.exitCode ?? 1));
  };
}
process.on("SIGTERM", handleSignal("SIGTERM"));
process.on("SIGINT", handleSignal("SIGINT"));

async function main() {
  logger.line(`ui-sentry run starting against ${BASE_URL}`);

  partial.tier0 = await runTier0({ baseUrl: BASE_URL, logger });
  if (partial.tier0.status === "fail") {
    logger.line(`tier0 failed (${partial.tier0.reason}); skipping tier1/tier2`);
    await finalize();
    return;
  }

  partial.tier1 = await runTier1BothEngines();
  if (partial.tier1.status === "fail") {
    logger.line("tier1 failed; skipping tier2 (structural check must pass before spending on live turns)");
    await finalize();
    return;
  }

  if (SKIP_TIER2) {
    logger.line("tier2 skipped (--skip-tier2 / UI_SENTRY_SKIP_TIER2=1) — structural-only run, no model spend");
    partial.tier2Skipped = true;
    await finalize();
    return;
  }

  // Visible window, not headless (2026-08-08 ADR amendment): a controlled
  // experiment on this same day found the Turnstile flag survives in a
  // visible window (3 passes / 4 cold starts) but does not survive
  // headless (0 passes / 4 cold starts, including two of this sentry's own
  // production runs). Jesse authorized a visible browser window opening on
  // this Mac for the real scheduled run so the check has a realistic
  // chance of passing at all. `runTier2`'s own default stays headless —
  // this is the one call site that represents the actual scheduled/manual
  // `--live` path, so it opts in explicitly rather than the default
  // silently deciding it.
  partial.tier2 = await runTier2({ baseUrl: BASE_URL, logger, headed: true });
  await finalize();
}

main()
  .catch((error) => {
    partial.crashError = `main: ${String(error?.stack ?? error).slice(0, 400)}`;
    return finalize();
  })
  .finally(() => {
    process.exit(process.exitCode ?? 1);
  });
