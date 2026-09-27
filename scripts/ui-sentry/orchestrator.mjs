#!/usr/bin/env node
// Single doppler-wrapped orchestrator: runs tier 0/1/2 and writes the
// report. One finalizer path (R13): whatever happens, including an early
// crash, the report is written to the run log, state is written
// atomically, and the correct exit code is preserved.
//
// This sentry sends no email. It used to mail a report to Jesse's personal
// inbox on every run, pass or fail; both halves of that are now redundant
// and the success half was pure noise. See
// docs/decisions/2026-08-17-ui-sentry-reports-without-email.md — the run
// verdict reaches a human through two independent monitors that both read
// last-run.json / the sentinel spine, never through this process.
import { chromium, webkit } from "@playwright/test";
import { desktopViewport, mobileDevice } from "./playwright.config.mjs";
import { Logger } from "./lib/logger.mjs";
import { LOG_DIR } from "./lib/paths.mjs";
import { readPreviousState, writeStateAtomic } from "./lib/state.mjs";
import { buildReportBody, buildSubject, computeOverallLevel } from "./lib/report.mjs";
import { isHostOverloaded, readHostLoad } from "./lib/host-load.mjs";
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

const startedAt = new Date();
const logPath = `${LOG_DIR}/${startedAt.toISOString().replace(/[:.]/g, "-")}.log`;
// Stamped straight into state below as `invocationId` — run-ui-sentry.sh
// exports the exact same value it captured as its own SENTINEL_AT before
// this process ever started, so sentinel-emit.sh can require an EXACT
// match rather than only "not older than" a captured instant (3rd
// cross-vendor review, 2026-09-26). Null for any direct/manual invocation
// outside that wrapper (e.g. commissioning checks) — the emitter's own
// match check already treats an absent id as unverifiable, same as before
// this existed.
const invocationId = process.env.UI_SENTRY_INVOCATION_ID || null;
const logger = new Logger(logPath);

const previousState = readPreviousState();

const partial = {
  tier0: null,
  tier1: null,
  tier2: null,
  tier2Skipped: false,
  crashError: null,
  hostLoadTier0Start: null,
  hostLoadTier1Start: null,
  hostLoadTier1Samples: [],
};
let finalized = false;

// Content-free host-load line (host-load.mjs) — numbers only, logged and
// stamped into last-run.json at both tier0 start and tier1 start (2026-09-27:
// the 07:23 run that fabricated 17 cascaded failures under load ~144/10
// cores had no evidence of load anywhere in the report at all).
function logHostLoad(label, sample) {
  logger.line(
    `host load at ${label}: load1=${sample.load1.toFixed(2)} load5=${sample.load5.toFixed(2)} ` +
      `load15=${sample.load15.toFixed(2)} cpus=${sample.cpuCount}`,
  );
}

// A single snapshot before tier1 starts is not enough (cross-vendor review
// of #52, finding 2): a spike that has already cleared by tier1 start can
// wrongly relabel a genuine UI regression, and a spike that only appears
// mid-tier1 is missed entirely. Two things fix that: this periodic sampler
// (visibility — every ~15s while tier1 is running, purely for the log and
// last-run.json's evidence trail) and, doing the actual work of deciding
// host_overloaded, tier1.mjs's own runCase now takes a load reading at the
// exact MOMENT each case fails (see tier1.mjs) — that per-failure reading,
// not this periodic one, is what finalize() below checks the threshold
// against.
function startPeriodicHostLoadSampler(intervalMs = 15_000) {
  const samples = [];
  const timer = setInterval(() => {
    const sample = { at: new Date().toISOString(), ...readHostLoad() };
    samples.push(sample);
    logger.line(
      `host load sample (during tier1): load1=${sample.load1.toFixed(2)} load5=${sample.load5.toFixed(2)} ` +
        `load15=${sample.load15.toFixed(2)} cpus=${sample.cpuCount}`,
    );
  }, intervalMs);
  return { samples, stop: () => clearInterval(timer) };
}

// The first case (across both engines, in run order) that actually failed
// and carries its own failure-time load reading — see tier1.mjs's runCase.
// "e.g. at the first failure" (cross-vendor review of #52, finding 2): using
// the failure-time reading, not a run-start snapshot or the max ever seen,
// is what ties the host_overloaded decision to whether the host was
// actually overloaded WHILE the failing cases were running.
function firstFailureHostLoad(tier1) {
  for (const engine of tier1?.engines ?? []) {
    for (const c of engine.cases ?? []) {
      if (c.status === "fail" && c.hostLoadAtFailure) return c.hostLoadAtFailure;
    }
  }
  return null;
}

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
  const { level, siteDown, browserLaunchFailed } = computeOverallLevel(partial);

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

  // Host-overload detection (2026-09-27, host-load.mjs; refined in
  // cross-vendor review of #52). A real Mac-load problem (not a site
  // problem) can make tier1's own browser commands time out and, before the
  // cascade fix (browser.recreate-page.test.mjs), poison every later case
  // too. This NEVER changes effectiveLevel/exitCode above — a tier1 failure
  // is exactly as red whether the host was overloaded or not. It only lets
  // the check-in layer (run-ui-sentry.sh / lib/sentinel-emit.sh) tell Jesse
  // WHY in the red email.
  //
  // The decision uses the load reading captured AT THE MOMENT OF THE FIRST
  // FAILING CASE (firstFailureHostLoad, tier1.mjs's own runCase), not a
  // run-start snapshot and not the max load seen anywhere in the run — a
  // spike that already cleared by the time tier1 started cannot relabel a
  // genuine UI regression, and a spike that only appears mid-tier1 (caught
  // by the periodic sampler below, for visibility, but not the decision)
  // is not missed just because it happened after the run-start snapshot.
  const firstFailureLoad = firstFailureHostLoad(partial.tier1);
  const hostOverloaded =
    partial.tier1?.status === "fail" &&
    firstFailureLoad != null &&
    isHostOverloaded([firstFailureLoad]);

  const lastSuccessfulLiveChatAt =
    partial.tier2?.lastSuccessfulLiveChatAt ?? previousState?.lastSuccessfulLiveChatAt ?? null;

  // Exit codes are deliberately distinct per failure class so a human or
  // caller-track-pager reading launchd's own exit status (not just the log)
  // can tell them apart without opening anything: 2 = site down, 3 =
  // browser launch failed/timed out (2026-09-15 incident — this used to be
  // indistinguishable from a real site failure), 1 = any other FAIL, 0 =
  // pass/degraded-not-fail.
  let exitCode;
  if (siteDown) exitCode = 2;
  else if (browserLaunchFailed) exitCode = 3;
  else if (effectiveLevel === "FAIL") exitCode = 1;
  else exitCode = 0;

  const state = {
    status: effectiveLevel,
    invocationId,
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
    hostLoad: {
      tier0Start: partial.hostLoadTier0Start,
      tier1Start: partial.hostLoadTier1Start,
      tier1Samples: partial.hostLoadTier1Samples,
      firstFailureLoad,
    },
    hostOverloaded,
  };

  if (partial.crashError) {
    logger.line(`orchestrator crash: ${partial.crashError}`);
  }
  logger.line(
    `overall status: ${effectiveLevel} (exitCode=${exitCode}, blockedNarrative=${blockedNarrative}, consecutiveBlockedRuns=${consecutiveBlockedRuns}, tier2Skipped=${Boolean(partial.tier2Skipped)}, hostOverloaded=${hostOverloaded})`,
  );

  const subject = buildSubject({
    level,
    siteDown,
    browserLaunchFailed,
    blockedNarrative,
    consecutiveBlockedRuns,
    tier2Skipped: partial.tier2Skipped,
    tier2Status: partial.tier2?.status ?? null,
  });
  // The report goes to this run's log, nowhere else. It is the same
  // content-free body the email used to carry, so a human diagnosing a red
  // run reads the tier table here instead of in their inbox. The headline
  // goes in ahead of the table so the verdict is the first thing in the
  // report block rather than something you scroll to.
  logger.line(subject);
  logger.line(buildReportBody(state));

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

  partial.hostLoadTier0Start = readHostLoad();
  logHostLoad("tier0 start", partial.hostLoadTier0Start);

  partial.tier0 = await runTier0({ baseUrl: BASE_URL, logger });
  if (partial.tier0.status === "fail") {
    logger.line(`tier0 failed (${partial.tier0.reason}); skipping tier1/tier2`);
    await finalize();
    return;
  }

  partial.hostLoadTier1Start = readHostLoad();
  logHostLoad("tier1 start", partial.hostLoadTier1Start);

  const periodicSampler = startPeriodicHostLoadSampler();
  try {
    partial.tier1 = await runTier1BothEngines();
  } finally {
    periodicSampler.stop();
    partial.hostLoadTier1Samples = periodicSampler.samples;
  }
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
