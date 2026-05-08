import { createHash } from "node:crypto";
import { kv } from "@vercel/kv";
import { getHashedIpSalt, hasHashedIpSalt, hasKvConfig } from "./env";

const MAX_TURNS_PER_DAY = 100;

type RateLimitResult =
  | {
      allowed: true;
      limit: number;
      remaining: number;
      resetInSeconds: number;
      reason: "allowed" | "disabled";
    }
  | {
      allowed: false;
      limit: number;
      remaining: 0;
      resetInSeconds: number;
      reason: "limit_reached";
    };

export function getClientIp(request: Request): null | string {
  const forwardedFor = request.headers.get("x-forwarded-for");

  if (forwardedFor) {
    const firstIp = forwardedFor.split(",")[0]?.trim();

    if (firstIp) {
      return firstIp;
    }
  }

  const realIp = request.headers.get("x-real-ip")?.trim();

  if (realIp) {
    return realIp;
  }

  const vercelForwardedFor = request.headers.get("x-vercel-forwarded-for")?.trim();

  if (vercelForwardedFor) {
    return vercelForwardedFor;
  }

  return null;
}

function hashIp(ip: string): string {
  return createHash("sha256")
    .update(`${ip}:${getHashedIpSalt()}`)
    .digest("hex");
}

export function getHashedIp(request: Request): null | string {
  const ip = getClientIp(request);

  if (!ip || !hasHashedIpSalt()) {
    return null;
  }

  return hashIp(ip);
}

function getUtcDateKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function getSecondsUntilUtcMidnight(now: Date): number {
  const nextMidnight = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
    0,
    0,
    0,
    0,
  );

  return Math.max(1, Math.ceil((nextMidnight - now.getTime()) / 1000));
}

export async function checkPerIpRateLimit(
  request: Request,
): Promise<RateLimitResult> {
  if (!hasKvConfig()) {
    return {
      allowed: true,
      limit: MAX_TURNS_PER_DAY,
      remaining: MAX_TURNS_PER_DAY,
      resetInSeconds: 0,
      reason: "disabled",
    };
  }

  const ip = getClientIp(request);

  if (!ip) {
    return {
      allowed: true,
      limit: MAX_TURNS_PER_DAY,
      remaining: MAX_TURNS_PER_DAY,
      resetInSeconds: 0,
      reason: "disabled",
    };
  }

  const now = new Date();
  const resetInSeconds = getSecondsUntilUtcMidnight(now);
  const key = `rate-limit:${getUtcDateKey(now)}:${hashIp(ip)}`;
  let count: number;

  try {
    count = await kv.incr(key);
  } catch {
    return {
      allowed: true,
      limit: MAX_TURNS_PER_DAY,
      remaining: MAX_TURNS_PER_DAY,
      resetInSeconds,
      reason: "disabled",
    };
  }

  if (count === 1) {
    await kv.expire(key, resetInSeconds).catch(() => undefined);
  }

  if (count > MAX_TURNS_PER_DAY) {
    return {
      allowed: false,
      limit: MAX_TURNS_PER_DAY,
      remaining: 0,
      resetInSeconds,
      reason: "limit_reached",
    };
  }

  return {
    allowed: true,
    limit: MAX_TURNS_PER_DAY,
    remaining: Math.max(0, MAX_TURNS_PER_DAY - count),
    resetInSeconds,
    reason: "allowed",
  };
}
