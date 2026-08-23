#!/usr/bin/env node
import os from "node:os";
import path from "node:path";
import { evaluateHealth, errorArtifact, writeArtifactAtomic, WINDOW_MINUTES } from "./health.mjs";

const baseUrl = process.env.STREETLIGHT_BASE_URL ?? "https://streetlight.help";
const opsReadToken = process.env.OPS_READ_TOKEN;
const outputPath = process.env.STREETLIGHT_ERROR_STREAM_HEALTH_ARTIFACT
  ?? path.join(os.homedir(), ".blt-hub", "source-health", "streetlight-error-stream-health.json");

function failureCode(error) {
  if (error?.name === "TimeoutError" || error?.name === "AbortError") return "request_timeout";
  if (String(error?.message ?? "").startsWith("http_")) return String(error.message);
  if (String(error?.message ?? "").startsWith("invalid_")) return "invalid_response";
  if (["unexpected_window_minutes", "errors_exceed_total"].includes(error?.message)) return "invalid_response";
  return "request_failed";
}

let artifact;
let exitCode;

try {
  if (!opsReadToken) throw new Error("missing_ops_token");
  const url = new URL("/api/ops/error-stream-health", baseUrl);
  url.searchParams.set("windowMinutes", String(WINDOW_MINUTES));
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${opsReadToken}`, accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`http_${response.status}`);
  artifact = evaluateHealth(await response.json());
  exitCode = artifact.status === "failed" ? 2 : 0;
} catch (error) {
  artifact = errorArtifact(failureCode(error));
  exitCode = 1;
}

await writeArtifactAtomic(outputPath, artifact);
process.stdout.write(`${JSON.stringify({ status: artifact.status, totalInteractions: artifact.totalInteractions, errorStreamCount: artifact.errorStreamCount })}\n`);
process.exitCode = exitCode;

