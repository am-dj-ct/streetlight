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
