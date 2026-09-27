// Covers isHostOverloaded/readHostLoad (host-load.mjs), added 2026-09-27
// after the 07:23 run that went red under load ~144 on 10 cores with no
// evidence of load anywhere in the report. readHostLoad() itself just calls
// os.loadavg()/os.cpus().length directly — the only thing worth unit-testing
// is isHostOverloaded's pure threshold math, and that it degrades safely
// when a sample is missing (e.g. tier0 failed before tier1 ever started).
import assert from "node:assert/strict";
import test from "node:test";
import { isHostOverloaded, readHostLoad } from "./host-load.mjs";

test("readHostLoad returns only numbers, never anything content-shaped", () => {
  const sample = readHostLoad();
  assert.equal(typeof sample.load1, "number");
  assert.equal(typeof sample.load5, "number");
  assert.equal(typeof sample.load15, "number");
  assert.equal(typeof sample.cpuCount, "number");
  assert.ok(sample.cpuCount >= 1);
  assert.deepEqual(Object.keys(sample).sort(), ["cpuCount", "load1", "load15", "load5"]);
});

test("load1 at or under 3x cpuCount is not overloaded", () => {
  assert.equal(isHostOverloaded([{ load1: 30, cpuCount: 10 }]), false);
  assert.equal(isHostOverloaded([{ load1: 30.0001, cpuCount: 10 }]), true);
});

test("uses the MAX load1 seen across multiple samples (tier0 start, tier1 start), not just the last one", () => {
  const samples = [
    { load1: 5, cpuCount: 10 },
    { load1: 31, cpuCount: 10 },
  ];
  assert.equal(isHostOverloaded(samples), true);
  assert.equal(isHostOverloaded(samples.slice().reverse()), true);
});

test("reproduces the 2026-09-27 incident's own numbers: load ~144 on 10 cores is overloaded", () => {
  assert.equal(isHostOverloaded([{ load1: 144, cpuCount: 10 }]), true);
});

test("a null/missing sample (tier1 never started, e.g. tier0 failed first) never throws and reports not overloaded", () => {
  assert.equal(isHostOverloaded([null, null]), false);
  assert.equal(isHostOverloaded([{ load1: 5, cpuCount: 10 }, null]), false);
});

test("a missing cpuCount on every sample reports not overloaded rather than dividing by zero/NaN", () => {
  assert.equal(isHostOverloaded([{ load1: 999 }]), false);
});

test("a custom threshold multiplier is honored", () => {
  assert.equal(isHostOverloaded([{ load1: 21, cpuCount: 10 }], 2), true);
  assert.equal(isHostOverloaded([{ load1: 19, cpuCount: 10 }], 2), false);
});
