import assert from "node:assert/strict";
import test from "node:test";
import {
  hasUsableHostLoadSample,
  isTimeoutFailure,
  nextHostOverloadEpisode,
  tryReadHostLoad,
} from "./host-overload.mjs";

test("timeout classification uses the error class, not arbitrary error text", () => {
  assert.equal(isTimeoutFailure({ errorClass: "TimeoutError" }), true);
  assert.equal(isTimeoutFailure({ errorClass: "deadline_exceeded" }), true);
  assert.equal(isTimeoutFailure({ errorClass: "Error", error: "contains timeout text" }), false);
});

test("a failed host-load read stays unavailable instead of becoming healthy", () => {
  assert.equal(hasUsableHostLoadSample(null), false);
  assert.equal(hasUsableHostLoadSample({ load1: 5 }), false);
  assert.equal(hasUsableHostLoadSample({ load1: 5, cpuCount: 10 }), true);
  const previous = process.env.STREETLIGHT_HOST_LOAD_SAMPLE_JSON;
  process.env.STREETLIGHT_HOST_LOAD_SAMPLE_JSON = "not-json";
  try {
    assert.equal(tryReadHostLoad(), null);
  } finally {
    if (previous === undefined) delete process.env.STREETLIGHT_HOST_LOAD_SAMPLE_JSON;
    else process.env.STREETLIGHT_HOST_LOAD_SAMPLE_JSON = previous;
  }
});

test("overload episode suppresses initially, pages once after 60 minutes, and resets on success", () => {
  const first = nextHostOverloadEpisode({
    now: "2026-09-28T17:00:00Z",
    overloadedFailure: true,
  });
  assert.equal(first.shouldPage, false);
  const threshold = nextHostOverloadEpisode({
    previous: first,
    now: "2026-09-28T18:00:00Z",
    overloadedFailure: true,
  });
  assert.equal(threshold.shouldPage, true);
  assert.equal(threshold.overloadDurationMinutes, 60);
  const later = nextHostOverloadEpisode({
    previous: { ...threshold, overloadEscalationActive: true },
    now: "2026-09-28T18:05:00Z",
    overloadedFailure: true,
  });
  assert.equal(later.shouldPage, false);
  assert.equal(later.overloadEscalationActive, true);
  const recovered = nextHostOverloadEpisode({
    previous: later,
    now: "2026-09-28T18:10:00Z",
    overloadedFailure: false,
    success: true,
  });
  assert.equal(recovered.overloadFirstObservedAt, null);
  assert.equal(recovered.overloadConsecutiveFailures, 0);
  assert.equal(recovered.overloadEscalationActive, false);
});
