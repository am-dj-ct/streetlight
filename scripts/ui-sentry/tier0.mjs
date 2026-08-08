// Tier 0 — health gate. Browser preflight (R11), then GET / (site-up, 3
// bounded attempts), then GET /healthz requiring ok=true,
// deployEnv=production, chatMode=live-model, deployConfigOk=true. Fail here
// skips everything else.
import { fetchHealthz, healthzLooksOk } from "./lib/healthz.mjs";
import { checkBrowsersInstalled } from "./lib/preflight.mjs";

async function curlRootOnce(baseUrl, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  try {
    const response = await fetch(baseUrl, { signal: controller.signal, cache: "no-store" });
    return { ok: response.status === 200, status: response.status, latencyMs: Date.now() - startedAt };
  } catch (error) {
    return { ok: false, status: null, latencyMs: Date.now() - startedAt, error: String(error).slice(0, 200) };
  } finally {
    clearTimeout(timer);
  }
}

export async function runTier0({ baseUrl, logger }) {
  const preflight = await checkBrowsersInstalled();
  logger.line(`tier0 browser preflight: ok=${preflight.ok} missing=${preflight.missing.join(",") || "none"}`);
  if (!preflight.ok) {
    return {
      status: "fail",
      reason: "browsers_not_installed",
      siteUp: null,
      healthz: null,
      cases: [
        {
          name: "browser preflight",
          status: "fail",
          error: `missing browsers: ${preflight.missing.join(", ")} — run install.sh, never downloaded at run time`,
        },
      ],
    };
  }

  let siteUp = false;
  let lastAttempt = null;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    lastAttempt = await curlRootOnce(baseUrl, 15_000);
    logger.line(
      `tier0 site-up attempt ${attempt}/3: status=${lastAttempt.status ?? "none"} latencyMs=${lastAttempt.latencyMs}`,
    );
    if (lastAttempt.ok) {
      siteUp = true;
      break;
    }
    if (attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, 5_000));
    }
  }

  if (!siteUp) {
    logger.line("tier0 SITE DOWN: root URL unreachable after 3 attempts");
    return {
      status: "fail",
      reason: "site_down",
      siteUp: false,
      healthz: null,
      cases: [
        {
          name: "site-up (GET /)",
          status: "fail",
          httpStatus: lastAttempt?.status ?? null,
          latencyMs: lastAttempt?.latencyMs ?? null,
        },
      ],
    };
  }

  const healthzStartedAt = Date.now();
  const healthz = await fetchHealthz(baseUrl);
  const healthzLatencyMs = Date.now() - healthzStartedAt;
  const healthzOk = healthzLooksOk(healthz);

  logger.line(
    `tier0 healthz: reachable=${healthz.reachable} httpStatus=${healthz.httpStatus ?? "none"} ` +
      `ok=${healthz.body?.ok ?? "n/a"} deployEnv=${healthz.body?.deployEnv ?? "n/a"} ` +
      `chatMode=${healthz.body?.chatMode ?? "n/a"} deployConfigOk=${healthz.body?.deployConfigOk ?? "n/a"} ` +
      `latencyMs=${healthzLatencyMs}`,
  );

  return {
    status: healthzOk ? "pass" : "fail",
    reason: healthzOk ? null : "healthz_not_ok",
    siteUp: true,
    healthz,
    cases: [
      {
        name: "site-up (GET /)",
        status: "pass",
        httpStatus: lastAttempt.status,
        latencyMs: lastAttempt.latencyMs,
      },
      {
        name: "healthz gate",
        status: healthzOk ? "pass" : "fail",
        httpStatus: healthz.httpStatus,
        latencyMs: healthzLatencyMs,
      },
    ],
  };
}
