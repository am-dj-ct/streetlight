// Bounded-timeout wrapper around the repo's existing
// scripts/send-resend-email.mjs (R13). ~15s timeout per attempt, up to 2
// retries on network/429/5xx — never an unbounded fetch. Config errors
// (missing env vars) are never retried; retrying can't fix those.
import { spawn } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SEND_SCRIPT = fileURLToPath(new URL("../../send-resend-email.mjs", import.meta.url));

function runOnce(subject, bodyPath, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    const child = spawn(process.execPath, [SEND_SCRIPT, "--subject", subject, "--body", bodyPath], {
      env: process.env,
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      if (!settled) child.kill("SIGKILL");
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (code) => {
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
    child.on("error", (error) => {
      settled = true;
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: String(error) });
    });
  });
}

function parseHttpStatus(stderr) {
  const match = stderr.match(/Resend email failed: (\d+)/);
  return match ? Number(match[1]) : null;
}

function isConfigError(stderr) {
  return /is required\./.test(stderr);
}

export async function sendReportEmail({ subject, bodyText, timeoutMs = 15_000, maxRetries = 2 }) {
  const tmpPath = path.join(os.tmpdir(), `ui-sentry-email-${Date.now()}-${process.pid}.txt`);
  writeFileSync(tmpPath, bodyText, "utf8");

  try {
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      // eslint-disable-next-line no-await-in-loop
      const result = await runOnce(subject, tmpPath, timeoutMs);

      if (result.code === 0) {
        return { accepted: true, httpStatus: 200, attempts: attempt + 1 };
      }

      const httpStatus = parseHttpStatus(result.stderr);
      const configError = isConfigError(result.stderr);
      const retryable = !configError && (httpStatus === 429 || (httpStatus ?? 0) >= 500 || httpStatus === null);

      if (!retryable || attempt === maxRetries) {
        return {
          accepted: false,
          httpStatus,
          attempts: attempt + 1,
          error: result.stderr.trim().slice(0, 300) || result.stdout.trim().slice(0, 300),
        };
      }
    }
  } finally {
    try {
      unlinkSync(tmpPath);
    } catch {
      // Best-effort cleanup; a stray temp file is not a failure condition.
    }
  }

  return { accepted: false, httpStatus: null, attempts: maxRetries + 1, error: "unreachable" };
}
