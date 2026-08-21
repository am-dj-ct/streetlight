import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchTier1Browser } from "./lib/browser.mjs";
import { tier2Verdict } from "./lib/chat-status.mjs";
import { buildReportBody, buildSubject, computeOverallLevel } from "./lib/report.mjs";

const SENTRY_DIR = path.dirname(fileURLToPath(import.meta.url));

test("tier 2 reports partial only for pass and blocked turns with no failures", () => {
  assert.equal(tier2Verdict(["pass", "blocked"]), "partial");
  assert.equal(tier2Verdict(["blocked", "pass", "blocked"]), "partial");
  assert.equal(tier2Verdict(["pass", "blocked", "fail"]), "fail");
});

test("tier 2 keeps the pass, blocked, and fail verdicts", () => {
  assert.equal(tier2Verdict(["pass", "pass"]), "pass");
  assert.equal(tier2Verdict(["blocked", "blocked"]), "blocked");
  assert.equal(tier2Verdict(["fail", "fail"]), "fail");
});

test("tier 1 uses only the package-pinned browser, never the system Chrome channel", async () => {
  const calls = [];
  const expectedBrowser = { kind: "test-browser" };
  const browserType = {
    async launch(options) {
      calls.push(options);
      return expectedBrowser;
    },
  };

  const browser = await launchTier1Browser(browserType);

  assert.equal(browser, expectedBrowser);
  assert.deepEqual(calls, [{ headless: true }]);
});

test("a partial tier 2 result reports DEGRADED without claiming chat is blocked", () => {
  const overall = computeOverallLevel({
    tier0: { status: "pass" },
    tier1: { status: "pass" },
    tier2: { status: "partial" },
  });

  assert.deepEqual(overall, { level: "DEGRADED", siteDown: false });
  assert.equal(
    buildSubject({
      ...overall,
      blockedNarrative: "none",
      consecutiveBlockedRuns: 0,
      tier2Skipped: false,
      tier2Status: "partial",
    }),
    "Streetlight UI sentry: DEGRADED (some chat turns passed)",
  );
});

// Regression guard for ADR 2026-08-17-ui-sentry-reports-without-email: this
// sentry reports by writing, never by sending. The old every-run email went
// to Jesse's personal inbox on PASS as well as FAIL, which is exactly the
// noise the sentinel's green check-in already covers. A source-level check
// rather than a behavioral one on purpose — a mail path reintroduced
// anywhere under scripts/ui-sentry/ would be reachable from the scheduled
// run whether or not a unit test happens to exercise that branch.
function sentryFiles(dir) {
  const found = [];

  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules") continue;

    const full = path.join(dir, entry);

    if (statSync(full).isDirectory()) {
      found.push(...sentryFiles(full));
      continue;
    }

    if (/\.(mjs|sh)$/.test(entry) && entry !== path.basename(fileURLToPath(import.meta.url))) {
      found.push(full);
    }
  }

  return found;
}

test("no file under scripts/ui-sentry sends mail", () => {
  // Comments legitimately explain why the mail path is gone, so only
  // executable-looking references count: an api.resend.com call, an import of
  // a mailer, or the send script this sentry used to shell out to.
  const forbidden = [
    /api\.resend\.com/,
    /\bnew\s+Resend\b/,
    /require\(\s*["']resend["']\s*\)/,
    /from\s+["'][^"']*\bemail\.mjs["']/,
    /send-resend-email\.mjs/,
    /sendReportEmail/,
  ];

  const violations = [];

  for (const file of sentryFiles(SENTRY_DIR)) {
    const source = readFileSync(file, "utf8");

    for (const pattern of forbidden) {
      if (pattern.test(source)) {
        violations.push(`${path.relative(SENTRY_DIR, file)} matches ${pattern}`);
      }
    }
  }

  assert.deepEqual(violations, []);
});

test("the report body carries the tier table and no delivery fields", () => {
  const body = buildReportBody({
    overallLevel: "FAIL",
    startedAt: "2026-08-17T14:23:00.000Z",
    finishedAt: "2026-08-17T14:25:00.000Z",
    logPath: "/Users/example/.streetlight/ui-sentry/logs/run.log",
    exitCode: 1,
    tier0: { status: "fail", cases: [{ status: "fail", name: "site-up", httpStatus: 503 }] },
    tier1: null,
    tier2: null,
    tier2Skipped: false,
    lastSuccessfulLiveChatAt: null,
    consecutiveBlockedRuns: 0,
    blockedEscalationActive: false,
  });

  assert.match(body, /FAIL \| site-up \| http=503/);
  assert.match(body, /Exit code: 1/);
  assert.doesNotMatch(body, /emailAccepted|emailHttpStatus|@/);
});
