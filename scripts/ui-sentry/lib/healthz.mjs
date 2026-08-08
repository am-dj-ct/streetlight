// Fetches and parses the public, content-free /healthz contract. Used for
// the tier 0 gate and for tier 2's 503 paused-vs-broken recheck (R3).
export async function fetchHealthz(baseUrl, { timeoutMs = 15_000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(new URL("/healthz", baseUrl), {
      signal: controller.signal,
      cache: "no-store",
    });
    const status = response.status;
    let body = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    return { reachable: true, httpStatus: status, body };
  } catch (error) {
    return { reachable: false, httpStatus: null, body: null, error: String(error).slice(0, 200) };
  } finally {
    clearTimeout(timer);
  }
}

export function healthzLooksOk(healthz) {
  const body = healthz.body;
  return Boolean(
    healthz.reachable &&
      healthz.httpStatus === 200 &&
      body &&
      body.ok === true &&
      body.deployEnv === "production" &&
      body.chatMode === "live-model" &&
      body.deployConfigOk === true,
  );
}
