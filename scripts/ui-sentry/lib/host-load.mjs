// Content-free host-load snapshot (2026-09-27): the 07:23 run that went red
// while the site itself was fine (load average ~144 on 10 cores, tier1's
// chromium-desktop page loads ~28s) had no evidence in last-run.json or the
// log of WHY the browser-driven checks were slow — only that they were.
// Two numbers only, both plain machine facts, never anything about what
// caused the load: os.loadavg()'s three floats and os.cpus().length.
import os from "node:os";

export function readHostLoad() {
  const [load1, load5, load15] = os.loadavg();
  return { load1, load5, load15, cpuCount: os.cpus().length };
}

// True when the largest 1-minute load average seen across the given samples
// (tier0 start, tier1 start — "the max seen") exceeds `thresholdMultiplier`
// times the CPU count. Never called on its own to decide red/green — the
// caller (orchestrator.mjs) only uses this to relabel an ALREADY-red tier1
// failure's reason, never to soften or hide one (see its own comment: the
// result stays red no matter what this returns).
export function isHostOverloaded(samples, thresholdMultiplier = 3) {
  const cpuCount = samples.find((s) => Number.isFinite(s?.cpuCount))?.cpuCount ?? null;
  if (!cpuCount) return false;
  const load1Values = samples
    .map((s) => s?.load1)
    .filter((value) => Number.isFinite(value));
  if (load1Values.length === 0) return false;
  const maxLoad1 = Math.max(...load1Values);
  return maxLoad1 > thresholdMultiplier * cpuCount;
}
