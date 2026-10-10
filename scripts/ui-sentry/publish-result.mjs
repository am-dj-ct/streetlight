#!/usr/bin/env node
// Publishes a content-free summary of the latest sentry run to a GitHub
// Actions repo variable (UI_SENTRY_LAST_RESULT) so the cloud-side Streetlight
// usage digest can say whether the nightly UI/UX audit passed in full.
//
// Called from run-ui-sentry.sh's EXIT trap, so it covers every way a wrapper
// invocation ends. It is strictly best-effort: it never throws, always exits
// 0, and logs its outcome as one content-free line. A failed publish must not
// change the sentry's exit code or any other reporting (the sentry's job is
// to detect and record, not to depend on GitHub being reachable).
//
// Reads ~/.streetlight/ui-sentry/last-run.json (or $UI_SENTRY_STATE_ROOT).
// Standalone: no Playwright import, so it runs even when node_modules is
// missing (one of the early-exit paths it has to cover).
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildAuditSummary } from "../lib/ui-audit-summary.mjs";
import { buildSubject } from "./lib/report.mjs";
import { LAST_RUN_PATH, STATE_ROOT } from "./lib/paths.mjs";

export const VARIABLE_NAME = "UI_SENTRY_LAST_RESULT";
export const DEFAULT_REPO = "am-dj-ct/streetlight";
const GH_TIMEOUT_MS = 30_000;
// launchd's minimal PATH has no Homebrew. The wrapper's PATH preflight
// exists because of exactly that, so try the known absolute locations too.
const GH_CANDIDATES = ["gh", "/opt/homebrew/bin/gh", "/usr/local/bin/gh"];

/**
 * Build the summary for a parsed last-run.json, with the same one-line
 * headline the run log carries.
 */
export function summarizeState(state) {
  let headline = null;
  try {
    headline = buildSubject({
      level: state?.status ?? "FAIL",
      siteDown: state?.tier0?.reason === "site_down",
      browserLaunchFailed: state?.tier0?.reason === "browser_launch_failed",
      blockedNarrative: state?.blockedNarrative ?? "none",
      consecutiveBlockedRuns: state?.consecutiveBlockedRuns ?? 0,
      tier2Skipped: Boolean(state?.tier2Skipped),
      tier2Status: state?.tier2?.status ?? null,
    });
  } catch {
    headline = null;
  }
  return buildAuditSummary(state, { headline });
}

/**
 * @returns {Promise<{ ok: boolean, reason: string, summary?: object }>}
 *   never rejects
 */
export async function publishResult({
  statePath = LAST_RUN_PATH,
  repo = process.env.UI_SENTRY_PUBLISH_REPO || DEFAULT_REPO,
  readFile = (p) => readFileSync(p, "utf8"),
  runGh = defaultRunGh,
} = {}) {
  let state;
  try {
    state = JSON.parse(readFile(statePath));
  } catch (error) {
    return { ok: false, reason: `cannot read last-run.json (${error?.code ?? error?.name ?? "error"})` };
  }

  let summary;
  let body;
  try {
    summary = summarizeState(state);
    body = JSON.stringify(summary);
  } catch (error) {
    return { ok: false, reason: `cannot build summary (${error?.name ?? "error"})` };
  }

  try {
    await runGh(["variable", "set", VARIABLE_NAME, "--repo", repo], body);
  } catch (error) {
    // Only the error class and a short exit/signal hint: never raw gh output.
    const hint = error?.code ?? error?.signal ?? error?.name ?? "error";
    return { ok: false, reason: `gh variable set failed (${hint})`, summary };
  }
  return { ok: true, reason: "published", summary };
}

// Tries each gh location in turn; only "not found" moves on to the next one.
async function defaultRunGh(args, stdin) {
  let lastError = null;
  for (const bin of GH_CANDIDATES) {
    try {
      await execGh(bin, args, stdin);
      return;
    } catch (error) {
      lastError = error;
      if (error?.code !== "ENOENT") throw error;
    }
  }
  throw lastError ?? new Error("gh not found");
}

function execGh(bin, args, stdin) {
  return new Promise((resolve, reject) => {
    const child = execFile(bin, args, { timeout: GH_TIMEOUT_MS, windowsHide: true }, (error) => {
      if (error) reject(error);
      else resolve();
    });
    child.stdin.on("error", () => {});
    child.stdin.end(stdin);
  });
}

// One content-free line, to the shared publish log and, when the state names
// one inside the state root, to that run's own log.
function logOutcome(result, statePath) {
  const status = result.summary?.status ?? "n/a";
  const line = `[${new Date().toISOString()}] ui-sentry publish-result: ${result.ok ? "ok" : "FAILED"} - ${result.reason} (status=${status})`;
  console.log(line);
  try {
    mkdirSync(STATE_ROOT, { recursive: true });
    appendFileSync(path.join(STATE_ROOT, "publish-result.log"), `${line}\n`);
  } catch {
    // Logging must never take anything down.
  }
  try {
    const logPath = JSON.parse(readFileSync(statePath, "utf8"))?.logPath;
    const logsDir = path.join(STATE_ROOT, "logs") + path.sep;
    if (typeof logPath === "string" && path.resolve(logPath).startsWith(logsDir)) {
      appendFileSync(logPath, `${line}\n`);
    }
  } catch {
    // Same: best effort.
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    const result = await publishResult();
    logOutcome(result, LAST_RUN_PATH);
  } catch (error) {
    console.log(`ui-sentry publish-result: FAILED - unexpected ${error?.name ?? "error"}`);
  }
  process.exit(0);
}
