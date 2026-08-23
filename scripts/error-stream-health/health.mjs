import { chmod, mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export const WINDOW_MINUTES = 60;
export const ERROR_RATE_THRESHOLD = 0.5;

function count(value, field) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`invalid_${field}`);
  }
  return value;
}

export function evaluateHealth(payload, generatedAt = new Date().toISOString()) {
  const windowMinutes = count(payload?.windowMinutes, "window_minutes");
  const totalInteractions = count(payload?.totalInteractions, "total_interactions");
  const errorStreamCount = count(payload?.errorStreamCount, "error_stream_count");

  if (windowMinutes !== WINDOW_MINUTES) throw new Error("unexpected_window_minutes");
  if (errorStreamCount > totalInteractions) throw new Error("errors_exceed_total");

  const errorStreamRate = totalInteractions === 0 ? 0 : errorStreamCount / totalInteractions;
  const spike = totalInteractions > 0 && errorStreamRate > ERROR_RATE_THRESHOLD;

  return {
    schemaVersion: 1,
    source: "streetlight-error-stream-health",
    generatedAt,
    status: spike ? "failed" : "ok",
    windowMinutes,
    totalInteractions,
    errorStreamCount,
    errorStreamRate,
    threshold: ERROR_RATE_THRESHOLD,
  };
}

export function errorArtifact(failureCode, generatedAt = new Date().toISOString()) {
  return {
    schemaVersion: 1,
    source: "streetlight-error-stream-health",
    generatedAt,
    status: "error",
    failureCode,
    windowMinutes: WINDOW_MINUTES,
    totalInteractions: null,
    errorStreamCount: null,
    errorStreamRate: null,
    threshold: ERROR_RATE_THRESHOLD,
  };
}

export async function writeArtifactAtomic(outputPath, artifact) {
  await mkdir(path.dirname(outputPath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${outputPath}.tmp-${process.pid}`;
  await writeFile(temporaryPath, `${JSON.stringify(artifact, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporaryPath, outputPath);
  await chmod(outputPath, 0o600);
}

