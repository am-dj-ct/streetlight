// Covers lib/blocked-diagnostics.mjs — the content-free diagnostics for a
// client_blocked live-chat turn (4th cross-vendor review, 2026-09-26, P1,
// non-negotiable: no content logging). The previous version copied raw
// console/page-error text (truncated to 200 chars) straight into the log
// line and the returned object; a synthetic marker planted in a console
// error survived that unchanged. Every test here proves a synthetic
// marker — something that stands in for a secret, a fragment of user
// text, or anything else that must never leave this module — cannot reach
// categorizeErrorText's return value, a tally snapshot/diff, or the final
// diagnostics object, no matter what shape the input text takes.
import assert from "node:assert/strict";
import test from "node:test";
import {
  buildBlockedDiagnostics,
  categorizeErrorText,
  diffSnapshots,
  ERROR_CATEGORIES,
  makeErrorTally,
} from "./blocked-diagnostics.mjs";

const SYNTHETIC_MARKER = "SYNTHETIC_CONTENT_MARKER_do_not_leak_9f3c";

test("categorizeErrorText returns only a known category or the literal 'other', never a derivative of the input", () => {
  for (const category of ERROR_CATEGORIES) {
    assert.equal(categorizeErrorText(`${category}: something went wrong`), category);
    // The marker rides ALONGSIDE a real category name in the same
    // message — exactly what a real stack trace/console error looks like
    // (a type name plus arbitrary detail) — and the marker must still
    // never appear in the result.
    assert.equal(
      categorizeErrorText(`Uncaught ${category}: ${SYNTHETIC_MARKER}`),
      category,
      `a message naming ${category} alongside the marker must classify as ${category}, not leak the marker`,
    );
  }
  assert.equal(categorizeErrorText(`totally unrecognized failure: ${SYNTHETIC_MARKER}`), "other");
  assert.equal(categorizeErrorText(SYNTHETIC_MARKER), "other");
  assert.equal(categorizeErrorText(""), "other");
  assert.equal(categorizeErrorText(undefined), "other");
  assert.equal(categorizeErrorText(null), "other");
});

test("categorizeErrorText's return value never contains the marker substring, for any input containing it", () => {
  const inputs = [
    SYNTHETIC_MARKER,
    `TypeError: cannot read property of ${SYNTHETIC_MARKER}`,
    `${SYNTHETIC_MARKER} NetworkError ${SYNTHETIC_MARKER}`,
    `AbortError${SYNTHETIC_MARKER}`,
  ];
  for (const input of inputs) {
    const category = categorizeErrorText(input);
    assert.equal(category.includes(SYNTHETIC_MARKER), false, `category output leaked the marker for input: ${input}`);
    assert.ok(
      ERROR_CATEGORIES.includes(category) || category === "other",
      `category "${category}" must be one of the closed set`,
    );
  }
});

test("a tally recording a console error containing the marker never surfaces it in a snapshot or diff", () => {
  const tally = makeErrorTally();
  const before = tally.snapshot();
  tally.recordConsole("error", `ReferenceError: ${SYNTHETIC_MARKER} is not defined`);
  tally.recordConsole("warning", `plain warning with ${SYNTHETIC_MARKER} in it`);
  tally.recordPageError(`Uncaught TypeError: ${SYNTHETIC_MARKER}`);
  const after = tally.snapshot();
  const delta = diffSnapshots(before, after);

  const serializedSnapshot = JSON.stringify(after);
  const serializedDelta = JSON.stringify(delta);
  assert.equal(serializedSnapshot.includes(SYNTHETIC_MARKER), false, "snapshot leaked the marker");
  assert.equal(serializedDelta.includes(SYNTHETIC_MARKER), false, "diff leaked the marker");

  assert.equal(delta.consoleErrorCount, 2);
  assert.equal(delta.pageErrorCount, 1);
  assert.equal(delta.categoryCounts.ReferenceError, 1);
  assert.equal(delta.categoryCounts.TypeError, 1);
  assert.equal(delta.categoryCounts.other, 1);
});

test("buildBlockedDiagnostics's full output never contains the marker, and every field is a boolean, a count, or a fixed-key count object", () => {
  const tally = makeErrorTally();
  const before = tally.snapshot();
  tally.recordConsole("error", `SyntaxError near ${SYNTHETIC_MARKER}`);
  const errorDelta = diffSnapshots(before, tally.snapshot());

  const diagnostics = buildBlockedDiagnostics({
    monitorPassSelected: true,
    turnstileFound: true,
    turnstileWrapped: false,
    monitorPassFlag: true,
    streamingInProgress: true,
    widgetEvalFailed: false,
    errorDelta,
  });

  const serialized = JSON.stringify(diagnostics);
  assert.equal(serialized.includes(SYNTHETIC_MARKER), false, "the final diagnostics object leaked the marker");

  for (const key of ["monitorPassSelected", "turnstileFound", "turnstileWrapped", "monitorPassFlag", "streamingInProgress", "widgetEvalFailed"]) {
    assert.equal(typeof diagnostics[key], "boolean", `${key} must be a boolean`);
  }
  assert.equal(typeof diagnostics.consoleErrorCount, "number");
  assert.equal(typeof diagnostics.pageErrorCount, "number");
  assert.deepEqual(
    Object.keys(diagnostics.errorCategoryCounts).sort(),
    [...ERROR_CATEGORIES, "other"].sort(),
    "errorCategoryCounts must only ever have the fixed, closed set of category keys",
  );
  for (const count of Object.values(diagnostics.errorCategoryCounts)) {
    assert.equal(typeof count, "number");
  }
});

test("buildBlockedDiagnostics tolerates a missing errorDelta without throwing or fabricating content", () => {
  const diagnostics = buildBlockedDiagnostics({});
  assert.equal(diagnostics.consoleErrorCount, 0);
  assert.equal(diagnostics.pageErrorCount, 0);
  assert.deepEqual(Object.keys(diagnostics.errorCategoryCounts).sort(), [...ERROR_CATEGORIES, "other"].sort());
});
