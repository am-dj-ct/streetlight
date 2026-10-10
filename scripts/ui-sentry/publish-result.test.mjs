import assert from "node:assert/strict";
import test from "node:test";
import { buildAuditSummary } from "../lib/ui-audit-summary.mjs";
import { buildSubject } from "./lib/report.mjs";
import { publishResult, summarizeState, VARIABLE_NAME } from "./publish-result.mjs";

const state = {
  status: "PASS",
  finishedAt: "2026-10-10T09:02:07.569Z",
  exitCode: 0,
  tier0: { status: "pass", cases: [{ name: "healthz gate", status: "pass" }] },
  tier1: { status: "pass", engines: [{ cases: [{ name: "chromium-desktop: home loads", status: "pass" }] }] },
  tier2: { status: "pass", turns: [] },
  tier2Skipped: false,
  blockedNarrative: "none",
  consecutiveBlockedRuns: 0,
};

test("publishes the summary as the repo variable body", async () => {
  const calls = [];
  const result = await publishResult({
    statePath: "ignored",
    repo: "owner/repo",
    readFile: () => JSON.stringify(state),
    runGh: async (args, stdin) => calls.push({ args, stdin }),
  });
  assert.equal(result.ok, true);
  assert.deepEqual(calls[0].args, ["variable", "set", VARIABLE_NAME, "--repo", "owner/repo"]);
  const body = JSON.parse(calls[0].stdin);
  assert.equal(body.status, "PASS");
  assert.equal(body.headline, "Streetlight UI sentry: PASS");
  assert.equal(body.totalChecks, 3);
  assert.equal(body.finishedAt, state.finishedAt);
});

test("a publish failure is reported, never thrown, and carries no raw gh output", async () => {
  const result = await publishResult({
    readFile: () => JSON.stringify(state),
    runGh: async () => {
      throw Object.assign(new Error("HTTP 401: token ghp_SECRET is bad"), { code: 1 });
    },
  });
  assert.equal(result.ok, false);
  assert.doesNotMatch(result.reason, /ghp_SECRET|401/);
});

test("an unreadable or corrupt last-run.json is reported, never thrown", async () => {
  const missing = () => {
    throw Object.assign(new Error("x"), { code: "ENOENT" });
  };
  for (const readFile of [missing, () => "{not json"]) {
    let ghCalled = false;
    const result = await publishResult({
      readFile,
      runGh: async () => {
        ghCalled = true;
      },
    });
    assert.equal(result.ok, false);
    assert.equal(ghCalled, false);
  }
});

test("the headline matches the run log's own wording, including the early-exit state", () => {
  const blocked = summarizeState({
    ...state,
    status: "DEGRADED",
    blockedNarrative: "steady_blocked",
    consecutiveBlockedRuns: 4,
    tier2: { status: "blocked" },
  });
  assert.equal(blocked.headline, "Streetlight UI sentry: DEGRADED (chat blocked, 4 consecutive)");

  const earlyExit = summarizeState({
    status: "FAIL",
    finishedAt: state.finishedAt,
    exitCode: 5,
    tier0: { status: "fail", reason: "path_misconfigured", cases: [] },
    tier1: null,
    tier2: null,
  });
  assert.equal(earlyExit.headline, "Streetlight UI sentry: FAIL");
  assert.equal(earlyExit.tiers.tier1, "missing");
});

test("every headline the sentry can print survives the summary's headline allowlist", () => {
  const levels = ["PASS", "DEGRADED", "FAIL"];
  const narratives = ["none", "escalated_once", "steady_blocked", "recovery"];
  let checked = 0;
  for (const level of levels) {
    for (const blockedNarrative of narratives) {
      for (const tier2Skipped of [false, true]) {
        for (const tier2Status of [null, "pass", "partial", "blocked", "fail"]) {
          for (const [siteDown, browserLaunchFailed] of [[false, false], [true, false], [false, true]]) {
            const headline = buildSubject({
              level, siteDown, browserLaunchFailed, blockedNarrative, consecutiveBlockedRuns: 7, tier2Skipped, tier2Status,
            });
            assert.equal(buildAuditSummary(state, { headline }).headline, headline, headline);
            checked += 1;
          }
        }
      }
    }
  }
  assert.ok(checked > 100);
});
