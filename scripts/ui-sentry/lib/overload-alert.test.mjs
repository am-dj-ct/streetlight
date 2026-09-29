import assert from "node:assert/strict";
import test from "node:test";
import { classifyOverloadAlert } from "./overload-alert.mjs";

const overloadedTimeoutTier1 = {
  status: "fail",
  engines: [{
    cases: [{
      status: "fail",
      errorClass: "TimeoutError",
      hostLoadAtFailure: { load1: 100, cpuCount: 10 },
    }],
  }],
};

test("overload-only timeout is pager-facing DEGRADED while preserving the observed FAIL", () => {
  const result = classifyOverloadAlert({
    observedLevel: "FAIL",
    tier1: overloadedTimeoutTier1,
    previousState: null,
    now: "2026-09-28T17:00:00Z",
  });
  assert.equal(result.effectiveLevel, "DEGRADED");
  assert.equal(result.failureClass, "host_overloaded");
  assert.equal(result.overloadAlertDisposition, "suppress");
});

test("sustained overload crosses to pager-facing FAIL exactly once", () => {
  const previousState = {
    overloadFirstObservedAt: "2026-09-28T17:00:00Z",
    overloadConsecutiveFailures: 12,
    overloadEscalationActive: false,
  };
  const crossing = classifyOverloadAlert({
    observedLevel: "FAIL",
    tier1: overloadedTimeoutTier1,
    previousState,
    now: "2026-09-28T18:00:00Z",
  });
  assert.equal(crossing.effectiveLevel, "FAIL");
  assert.equal(crossing.overloadAlertDisposition, "page");
  const later = classifyOverloadAlert({
    observedLevel: "FAIL",
    tier1: overloadedTimeoutTier1,
    previousState: { ...crossing.overloadEpisode, overloadEscalationActive: true },
    now: "2026-09-28T18:05:00Z",
  });
  assert.equal(later.effectiveLevel, "DEGRADED");
  assert.equal(later.overloadAlertDisposition, "suppress");
});

test("an unavailable load sample does not page a timeout immediately but pages after 60 minutes", () => {
  const tier1 = {
    status: "fail",
    engines: [{ cases: [{ status: "fail", errorClass: "TimeoutError", hostLoadAtFailure: null }] }],
  };
  const first = classifyOverloadAlert({
    observedLevel: "FAIL",
    tier1,
    previousState: null,
    now: "2026-09-29T17:00:00Z",
  });
  assert.equal(first.effectiveLevel, "DEGRADED");
  assert.equal(first.failureClass, "host_load_unavailable");
  assert.equal(first.hostOverloaded, false);
  assert.equal(first.overloadAlertDisposition, "suppress");

  const sustained = classifyOverloadAlert({
    observedLevel: "FAIL",
    tier1,
    previousState: first.overloadEpisode,
    now: "2026-09-29T18:00:00Z",
  });
  assert.equal(sustained.effectiveLevel, "FAIL");
  assert.equal(sustained.overloadAlertDisposition, "page");
  assert.equal(sustained.overloadEpisode.overloadDurationMinutes, 60);
});

test("a healthy host sample keeps a genuine timeout red even after 60 minutes", () => {
  const tier1 = {
    status: "fail",
    engines: [{ cases: [{ status: "fail", errorClass: "TimeoutError", hostLoadAtFailure: { load1: 5, cpuCount: 10 } }] }],
  };
  const result = classifyOverloadAlert({
    observedLevel: "FAIL",
    tier1,
    previousState: { overloadFirstObservedAt: "2026-09-29T17:00:00Z", overloadConsecutiveFailures: 12 },
    now: "2026-09-29T18:00:00Z",
  });
  assert.equal(result.effectiveLevel, "FAIL");
  assert.equal(result.overloadAlertDisposition, "normal");
  assert.equal(result.failureClass, null);
});

test("a genuine non-timeout failure remains pager-facing FAIL", () => {
  const tier1 = {
    status: "fail",
    engines: [{ cases: [{ status: "fail", errorClass: "Error", hostLoadAtFailure: { load1: 100, cpuCount: 10 } }] }],
  };
  const result = classifyOverloadAlert({
    observedLevel: "FAIL",
    tier1,
    previousState: null,
    now: "2026-09-28T17:00:00Z",
  });
  assert.equal(result.effectiveLevel, "FAIL");
  assert.equal(result.overloadAlertDisposition, "normal");
  assert.equal(result.failureClass, null);
});
