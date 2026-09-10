#!/usr/bin/env node
import os from "node:os";
import path from "node:path";
import {
  RETRY_DELAY_MS,
  evaluateHealth,
  errorArtifact,
  operationalState,
  readOperationalState,
  writeArtifactAtomic,
  writeOperationalStateAtomic,
  WINDOW_MINUTES,
} from "./health.mjs";

const baseUrl = process.env.STREETLIGHT_BASE_URL ?? "https://streetlight.help";
const opsReadToken = process.env.OPS_READ_TOKEN;
const outputPath = process.env.STREETLIGHT_ERROR_STREAM_HEALTH_ARTIFACT
  ?? path.join(os.homedir(), ".blt-hub", "source-health", "streetlight-error-stream-health.json");
const statePath = process.env.STREETLIGHT_ERROR_STREAM_HEALTH_STATE_FILE
  ?? path.join(os.homedir(), ".streetlight", "error-stream-health", "state.json");

const configuredRetryDelay = Number(process.env.STREETLIGHT_ERROR_STREAM_HEALTH_RETRY_DELAY_MS);
const retryDelayMs = Number.isFinite(configuredRetryDelay) && configuredRetryDelay >= 0
  ? configuredRetryDelay
  : RETRY_DELAY_MS;

function httpFailure(status) {
  if (status === 401 || status === 403) {
    return { reason: "auth_failed", failureCode: `http_${status}`, transient: false };
  }
  if (status === 408 || status === 425) {
    return { reason: "upstream_timeout", failureCode: `http_${status}`, transient: true };
  }
  if (status === 429) {
    return { reason: "rate_limited", failureCode: "http_429", transient: true };
  }
  if (status >= 500 && status <= 599) {
    return { reason: "upstream_5xx", failureCode: `http_${status}`, transient: true };
  }
  return { reason: "upstream_http_error", failureCode: `http_${status}`, transient: false };
}

function fetchFailure(error) {
  if (error?.name === "TimeoutError" || error?.name === "AbortError") {
    return { reason: "request_timeout", failureCode: "request_timeout", transient: true };
  }
  return { reason: "network_error", failureCode: "request_failed", transient: true };
}

function validationFailure(error) {
  const message = String(error?.message ?? "");
  return {
    reason: "invalid_response",
    failureCode: message.startsWith("invalid_") || ["unexpected_window_minutes", "errors_exceed_total"].includes(message)
      ? "invalid_response"
      : "request_failed",
    transient: false,
  };
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function fetchHealth(url) {
  const startedAt = performance.now();
  let response;
  try {
    response = await fetch(url, {
      headers: { authorization: `Bearer ${opsReadToken}`, accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    return {
      ok: false,
      ...fetchFailure(error),
      upstreamStatus: null,
      upstreamLatencyMs: Math.round(performance.now() - startedAt),
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      ...httpFailure(response.status),
      upstreamStatus: response.status,
      upstreamLatencyMs: Math.round(performance.now() - startedAt),
    };
  }

  let body;
  try {
    body = await response.text();
  } catch (error) {
    return {
      ok: false,
      ...fetchFailure(error),
      upstreamStatus: response.status,
      upstreamLatencyMs: Math.round(performance.now() - startedAt),
    };
  }
  if (body.trim() === "") {
    return {
      ok: false,
      reason: "empty_response",
      failureCode: "empty_response",
      transient: true,
      upstreamStatus: response.status,
      upstreamLatencyMs: Math.round(performance.now() - startedAt),
    };
  }

  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    return {
      ok: false,
      reason: "invalid_response",
      failureCode: "invalid_response",
      transient: false,
      upstreamStatus: response.status,
      upstreamLatencyMs: Math.round(performance.now() - startedAt),
    };
  }

  try {
    return {
      ok: true,
      artifact: evaluateHealth(payload, new Date().toISOString(), {
        upstreamStatus: response.status,
        upstreamLatencyMs: Math.round(performance.now() - startedAt),
      }),
      upstreamStatus: response.status,
      upstreamLatencyMs: Math.round(performance.now() - startedAt),
    };
  } catch (error) {
    return {
      ok: false,
      ...validationFailure(error),
      upstreamStatus: response.status,
      upstreamLatencyMs: Math.round(performance.now() - startedAt),
    };
  }
}

let artifact;
let exitCode;
const attempts = [];
const observedAt = new Date().toISOString();

if (!opsReadToken) {
  attempts.push({
    reason: "missing_ops_token",
    failureCode: "missing_ops_token",
    transient: false,
    upstreamStatus: null,
    upstreamLatencyMs: null,
  });
} else {
  const url = new URL("/api/ops/error-stream-health", baseUrl);
  url.searchParams.set("windowMinutes", String(WINDOW_MINUTES));
  attempts.push(await fetchHealth(url));
  if (!attempts[0].ok && attempts[0].transient) {
    await sleep(retryDelayMs);
    attempts.push(await fetchHealth(url));
  }
}

const finalAttempt = attempts.at(-1);
const previousState = await readOperationalState(statePath);

if (finalAttempt.ok) {
  const consecutiveFailures = 0;
  artifact = {
    ...finalAttempt.artifact,
    attempts: attempts.length,
    consecutiveFailures,
    watcherAction: null,
  };
  exitCode = artifact.status === "failed" ? 2 : 0;
  await writeOperationalStateAtomic(
    statePath,
    operationalState({ status: artifact.status, consecutiveFailures }, artifact.generatedAt),
  );
} else {
  const consecutiveFailures = previousState.consecutiveFailures + 1;
  artifact = errorArtifact(finalAttempt.failureCode, observedAt, {
    reason: finalAttempt.reason,
    upstreamStatus: finalAttempt.upstreamStatus,
    upstreamLatencyMs: finalAttempt.upstreamLatencyMs,
    attempts: attempts.length,
    retryAttempted: attempts.length > 1,
    retryDelayMs: attempts.length > 1 ? retryDelayMs : 0,
    consecutiveFailures,
    watcherAction: consecutiveFailures >= 2 ? "escalate" : "rerun_once",
  });
  exitCode = consecutiveFailures >= 2 ? 1 : 0;
  await writeOperationalStateAtomic(
    statePath,
    operationalState({ status: artifact.status, reason: artifact.reason, consecutiveFailures }, artifact.generatedAt),
  );
}

await writeArtifactAtomic(outputPath, artifact);
process.stdout.write(`${JSON.stringify({
  status: artifact.status,
  reason: artifact.reason ?? null,
  upstreamStatus: artifact.upstreamStatus ?? null,
  upstreamLatencyMs: artifact.upstreamLatencyMs ?? null,
  attempts: artifact.attempts,
  consecutiveFailures: artifact.consecutiveFailures,
  totalInteractions: artifact.totalInteractions,
  errorStreamCount: artifact.errorStreamCount,
})}\n`);
process.exitCode = exitCode;
