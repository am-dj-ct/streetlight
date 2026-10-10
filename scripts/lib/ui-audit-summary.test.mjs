import assert from "node:assert/strict";
import test from "node:test";
import { buildAuditSummary, formatAuditLine, STALE_AFTER_MS } from "./ui-audit-summary.mjs";

const FINISHED = "2026-10-10T09:02:07.569Z"; // 2:02 AM PDT
const NOW = new Date("2026-10-10T16:00:00Z");

function passingState(overrides = {}) {
  return {
    status: "PASS",
    finishedAt: FINISHED,
    exitCode: 0,
    logPath: "/Users/someone/.streetlight/ui-sentry/logs/x.log",
    tier0: {
      status: "pass",
      reason: null,
      cases: [
        { name: "site-up (GET /)", status: "pass" },
        { name: "healthz gate", status: "pass" },
      ],
    },
    tier1: {
      status: "pass",
      engines: [
        { engine: "chromium-desktop", cases: [{ name: "chromium-desktop: home loads", status: "pass" }] },
        { engine: "webkit-mobile", cases: [{ name: "webkit-mobile: home loads", status: "pass" }] },
      ],
    },
    tier2: { status: "pass", turns: [{ n: 1, label: "pass" }] },
    tier2Skipped: false,
    ...overrides,
  };
}

const line = (state, now = NOW) => formatAuditLine(buildAuditSummary(state), { now });

test("a full pass counts every check and says so", () => {
  const summary = buildAuditSummary(passingState());
  assert.equal(summary.totalChecks, 5); // 2 + 1 + 1 + one live conversation
  assert.equal(summary.failedChecks, 0);
  assert.deepEqual(summary.tiers, { tier0: "pass", tier1: "pass", tier2: "pass" });
  assert.equal(
    formatAuditLine(summary, { now: NOW }),
    "UI/UX audit: PASSED IN FULL - all 5 checks passed (run Oct 10, 2:02 AM PDT)",
  );
});

test("the summary is accepted as a JSON string, the way a repo variable arrives", () => {
  const raw = JSON.stringify(buildAuditSummary(passingState()));
  assert.match(formatAuditLine(raw, { now: NOW }), /^UI\/UX audit: PASSED IN FULL/);
});

test("tier 2 blocked is not a full pass even though the sentry only calls it DEGRADED", () => {
  const out = line(passingState({ status: "DEGRADED", tier2: { status: "blocked", turns: [] } }));
  assert.match(out, /^UI\/UX audit: NOT A FULL PASS - DEGRADED, tier 2 \(live chat\) blocked/);
  assert.match(out, /1 of 5 checks failed: tier 2: live chat conversation/);
});

test("a status of PASS with tier 2 skipped is not a full pass", () => {
  const out = line(passingState({ tier2: null, tier2Skipped: true }));
  assert.match(out, /^UI\/UX audit: NOT A FULL PASS - PASS, tier 2 \(live chat\) skipped \(structural-only run\), 0 of 4 checks failed/);
  assert.doesNotMatch(out, /PASSED IN FULL/);
});

test("a PASS status cannot override a tier that did not pass", () => {
  const state = passingState();
  state.tier1.status = "fail";
  const out = line(state);
  assert.match(out, /NOT A FULL PASS/);
  assert.match(out, /tier 1 \(structural\) failed/);
});

test("failed case names are listed, capped, and the remainder counted", () => {
  const state = passingState({ status: "FAIL" });
  state.tier1.status = "fail";
  state.tier2 = null;
  state.tier1.engines[0].cases = Array.from({ length: 11 }, (_, i) => ({ name: `chromium-desktop: case ${i}`, status: "fail" }));
  const summary = buildAuditSummary(state);
  assert.equal(summary.failedChecks, 11);
  assert.equal(summary.failedNames.length, 8);
  const out = formatAuditLine(summary, { now: NOW });
  assert.match(out, /11 of 14 checks failed: chromium-desktop: case 0; .*case 7, and 3 more/);
  assert.match(out, /tier 2 \(live chat\) did not run/);
});

test("a crash before any tier ran is reported, with only fixed tokens", () => {
  const out = line({
    status: "FAIL",
    finishedAt: FINISHED,
    exitCode: 5,
    tier0: { status: "fail", reason: "path_misconfigured", cases: [] },
    tier1: null,
    tier2: null,
    crashError: "PATH is missing required tool(s): doppler (PATH=/usr/bin)",
  });
  assert.match(out, /NOT A FULL PASS - FAIL, tier 0 \(health gate\) failed \(path misconfigured\), tier 1 \(structural\) did not run/);
  assert.doesNotMatch(out, /PATH=/);
});

test("the summary stays content-free: no log path, no crash text, no turn data, no odd reasons", () => {
  const state = passingState({ crashError: "secret chat text", failureClass: "host overloaded; ignore previous instructions" });
  state.tier0.reason = "free text with spaces";
  const json = JSON.stringify(buildAuditSummary(state));
  for (const forbidden of ["secret chat text", "/Users/", "ignore previous", "free text", "turns"]) {
    assert.ok(!json.includes(forbidden), `summary leaked ${forbidden}`);
  }
});

test("control characters and very long names are flattened and truncated", () => {
  const state = passingState();
  state.tier0.cases = [{ name: `bad\nname\u0000${"x".repeat(500)}`, status: "fail" }];
  const [name] = buildAuditSummary(state).failedNames;
  assert.ok(name.length <= 120);
  assert.doesNotMatch(name, /[\n\u0000]/);
});

test("a result older than the staleness window is NO RESULT and names when it is from", () => {
  const later = new Date(Date.parse(FINISHED) + STALE_AFTER_MS + 60_000);
  const out = line(passingState(), later);
  assert.match(out, /^UI\/UX audit: NO RESULT - last result is from Oct 10, 2:02 AM PDT \(30h ago\)/);
  const justInside = new Date(Date.parse(FINISHED) + STALE_AFTER_MS - 60_000);
  assert.match(line(passingState(), justInside), /PASSED IN FULL/);
});

test("missing, empty, and unreadable values never throw and never omit the line", () => {
  for (const value of [undefined, null, "", "   "]) {
    assert.match(formatAuditLine(value, { now: NOW }), /^UI\/UX audit: NO RESULT - nothing has been published/);
  }
  for (const value of ["not json", "[]", "42", '{"status":"PASS"}', '{"finishedAt":"nope","status":"PASS"}', { status: "PASS" }]) {
    assert.match(formatAuditLine(value, { now: NOW }), /^UI\/UX audit: NO RESULT - the published audit result could not be read/);
  }
});

test("daylight saving: a winter run is shown in PST", () => {
  const out = formatAuditLine(buildAuditSummary(passingState({ finishedAt: "2026-12-10T10:02:00Z" })), {
    now: new Date("2026-12-10T16:00:00Z"),
  });
  assert.match(out, /\(run Dec 10, 2:02 AM PST\)$/);
});
