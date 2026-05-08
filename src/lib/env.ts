function readEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

export function getAnthropicApiKey(): string {
  return readEnv("ANTHROPIC_API_KEY");
}

export function getMainModel(): string {
  return readEnv("MAIN_MODEL");
}
