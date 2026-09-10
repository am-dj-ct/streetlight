import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export const WINDOW_MINUTES = 60;
export const ERROR_RATE_THRESHOLD = 0.5;
export const RETRY_DELAY_MS = 20_000;

function count(value, field) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`invalid_${field}`);
  }
  return value;
}

export function evaluateHealth(payload, generatedAt = new Date().toISOString(), telemetry = {}) {
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
    upstreamStatus: telemetry.upstreamStatus ?? null,
    upstreamLatencyMs: telemetry.upstreamLatencyMs ?? null,
    attempts: telemetry.attempts ?? 1,
  };
}

export function errorArtifact(failureCode, generatedAt = new Date().toISOString(), details = {}) {
  return {
    schemaVersion: 1,
    source: "streetlight-error-stream-health",
    generatedAt,
    status: "error",
    failureCode,
    reason: details.reason ?? failureCode,
    windowMinutes: WINDOW_MINUTES,
    totalInteractions: null,
    errorStreamCount: null,
    errorStreamRate: null,
    threshold: ERROR_RATE_THRESHOLD,
    upstreamStatus: details.upstreamStatus ?? null,
    upstreamLatencyMs: details.upstreamLatencyMs ?? null,
    attempts: details.attempts ?? 1,
    retryAttempted: details.retryAttempted ?? false,
    retryDelayMs: details.retryDelayMs ?? 0,
    consecutiveFailures: details.consecutiveFailures ?? null,
    watcherAction: details.watcherAction ?? null,
  };
}

export async function readOperationalState(statePath) {
  try {
    const state = JSON.parse(await readFile(statePath, "utf8"));
    if (!Number.isInteger(state?.consecutiveFailures) || state.consecutiveFailures < 0) {
      return { consecutiveFailures: 0 };
    }
    return state;
  } catch {
    return { consecutiveFailures: 0 };
  }
}

export function operationalState({ status, reason = null, consecutiveFailures }, updatedAt) {
  return {
    schemaVersion: 1,
    source: "streetlight-error-stream-health",
    updatedAt,
    status,
    reason,
    consecutiveFailures,
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

export const writeOperationalStateAtomic = writeArtifactAtomic;
