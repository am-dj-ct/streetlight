// Covers cron-slot.mjs's handling of the two annual US DST transitions for
// sl-ui-sentry's real schedule (0 2 * * * America/Los_Angeles), added
// 2026-09-27 (cross-vendor review of #52, finding 4). 02:00 Pacific does not
// exist on the spring-forward day (clocks jump from 01:59:59 PST straight to
// 03:00:00 PDT) — Jesse's chosen time is kept as-is; this file proves the
// existing slot-resolution code (localToUtc's own round-trip check, already
// in cron-slot.mjs before this review) handles that gap without crashing,
// double-counting, or silently mis-slotting, on either transition day.
//
// 2026 US DST dates (2nd Sunday in March, 1st Sunday in November): spring
// forward March 8, fall back November 1. Every UTC instant below was
// verified directly against the real localToUtc/slotsBetween/
// captureInvocationSlot implementations (not hand-computed) before being
// written into these assertions.
import assert from "node:assert/strict";
import test from "node:test";
import {
  captureInvocationSlot,
  isScheduleSlot,
  localToUtc,
  slotForItem,
  slotsBetween,
} from "./cron-slot.mjs";

const SCHEDULE = { cron: "0 2 * * *", tz: "America/Los_Angeles" };

test("spring-forward day (2026-03-08): the skipped 02:00 local time resolves to no UTC instant at all", () => {
  assert.equal(
    localToUtc("America/Los_Angeles", { year: 2026, month: 3, day: 8, hour: 2, minute: 0 }),
    undefined,
  );
  // The day before and after resolve normally, one hour of UTC-offset
  // apart, proving this isn't a wider outage around the transition.
  assert.equal(
    localToUtc("America/Los_Angeles", { year: 2026, month: 3, day: 7, hour: 2, minute: 0 }),
    Date.parse("2026-03-07T10:00:00.000Z"),
  );
  assert.equal(
    localToUtc("America/Los_Angeles", { year: 2026, month: 3, day: 9, hour: 2, minute: 0 }),
    Date.parse("2026-03-09T09:00:00.000Z"),
  );
});

test("spring-forward day: slotsBetween skips March 8 entirely, with no crash and no duplicate/missing neighbor slot", () => {
  const from = Date.UTC(2026, 2, 6, 0, 0); // 2026-03-06T00:00Z
  const to = Date.UTC(2026, 2, 10, 0, 0); // 2026-03-10T00:00Z
  const slots = slotsBetween(SCHEDULE, from, to).map((ms) => new Date(ms).toISOString());
  assert.deepEqual(slots, [
    "2026-03-06T10:00:00.000Z",
    "2026-03-07T10:00:00.000Z",
    "2026-03-09T09:00:00.000Z", // March 8 has no entry — the gap
  ]);
});

test("spring-forward day: no UTC instant that day ever reads as a 02:00-local schedule slot", () => {
  // Sweep every minute of March 8, 2026 in UTC (the whole day, both possible
  // offsets) and confirm isScheduleSlot never fires — the transition itself
  // guarantees no local reading of "02:00" exists that day, so this must
  // hold structurally, not by luck.
  const dayStart = Date.UTC(2026, 2, 8, 0, 0);
  let matches = 0;
  for (let ms = dayStart; ms < dayStart + 24 * 60 * 60_000; ms += 60_000) {
    if (isScheduleSlot(SCHEDULE, ms)) matches += 1;
  }
  assert.equal(matches, 0);
});

test("spring-forward day: an invocation shortly after the gap (03:05 PDT, when the job would have fired had 02:00 existed) resolves to the PREVIOUS day's real slot, without throwing", () => {
  const now = new Date("2026-03-08T10:05:00.000Z"); // ~03:05 PDT
  const slot = captureInvocationSlot(SCHEDULE, now);
  assert.equal(slot, "2026-03-07T10:00:00Z");
});

test("fall-back day (2026-11-01): 02:00 local is unambiguous — it resolves to exactly one UTC instant, not the doubled 01:00-01:59 hour", () => {
  assert.equal(
    localToUtc("America/Los_Angeles", { year: 2026, month: 11, day: 1, hour: 2, minute: 0 }),
    Date.parse("2026-11-01T10:00:00.000Z"),
  );
});

test("fall-back day: slotsBetween produces exactly one slot for Nov 1, not two, despite the repeated local hour earlier that morning", () => {
  const from = Date.UTC(2026, 9, 30, 0, 0); // 2026-10-30T00:00Z
  const to = Date.UTC(2026, 10, 3, 0, 0); // 2026-11-03T00:00Z
  const slots = slotsBetween(SCHEDULE, from, to).map((ms) => new Date(ms).toISOString());
  assert.deepEqual(slots, [
    "2026-10-30T09:00:00.000Z",
    "2026-10-31T09:00:00.000Z",
    "2026-11-01T10:00:00.000Z",
    "2026-11-02T10:00:00.000Z",
  ]);
});

test("fall-back day: an invocation right at the real fire time resolves to that same day's slot, not the day before or a duplicate", () => {
  const now = new Date("2026-11-01T10:02:00.000Z"); // ~02:02 PST
  const slot = captureInvocationSlot(SCHEDULE, now);
  assert.equal(slot, "2026-11-01T10:00:00Z");
});

// End-to-end through this repo's own registry fragment (not just the
// synthetic SCHEDULE above) — proves the real sl-ui-sentry entry, as
// actually shipped, has the same safe behavior on the transition day.
test("slotForItem('sl-ui-sentry') across the spring-forward day never throws and never returns a fabricated March 8 slot", () => {
  const beforeGap = slotForItem("sl-ui-sentry", new Date("2026-03-08T09:00:00.000Z")); // ~01:00 PST, before the gap
  assert.equal(beforeGap, "2026-03-07T10:00:00Z");
  const afterGap = slotForItem("sl-ui-sentry", new Date("2026-03-08T11:00:00.000Z")); // ~04:00 PDT, after the gap
  assert.equal(afterGap, "2026-03-07T10:00:00Z");
});

test("slotForItem('sl-ui-sentry') on the fall-back day resolves to that day's single slot", () => {
  const slot = slotForItem("sl-ui-sentry", new Date("2026-11-01T12:00:00.000Z")); // later that same day
  assert.equal(slot, "2026-11-01T10:00:00Z");
});
