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
const REPORT_FROM = process.env.RESOURCE_REVIEW_EMAIL_FROM ?? "Streetlight UI Sentry <onboarding@resend.dev>";
const REPORT_TO = process.env.RESOURCE_REVIEW_EMAIL_TO ?? "alexmercer.0x@gmail.com";
// send-resend-email.mjs reads these exact env names (R14: FROM/TO exported
// inside the doppler-wrapped child).
process.env.RESOURCE_REVIEW_EMAIL_FROM = REPORT_FROM;
process.env.RESOURCE_REVIEW_EMAIL_TO = REPORT_TO;

const startedAt = new Date();
const logPath = `${LOG_DIR}/${startedAt.toISOString().replace(/[:.]/g, "-")}.log`;
const logger = new Logger(logPath);

const previousState = readPreviousState();

const partial = { tier0: null, tier1: null, tier2: null, crashError: null };
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

  // R4: three consecutive BLOCKED runs escalates the subject (and, here,
  // the exit code) to FAIL — a sentry that can never talk to the model
  // must surface on a bounded clock, not stay quietly "degraded" forever.
  const previousConsecutiveBlocked = previousState?.consecutiveBlockedRuns ?? 0;
  const consecutiveBlockedRuns =
    partial.tier2?.status === "blocked" ? previousConsecutiveBlocked + 1 : 0;
  const escalatedFromBlocked = level === "DEGRADED" && consecutiveBlockedRuns >= 3;
  const effectiveLevel = escalatedFromBlocked ? "FAIL" : level;

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
    consecutiveBlockedRuns,
    lastSuccessfulLiveChatAt,
    escalatedFromBlocked,
    crashError: partial.crashError,
    overallLevel: effectiveLevel,
    emailAccepted: null,
    emailHttpStatus: null,
  };

  if (partial.crashError) {
    logger.line(`orchestrator crash: ${partial.crashError}`);
  }
  logger.line(`overall status: ${effectiveLevel} (exitCode=${exitCode})`);

  const subject = buildSubject({ level, siteDown, escalatedFromBlocked });
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

  partial.tier2 = await runTier2({ baseUrl: BASE_URL, logger });
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
