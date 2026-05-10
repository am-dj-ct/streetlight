function readEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function readOptionalEnv(name: string): null | string {
  const value = process.env[name]?.trim();

  return value || null;
}

function readOptionalBooleanEnv(name: string): boolean {
  const value = readOptionalEnv(name);

  if (!value?.trim()) {
    return false;
  }

  const trimmedValue = value.trim();

  if (trimmedValue !== "true" && trimmedValue !== "false") {
    throw new Error(`Invalid boolean environment variable: ${name}`);
  }

  return trimmedValue === "true";
}

function readOptionalNumberEnv(name: string): null | number {
  const value = readOptionalEnv(name);

  if (!value?.trim()) {
    return null;
  }

  const parsed = Number(value.trim());

  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Invalid non-negative numeric environment variable: ${name}`);
  }

  return parsed;
}

export function getAnthropicApiKey(): string {
  return readEnv("ANTHROPIC_API_KEY");
}

export function getMainModel(): string {
  return readEnv("MAIN_MODEL");
}

export function getClassifierModel(): string {
  return readEnv("CLASSIFIER_MODEL");
}

export function getFallbackMainModel(): string {
  return readOptionalEnv("FALLBACK_MAIN_MODEL") ?? getClassifierModel();
}

export function getCheapestMainModel(): null | string {
  return readOptionalEnv("CHEAPEST_MAIN_MODEL");
}

export function getTurnstileSecretKey(): string {
  return readEnv("TURNSTILE_SECRET_KEY");
}

export function getTurnstileSiteKey(): null | string {
  return readOptionalEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY");
}

export function hasTurnstileSiteKey(): boolean {
  return Boolean(readOptionalEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY"));
}

export function getHashedIpSalt(): string {
  return readEnv("HASHED_IP_SALT");
}

export function hasHashedIpSalt(): boolean {
  return Boolean(readOptionalEnv("HASHED_IP_SALT"));
}

export function hasKvConfig(): boolean {
  return Boolean(
    readOptionalEnv("KV_REST_API_URL") && readOptionalEnv("KV_REST_API_TOKEN"),
  );
}

export function isSoftPauseEnabled(): boolean {
  return readOptionalBooleanEnv("SOFT_PAUSE_ENABLED");
}

export function isHardPauseEnabled(): boolean {
  return readOptionalBooleanEnv("HARD_PAUSE_ENABLED");
}

export function getDailySpendLimitUsd(): null | number {
  return readOptionalNumberEnv("DAILY_SPEND_LIMIT_USD");
}

export function getMainModelInputCostPerMillionUsd(): null | number {
  return readOptionalNumberEnv("MAIN_MODEL_INPUT_COST_PER_MILLION_USD");
}

export function getMainModelOutputCostPerMillionUsd(): null | number {
  return readOptionalNumberEnv("MAIN_MODEL_OUTPUT_COST_PER_MILLION_USD");
}

export function getFallbackMainModelInputCostPerMillionUsd(): null | number {
  return readOptionalNumberEnv("FALLBACK_MAIN_MODEL_INPUT_COST_PER_MILLION_USD");
}

export function getFallbackMainModelOutputCostPerMillionUsd(): null | number {
  return readOptionalNumberEnv("FALLBACK_MAIN_MODEL_OUTPUT_COST_PER_MILLION_USD");
}

export function getCheapestMainModelInputCostPerMillionUsd(): null | number {
  return readOptionalNumberEnv("CHEAPEST_MAIN_MODEL_INPUT_COST_PER_MILLION_USD");
}

export function getCheapestMainModelOutputCostPerMillionUsd(): null | number {
  return readOptionalNumberEnv("CHEAPEST_MAIN_MODEL_OUTPUT_COST_PER_MILLION_USD");
}

export function getClassifierModelInputCostPerMillionUsd(): null | number {
  return readOptionalNumberEnv("CLASSIFIER_MODEL_INPUT_COST_PER_MILLION_USD");
}

export function getClassifierModelOutputCostPerMillionUsd(): null | number {
  return readOptionalNumberEnv("CLASSIFIER_MODEL_OUTPUT_COST_PER_MILLION_USD");
}

export function hasTurnstileSecret(): boolean {
  return Boolean(readOptionalEnv("TURNSTILE_SECRET_KEY"));
}

export function isDevMockChatEnabled(): boolean {
  return readOptionalBooleanEnv("DEV_MOCK_CHAT");
}

export function isProductionMockMisconfigured(): boolean {
  return readOptionalEnv("VERCEL_ENV") === "production" && isDevMockChatEnabled();
}

export function hasLiveModelConfig(): boolean {
  return Boolean(
    readOptionalEnv("ANTHROPIC_API_KEY") &&
      readOptionalEnv("MAIN_MODEL") &&
      readOptionalEnv("CLASSIFIER_MODEL"),
  );
}

export function getDeployEnvironment(): string {
  return readOptionalEnv("VERCEL_ENV") ?? "local";
}

export function getDeployCommitSha(): null | string {
  return readOptionalEnv("VERCEL_GIT_COMMIT_SHA");
}

export function isTtsEnabled(): boolean {
  return readOptionalBooleanEnv("TTS_ENABLED");
}

export function isDevMockTtsEnabled(): boolean {
  return readOptionalBooleanEnv("DEV_MOCK_TTS");
}

export function isProductionTtsMockMisconfigured(): boolean {
  return readOptionalEnv("VERCEL_ENV") === "production" && isDevMockTtsEnabled();
}

export function getAzureSpeechKey(): string {
  return readEnv("AZURE_SPEECH_KEY");
}

export function getAzureSpeechRegion(): string {
  return readEnv("AZURE_SPEECH_REGION");
}

export function hasAzureSpeechConfig(): boolean {
  return Boolean(
    readOptionalEnv("AZURE_SPEECH_KEY") &&
      readOptionalEnv("AZURE_SPEECH_REGION"),
  );
}

export function getTtsDailyCharacterLimit(): null | number {
  return readOptionalNumberEnv("TTS_DAILY_CHARACTER_LIMIT");
}
