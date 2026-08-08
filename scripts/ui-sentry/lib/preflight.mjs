// R11: npm ci + browser install happen in install.sh (setup time), NEVER in
// the scheduled run. This checks the already-installed browser binaries are
// present and launchable and fails with a clear, actionable message instead
// of ever triggering a download. Runs inside the doppler-wrapped
// orchestrator (not a separate bash preflight) so a missing-browser failure
// still goes through the one finalizer/email path (R13/R14).
import { chromium, webkit } from "@playwright/test";

async function canLaunch(browserType) {
  try {
    const browser = await browserType.launch({ headless: true, timeout: 20_000 });
    await browser.close();
    return true;
  } catch {
    return false;
  }
}

export async function checkBrowsersInstalled() {
  const missing = [];
  if (!(await canLaunch(chromium))) missing.push("chromium");
  if (!(await canLaunch(webkit))) missing.push("webkit");
  return { ok: missing.length === 0, missing };
}
