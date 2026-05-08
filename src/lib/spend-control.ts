import { kv } from "@vercel/kv";
import {
  getClassifierModelInputCostPerMillionUsd,
  getClassifierModelOutputCostPerMillionUsd,
  getDailySpendLimitUsd,
  getMainModelInputCostPerMillionUsd,
  getMainModelOutputCostPerMillionUsd,
  hasKvConfig,
} from "./env";

type UsageShape = {
  cache_creation_input_tokens?: null | number;
  cache_read_input_tokens?: null | number;
  input_tokens?: null | number;
  output_tokens?: number;
};

type SpendLimitResult =
  | {
      allowed: true;
      limitUsd: null | number;
      currentSpendUsd: number;
      resetInSeconds: number;
      reason: "allowed" | "disabled";
    }
  | {
      allowed: false;
      limitUsd: number;
      currentSpendUsd: number;
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

function calculateUsageCostUsd(
  usage: UsageShape,
  inputCostPerMillionUsd: number,
  outputCostPerMillionUsd: number,
): number {
  const inputTokens =
    (usage.input_tokens ?? 0) +
    (usage.cache_creation_input_tokens ?? 0) +
    (usage.cache_read_input_tokens ?? 0);
  const outputTokens = usage.output_tokens ?? 0;

  return (
    (inputTokens / 1_000_000) * inputCostPerMillionUsd +
    (outputTokens / 1_000_000) * outputCostPerMillionUsd
  );
}

function hasSpendConfig(): boolean {
  return Boolean(
    hasKvConfig() &&
      getDailySpendLimitUsd() !== null &&
      getMainModelInputCostPerMillionUsd() !== null &&
      getMainModelOutputCostPerMillionUsd() !== null &&
      getClassifierModelInputCostPerMillionUsd() !== null &&
      getClassifierModelOutputCostPerMillionUsd() !== null,
  );
}

export async function checkDailySpendCap(): Promise<SpendLimitResult> {
  const now = new Date();
  const resetInSeconds = getSecondsUntilUtcMidnight(now);
  const limitUsd = getDailySpendLimitUsd();

  if (!hasSpendConfig() || limitUsd === null) {
    return {
      allowed: true,
      limitUsd,
      currentSpendUsd: 0,
      resetInSeconds,
      reason: "disabled",
    };
  }

  const key = `daily-spend:${getUtcDateKey(now)}`;
  const currentSpendUsd = Number(
    (await kv.get<string | number>(key).catch(() => 0)) ?? 0,
  );

  if (currentSpendUsd >= limitUsd) {
    return {
      allowed: false,
      limitUsd,
      currentSpendUsd,
      resetInSeconds,
      reason: "limit_reached",
    };
  }

  return {
    allowed: true,
    limitUsd,
    currentSpendUsd,
    resetInSeconds,
    reason: "allowed",
  };
}

export async function recordDailySpendUsd({
  classifierUsage,
  mainUsage,
}: {
  classifierUsage: UsageShape;
  mainUsage: UsageShape;
}): Promise<null | {
  classifierCostUsd: number;
  mainCostUsd: number;
  totalCostUsd: number;
}> {
  if (!hasSpendConfig()) {
    return null;
  }

  const mainInputCostPerMillionUsd = getMainModelInputCostPerMillionUsd();
  const mainOutputCostPerMillionUsd = getMainModelOutputCostPerMillionUsd();
  const classifierInputCostPerMillionUsd = getClassifierModelInputCostPerMillionUsd();
  const classifierOutputCostPerMillionUsd = getClassifierModelOutputCostPerMillionUsd();

  if (
    mainInputCostPerMillionUsd === null ||
    mainOutputCostPerMillionUsd === null ||
    classifierInputCostPerMillionUsd === null ||
    classifierOutputCostPerMillionUsd === null
  ) {
    return null;
  }

  const mainCostUsd = calculateUsageCostUsd(
    mainUsage,
    mainInputCostPerMillionUsd,
    mainOutputCostPerMillionUsd,
  );
  const classifierCostUsd = calculateUsageCostUsd(
    classifierUsage,
    classifierInputCostPerMillionUsd,
    classifierOutputCostPerMillionUsd,
  );
  const totalCostUsd = mainCostUsd + classifierCostUsd;
  const now = new Date();
  const key = `daily-spend:${getUtcDateKey(now)}`;
  const resetInSeconds = getSecondsUntilUtcMidnight(now);
  let nextValue: number;

  try {
    nextValue = await kv.incrbyfloat(key, totalCostUsd);
  } catch {
    return null;
  }

  if (totalCostUsd > 0 && nextValue === totalCostUsd) {
    await kv.expire(key, resetInSeconds).catch(() => undefined);
  }

  return {
    classifierCostUsd,
    mainCostUsd,
    totalCostUsd,
  };
}
