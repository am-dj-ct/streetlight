import { createHash, timingSafeEqual } from "node:crypto";
import { kv } from "@vercel/kv";
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
    const reserved = await kv.eval(
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
