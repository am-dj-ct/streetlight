// R11: npm ci + browser install happen in install.sh (setup time), NEVER in
// the scheduled run. This checks the already-installed browser binaries are
// present and launchable and fails with a clear, actionable message instead
// of ever triggering a download. Runs inside the doppler-wrapped
// orchestrator (not a separate bash preflight) so a missing-browser failure
// still goes through the one finalizer/email path (R13/R14).
//
// 2026-09-15 incident: this used to report "missing browsers" whenever a
// headless launch didn't finish inside a fixed timeout, with no way to
// tell an actually-missing binary from a slow-to-launch one. The plist ran
// under ProcessType=Background, which macOS throttles hard (`taskpolicy -b`
// took Chromium's launch past 20s and WebKit to 9.6s under load 14, versus
// 0.5s interactively) — so every run reported "missing" while the browsers
// were installed the whole time. Fixed alongside this file by dropping
// ProcessType=Background from the plist. This file now separates the two
// failure modes so a recurrence is diagnosable from the log alone instead
// of requiring another repro: "executable_missing" (nothing at the path
// Playwright's own registry names) is a real install problem — go run
// install.sh; "launch_failed" (the executable exists but launch() didn't
// return ok inside the timeout) reports elapsed time and the first line of
// the error, which is what would have told 2026-09-15 apart in one read.
import { chromium, webkit } from "@playwright/test";
import { existsSync } from "node:fs";

// Generous on purpose: this only needs to rule out "actually missing" from
// "installed but slow under load", not to be fast. The 20s value that
// shipped originally was tuned for an interactive launch and had no margin
// at all against the ProcessType=Background throttling above.
export const LAUNCH_TIMEOUT_MS = 60_000;

// Exported (rather than kept private to checkBrowsersInstalled) so tests can
// drive it with a fake browserType/existsSyncFn instead of a real Playwright
// browser — same pattern lib/browser.mjs's launchTier1Browser uses.
export async function checkBrowserLaunch(browserType, { existsSyncFn = existsSync } = {}) {
  // browserType.executablePath() reads Playwright's own registry for where
  // this pinned browser is supposed to live — it does not touch the
  // filesystem itself, so existsSyncFn is still the actual check.
  let executablePath = null;
  try {
    executablePath = browserType.executablePath();
  } catch (error) {
    return {
      status: "executable_missing",
      path: null,
      elapsedMs: null,
      error: String(error?.message ?? error).split("\n")[0],
    };
  }

  if (!executablePath || !existsSyncFn(executablePath)) {
    return {
      status: "executable_missing",
      path: executablePath || null,
      elapsedMs: null,
      error: `no browser executable at the path Playwright's registry names (${executablePath ?? "unknown path"})`,
    };
  }

  const startedAt = Date.now();
  try {
    const browser = await browserType.launch({ headless: true, timeout: LAUNCH_TIMEOUT_MS });
    await browser.close();
    return { status: "ok", path: executablePath, elapsedMs: Date.now() - startedAt, error: null };
  } catch (error) {
    return {
      status: "launch_failed",
      path: executablePath,
      elapsedMs: Date.now() - startedAt,
      error: String(error?.message ?? error).split("\n")[0].slice(0, 200),
    };
  }
}

// Returns per-browser detail (`results`) alongside the flat ok/missing
// shape callers already used, so tier0.mjs can tell an install problem
// from a launch-timing problem without re-deriving it.
export async function checkBrowsersInstalled() {
  const results = {
    chromium: await checkBrowserLaunch(chromium),
    webkit: await checkBrowserLaunch(webkit),
  };

  const missing = Object.entries(results)
    .filter(([, r]) => r.status !== "ok")
    .map(([name]) => name);

  return { ok: missing.length === 0, missing, results };
}
