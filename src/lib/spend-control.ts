import { kv } from "@vercel/kv";
import {
  getCheapestMainModel,
  getCheapestMainModelInputCostPerMillionUsd,
  getCheapestMainModelOutputCostPerMillionUsd,
  getClassifierModelInputCostPerMillionUsd,
  getClassifierModelOutputCostPerMillionUsd,
  getDailySpendLimitUsd,
  getFallbackMainModel,
  getFallbackMainModelInputCostPerMillionUsd,
  getFallbackMainModelOutputCostPerMillionUsd,
  getMainModelInputCostPerMillionUsd,
  getMainModelOutputCostPerMillionUsd,
  getOpenAiFallbackInputCostPerMillionUsd,
  getOpenAiFallbackOutputCostPerMillionUsd,
  hasKvConfig,
} from "./env";

type UsageShape = {
  cache_creation_input_tokens?: null | number;
  cache_read_input_tokens?: null | number;
  input_tokens?: null | number;
  output_tokens?: number;
  server_tool_use?: null | {
    web_fetch_requests?: null | number;
    web_search_requests?: null | number;
  };
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

export type MainModelTier = "primary" | "fallback" | "cheapest" | "openai_fallback";
export type AuxiliaryModelTier = "classifier" | "openai_fallback";

type MainModelSelectionResult =
  | {
      allowed: true;
      currentSpendUsd: number;
      limitUsd: null | number;
      model: string;
      resetInSeconds: number;
      reason: "allowed" | "disabled";
      tier: MainModelTier;
    }
  | {
      allowed: false;
      currentSpendUsd: number;
      limitUsd: number;
      resetInSeconds: number;
      reason: "limit_reached";
    };

const fallbackModelThreshold = 0.8;
const cheapestModelThreshold = 0.95;
const webSearchRequestCostUsd = 0.01;

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

function calculateServerToolCostUsd(usage: UsageShape): number {
  const webSearchRequests = usage.server_tool_use?.web_search_requests ?? 0;

  return webSearchRequests * webSearchRequestCostUsd;
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

function getConfiguredCostPair({
  input,
  output,
}: {
  input: null | number;
  output: null | number;
}): null | {
  inputCostPerMillionUsd: number;
  outputCostPerMillionUsd: number;
} {
  if (input === null || output === null) {
    return null;
  }

  return {
    inputCostPerMillionUsd: input,
    outputCostPerMillionUsd: output,
  };
}

function getMainModelCostPair(tier: MainModelTier) {
  const classifierCosts = getConfiguredCostPair({
    input: getClassifierModelInputCostPerMillionUsd(),
    output: getClassifierModelOutputCostPerMillionUsd(),
  });

  if (tier === "openai_fallback") {
    return getConfiguredCostPair({
      input: getOpenAiFallbackInputCostPerMillionUsd(),
      output: getOpenAiFallbackOutputCostPerMillionUsd(),
    });
  }

  if (tier === "primary") {
    return getConfiguredCostPair({
      input: getMainModelInputCostPerMillionUsd(),
      output: getMainModelOutputCostPerMillionUsd(),
    });
  }

  if (tier === "fallback") {
    return (
      getConfiguredCostPair({
        input: getFallbackMainModelInputCostPerMillionUsd(),
        output: getFallbackMainModelOutputCostPerMillionUsd(),
      }) ?? classifierCosts
    );
  }

  return (
    getConfiguredCostPair({
      input: getCheapestMainModelInputCostPerMillionUsd(),
      output: getCheapestMainModelOutputCostPerMillionUsd(),
    }) ?? classifierCosts
  );
}

function getAuxiliaryModelCostPair(tier: AuxiliaryModelTier) {
  if (tier === "openai_fallback") {
    return getConfiguredCostPair({
      input: getOpenAiFallbackInputCostPerMillionUsd(),
      output: getOpenAiFallbackOutputCostPerMillionUsd(),
    });
  }

  return getConfiguredCostPair({
    input: getClassifierModelInputCostPerMillionUsd(),
    output: getClassifierModelOutputCostPerMillionUsd(),
  });
}

async function getCurrentSpendUsd(key: string): Promise<number> {
  return Number((await kv.get<string | number>(key).catch(() => 0)) ?? 0);
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
  const currentSpendUsd = await getCurrentSpendUsd(key);

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

export async function selectMainModelForSpend({
  primaryModel,
}: {
  primaryModel: string;
}): Promise<MainModelSelectionResult> {
  const now = new Date();
  const resetInSeconds = getSecondsUntilUtcMidnight(now);
  const limitUsd = getDailySpendLimitUsd();

  if (!hasSpendConfig() || limitUsd === null) {
    return {
      allowed: true,
      currentSpendUsd: 0,
      limitUsd,
      model: primaryModel,
      resetInSeconds,
      reason: "disabled",
      tier: "primary",
    };
  }

  const key = `daily-spend:${getUtcDateKey(now)}`;
  const currentSpendUsd = await getCurrentSpendUsd(key);

  if (currentSpendUsd >= limitUsd) {
    return {
      allowed: false,
      currentSpendUsd,
      limitUsd,
      resetInSeconds,
      reason: "limit_reached",
    };
  }

  const spendRatio = limitUsd > 0 ? currentSpendUsd / limitUsd : 1;
  const cheapestModel = getCheapestMainModel();

  if (cheapestModel && spendRatio >= cheapestModelThreshold) {
    return {
      allowed: true,
      currentSpendUsd,
      limitUsd,
      model: cheapestModel,
      resetInSeconds,
      reason: "allowed",
      tier: "cheapest",
    };
  }

  if (spendRatio >= fallbackModelThreshold) {
    return {
      allowed: true,
      currentSpendUsd,
      limitUsd,
      model: getFallbackMainModel(),
      resetInSeconds,
      reason: "allowed",
      tier: "fallback",
    };
  }

  return {
    allowed: true,
    currentSpendUsd,
    limitUsd,
    model: primaryModel,
    resetInSeconds,
    reason: "allowed",
    tier: "primary",
  };
}

export async function recordDailySpendUsd({
  classifierModelTier = "classifier",
  classifierUsage,
  mainModelTier,
  mainUsage,
  suggestionsModelTier = "classifier",
  suggestionsUsage,
}: {
  classifierModelTier?: AuxiliaryModelTier;
  classifierUsage: UsageShape;
  mainModelTier: MainModelTier;
  mainUsage: UsageShape;
  suggestionsModelTier?: AuxiliaryModelTier;
  suggestionsUsage?: null | UsageShape;
}): Promise<null | {
  classifierCostUsd: number;
  mainCostUsd: number;
  suggestionsCostUsd: number;
  totalCostUsd: number;
}> {
  if (!hasSpendConfig()) {
    return null;
  }

  const mainCostPair = getMainModelCostPair(mainModelTier);
  const classifierCostPair = getAuxiliaryModelCostPair(classifierModelTier);
  const suggestionsCostPair = getAuxiliaryModelCostPair(suggestionsModelTier);

  if (
    mainCostPair === null ||
    classifierCostPair === null ||
    suggestionsCostPair === null
  ) {
    return null;
  }

  const mainCostUsd = calculateUsageCostUsd(
    mainUsage,
    mainCostPair.inputCostPerMillionUsd,
    mainCostPair.outputCostPerMillionUsd,
  );
  const serverToolCostUsd = calculateServerToolCostUsd(mainUsage);
  const classifierCostUsd = calculateUsageCostUsd(
    classifierUsage,
    classifierCostPair.inputCostPerMillionUsd,
    classifierCostPair.outputCostPerMillionUsd,
  );
  const suggestionsCostUsd = suggestionsUsage
    ? calculateUsageCostUsd(
        suggestionsUsage,
        suggestionsCostPair.inputCostPerMillionUsd,
        suggestionsCostPair.outputCostPerMillionUsd,
      )
    : 0;
  const totalCostUsd =
    mainCostUsd + serverToolCostUsd + classifierCostUsd + suggestionsCostUsd;
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
    mainCostUsd: mainCostUsd + serverToolCostUsd,
    suggestionsCostUsd,
    totalCostUsd,
  };
}
