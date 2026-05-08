function readEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function readOptionalEnv(name: string): null | string {
  return process.env[name] ?? null;
}

function readOptionalBooleanEnv(name: string): boolean {
  const value = readOptionalEnv(name);

  return value === "true";
}

function readOptionalNumberEnv(name: string): null | number {
  const value = readOptionalEnv(name);

  if (!value) {
    return null;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : null;
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

export function getHashedIpSalt(): string {
  return readEnv("HASHED_IP_SALT");
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

export function getClassifierModelInputCostPerMillionUsd(): null | number {
  return readOptionalNumberEnv("CLASSIFIER_MODEL_INPUT_COST_PER_MILLION_USD");
}

export function getClassifierModelOutputCostPerMillionUsd(): null | number {
  return readOptionalNumberEnv("CLASSIFIER_MODEL_OUTPUT_COST_PER_MILLION_USD");
}
