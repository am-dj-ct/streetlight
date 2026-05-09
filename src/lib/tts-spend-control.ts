import { kv } from "@vercel/kv";
import {
  getTtsDailyCharacterLimit,
  hasKvConfig,
} from "./env";

type TtsCharacterLimitResult =
  | {
      allowed: true;
      limit: null | number;
      resetInSeconds: number;
      reason: "allowed" | "disabled";
    }
  | {
      allowed: false;
      limit: number;
      resetInSeconds: number;
      reason: "limit_reached";
    };

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

export async function reserveTtsCharactersForToday(
  characterCount: number,
): Promise<TtsCharacterLimitResult> {
  const now = new Date();
  const limit = getTtsDailyCharacterLimit();
  const resetInSeconds = getSecondsUntilUtcMidnight(now);

  if (!hasKvConfig() || limit === null) {
    return {
      allowed: true,
      limit,
      resetInSeconds,
      reason: "disabled",
    };
  }

  const key = `daily-tts-chars:${getUtcDateKey(now)}`;
  let nextCount: number;

  try {
    nextCount = await kv.incrbyfloat(key, characterCount);
  } catch {
    return {
      allowed: true,
      limit,
      resetInSeconds,
      reason: "disabled",
    };
  }

  if (nextCount === characterCount) {
    await kv.expire(key, resetInSeconds).catch(() => undefined);
  }

  if (nextCount > limit) {
    return {
      allowed: false,
      limit,
      resetInSeconds,
      reason: "limit_reached",
    };
  }

  return {
    allowed: true,
    limit,
    resetInSeconds,
    reason: "allowed",
  };
}
