import assert from "node:assert/strict";
import test from "node:test";
import { tier2Verdict } from "./lib/chat-status.mjs";
import { buildSubject, computeOverallLevel } from "./lib/report.mjs";

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
