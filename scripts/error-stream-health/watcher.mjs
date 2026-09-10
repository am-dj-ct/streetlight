import { readFile } from "node:fs/promises";

export function decideWatcher(artifact) {
  if (artifact?.status === "ok") {
    return {
      checkinStatus: "green",
      reasonCode: "ok",
      action: "none",
      exitCode: 0,
    };
  }

  if (artifact?.status === "failed") {
    return {
      checkinStatus: "red",
      reasonCode: "degraded",
      action: "none",
      exitCode: 2,
    };
  }

  const consecutiveFailures = artifact?.consecutiveFailures;
  if (artifact?.status === "error" && Number.isInteger(consecutiveFailures) && consecutiveFailures === 1) {
    return {
      checkinStatus: "yellow",
      reasonCode: "degraded",
      action: "rerun_once",
      exitCode: 0,
    };
  }

  return {
    checkinStatus: "red",
    reasonCode: "job_failed",
    action: "escalate",
    exitCode: 1,
  };
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const artifact = JSON.parse(await readFile(process.argv[2], "utf8"));
  const decision = decideWatcher(artifact);
  process.stdout.write([
    decision.checkinStatus,
    decision.reasonCode,
    decision.action,
    decision.exitCode,
    artifact.status ?? "unknown",
    artifact.reason ?? "unknown",
    artifact.upstreamStatus ?? "null",
    artifact.upstreamLatencyMs ?? "null",
    artifact.attempts ?? "null",
    artifact.consecutiveFailures ?? "null",
  ].join("\t"));
}
