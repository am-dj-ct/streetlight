// Builds the content-free email body and subject. Plain text, visually
// plain (Jesse's standing rule for generated email — no colored boxes, no
// explainer paragraphs). Tier table only: case names, HTTP statuses,
// latencies, durations, and the log path on disk. Never a typed prompt or
// a model reply (data_architecture.md:754 precedent — the recall suite
// prints only synthetic case names and category results, never content).

// tier0/tier1/tier2 may be null — a crash or signal can reach the finalizer
// before a tier ever produced a result. Null is always treated as a fail,
// never silently skipped, so a crash can never be reported as green.
export function computeOverallLevel({ tier0, tier1, tier2 }) {
  if (!tier0 || tier0.status === "fail") {
    return { level: "FAIL", siteDown: tier0?.reason === "site_down" };
  }
  if (!tier1 || tier1.status === "fail") {
    return { level: "FAIL", siteDown: false };
  }
  if (!tier2 || tier2.status === "fail") {
    return { level: "FAIL", siteDown: false };
  }
  if (tier2.status === "blocked") {
    return { level: "DEGRADED", siteDown: false };
  }
  return { level: "PASS", siteDown: false };
}

export function buildSubject({ level, siteDown, escalatedFromBlocked }) {
  if (level === "FAIL" && siteDown) {
    return "Streetlight UI sentry: FAIL (site down)";
  }
  if (level === "FAIL" && escalatedFromBlocked) {
    return "Streetlight UI sentry: FAIL (chat blocked 3 runs running)";
  }
  if (level === "DEGRADED") {
    return "Streetlight UI sentry: DEGRADED (chat blocked)";
  }
  return `Streetlight UI sentry: ${level}`;
}

function fmtCase(c, indent = "  ") {
  const parts = [`${c.status.toUpperCase()}`, c.name];
  if (c.httpStatus !== undefined && c.httpStatus !== null) parts.push(`http=${c.httpStatus}`);
  if (c.latencyMs !== undefined && c.latencyMs !== null) parts.push(`${c.latencyMs}ms`);
  if (c.durationMs !== undefined && c.durationMs !== null) parts.push(`${c.durationMs}ms`);
  if (c.detail) parts.push(c.detail);
  if (c.error) parts.push(`error: ${c.error}`);
  return `${indent}${parts.join(" | ")}`;
}

export function buildEmailBody(state) {
  const lines = [];
  lines.push(`Streetlight UI sentry — ${state.overallLevel}`);
  lines.push(`Run: ${state.startedAt} -> ${state.finishedAt}`);
  lines.push(`Log: ${state.logPath}`);
  lines.push("");

  lines.push(`Tier 0 — health gate: ${state.tier0.status}`);
  for (const c of state.tier0.cases ?? []) lines.push(fmtCase(c));
  lines.push("");

  if (state.tier1) {
    lines.push(`Tier 1 — structural (chromium-desktop + webkit-mobile): ${state.tier1.status}`);
    for (const engineResult of state.tier1.engines ?? []) {
      for (const c of engineResult.cases) lines.push(fmtCase(c));
      lines.push(
        `  ${engineResult.engine} cold-load perf: LCP=${engineResult.perf?.lcpMs != null ? Math.round(engineResult.perf.lcpMs) + "ms" : "n/a"} CLS=${engineResult.perf?.cls != null ? engineResult.perf.cls.toFixed(3) : "n/a"} (warn-only)`,
      );
    }
    const allWarnings = (state.tier1.engines ?? []).flatMap((e) => e.warnings ?? []);
    if (allWarnings.length > 0) {
      lines.push("  Warnings:");
      for (const w of allWarnings) lines.push(`    - ${w}`);
    }
  } else {
    lines.push("Tier 1 — structural: skipped (tier 0 failed)");
  }
  lines.push("");

  if (state.tier2) {
    lines.push(`Tier 2 — live chat (best-effort): ${state.tier2.status}`);
    for (const t of state.tier2.turns) {
      const parts = [`turn ${t.n}`, t.label];
      if (t.httpStatus !== null && t.httpStatus !== undefined) parts.push(`http=${t.httpStatus}`);
      if (t.ttftMs !== null && t.ttftMs !== undefined) parts.push(`ttft=${t.ttftMs}ms`);
      if (t.totalMs !== null && t.totalMs !== undefined) parts.push(`total=${t.totalMs}ms`);
      lines.push(`  ${parts.join(" | ")}`);
    }
    lines.push(`  Turn budget used: ${state.tier2.turnBudgetUsed}/${state.tier2.turnBudgetCap}`);
    lines.push(`  Last successful live chat (this run): ${state.tier2.lastSuccessfulLiveChatAt ?? "none"}`);
    lines.push(`  Last successful live chat (overall): ${state.lastSuccessfulLiveChatAt ?? "none recorded"}`);
    lines.push(`  Consecutive blocked runs: ${state.consecutiveBlockedRuns}`);
  } else {
    lines.push(
      `Tier 2 — live chat: skipped (${state.tier0.status === "fail" ? "tier 0 failed" : "tier 1 failed"})`,
    );
  }
  lines.push("");
  lines.push(`Exit code: ${state.exitCode}`);

  return lines.join("\n");
}
