// Playwright config for the Streetlight UI sentry.
//
// This package does NOT run tests through the `playwright test` CLI runner.
// Tier 2's three-state (pass / blocked / fail) classification and the
// single content-free last-run.json report don't map cleanly onto the
// pass/fail test-runner model, so tier0/tier1/tier2 are plain scripts that
// drive browsers directly (same pattern as
// scripts/prod-validation/validate-live.mjs). This file exists to declare
// the explicit device/viewport profiles once (R10 — no OS-level coordinates
// or window placement anywhere) so every script imports the same source of
// truth instead of duplicating viewport literals.
import { devices } from "@playwright/test";

// Desktop viewport for tier 1's Chromium pass. A plain viewport, not a
// device preset — desktop is not a specific device.
export const desktopViewport = { width: 1280, height: 800 };

// Mobile viewport for tier 1's WebKit pass and tier 2. Streetlight's
// audience is heavily mobile Safari; WebKit is the proxy (spec R: engines).
// 390x844 matches validate-live.mjs's existing iPhone-ish profile.
export const mobileDevice = {
  ...devices["iPhone 13"],
  viewport: { width: 390, height: 844 },
};

export default {
  testDir: "./tests",
  timeout: 60_000,
  retries: 0,
  reporter: [["list"]],
  use: {
    trace: "off",
    video: "off",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "tier1-desktop-chromium",
      use: { ...devices["Desktop Chrome"], viewport: desktopViewport },
    },
    {
      name: "tier1-mobile-webkit",
      use: mobileDevice,
    },
  ],
};
