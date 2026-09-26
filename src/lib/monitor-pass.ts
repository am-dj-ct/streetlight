import { createHash, timingSafeEqual } from "node:crypto";
import { createClient, type VercelKV } from "@vercel/kv";
import { getMonitorToken, hasKvConfig } from "./env";

export const monitorTokenHeader = "x-streetlight-monitor-token";
export const monitorPassDailyCap = 12;

// One atomic reservation, including expiry. No credential or per-user data
// reaches KV. Refused reservations do not increment beyond the cap.
const reservePassScript = `
local count = tonumber(redis.call('GET', KEYS[1]) or '0')
if not count or count < 0 or count ~= math.floor(count) then return 0 end
if count >= tonumber(ARGV[1]) then return 0 end
redis.call('INCR', KEYS[1])
redis.call('EXPIREAT', KEYS[1], ARGV[2])
return 1
`;

// A separate, retry-disabled client for THIS ONE reservation script only
// (2nd cross-vendor review, 2026-09-26). The shared `kv` singleton retries
// automatically on network errors (an @upstash/redis default), which is
// fine for idempotent reads elsewhere in the app but wrong here:
// reservePassScript's INCR is not idempotent — if Redis executes it and
// only the HTTP response carrying the result back to us is lost, a retry
// of the exact same logical call increments the counter a second time. An
// offline probe reproduced two reservations for one logical call this
// way. Disabling retries for this call means a lost response is reported
// as a failure (falling back to normal Turnstile, per the ADR's threat
// model) instead of risking a silent double reservation. Every other `kv`
// usage in this app keeps the shared client's normal retry behavior,
// unchanged — this constructs its own client from the same env
// configuration rather than touching that shared one.
let monitorPassKv: VercelKV | null = null;
function monitorPassClient(): VercelKV {
  if (!monitorPassKv) {
    monitorPassKv = createClient({
      url: process.env.KV_REST_API_URL,
      token: process.env.KV_REST_API_TOKEN,
      // `retry: false` is NOT "zero retries" in this client: its own retry
      // loop runs `i <= attempts` and `false` maps to `attempts: 1`, which
      // still allows one retry (two total attempts) on a network-level
      // failure — verified directly against the installed
      // @upstash/redis version and reproduced by a test that counts actual
      // fetch calls. `{ retries: 0 }` is what actually yields exactly one
      // attempt.
      retry: { retries: 0 },
    });
  }
  return monitorPassKv;
}

export async function consumeMonitorPass(request: Request): Promise<boolean> {
  if (request.method !== "POST" || new URL(request.url).pathname !== "/api/chat") {
    return false;
  }
  const expected = getMonitorToken();
  const candidate = request.headers.get(monitorTokenHeader);
  if (!expected || !candidate || !hasKvConfig()) return false;

  // Fixed-size digests keep the comparison constant-time even across lengths.
  if (!timingSafeEqual(
    createHash("sha256").update(expected).digest(),
    createHash("sha256").update(candidate).digest(),
  )) return false;

  const now = new Date();
  const expiresAt = Math.floor(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1,
  ) / 1000) + 60;
  try {
    const reserved = await monitorPassClient().eval(
      reservePassScript,
      [`monitor-pass:${now.toISOString().slice(0, 10)}`],
      [monitorPassDailyCap, expiresAt],
    );
    return reserved === 1;
  } catch {
    // Never log SDK errors: they may include request details. Normal
    // Turnstile remains the authority when reservation cannot be confirmed.
    return false;
  }
}
