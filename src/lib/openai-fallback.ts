export type OpenAiUsage = {
  cache_creation_input_tokens: null;
  cache_read_input_tokens: null;
  input_tokens: null | number;
  output_tokens: number;
};

export type OpenAiInputMessage = {
  content: string;
  role: "assistant" | "user";
};

type OpenAiTextResponse = {
  output?: unknown;
  output_text?: unknown;
  usage?: unknown;
};

export class OpenAiFallbackError extends Error {
  status: null | number;

  constructor({
    message,
    status,
  }: {
    message: string;
    status: null | number;
  }) {
    super(message);
    this.name = "OpenAiFallbackError";
    this.status = status;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object");
}

function collectTextBlocks(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }

  if (Array.isArray(value)) {
    return value.flatMap(collectTextBlocks);
  }

  if (!isRecord(value)) {
    return [];
  }

  const texts: string[] = [];
  const type = value.type;

  if (
    (type === "output_text" || type === "text") &&
    typeof value.text === "string"
  ) {
    texts.push(value.text);
  }

  if (Array.isArray(value.content)) {
    texts.push(...value.content.flatMap(collectTextBlocks));
  }

  if (Array.isArray(value.output)) {
    texts.push(...value.output.flatMap(collectTextBlocks));
  }

  return texts;
}

function extractResponseText(body: OpenAiTextResponse): string {
  if (typeof body.output_text === "string") {
    return body.output_text.trim();
  }

  return collectTextBlocks(body.output).join("").trim();
}

function extractNumber(value: unknown): null | number {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function extractUsage(value: unknown): OpenAiUsage | null {
  if (!isRecord(value)) {
    return null;
  }

  return {
    cache_creation_input_tokens: null,
    cache_read_input_tokens: null,
    input_tokens: extractNumber(value.input_tokens),
    output_tokens: extractNumber(value.output_tokens) ?? 0,
  };
}

export async function createOpenAiTextResponse({
  apiKey,
  input,
  instructions,
  maxOutputTokens,
  model,
}: {
  apiKey: string;
  input: OpenAiInputMessage[] | string;
  instructions: string;
  maxOutputTokens: number;
  model: string;
}): Promise<{
  text: string;
  usage: OpenAiUsage | null;
}> {
  const response = await fetch("https://api.openai.com/v1/responses", {
    body: JSON.stringify({
      input,
      instructions,
      max_output_tokens: maxOutputTokens,
      model,
      reasoning: {
        effort: "low",
      },
      text: {
        verbosity: "low",
      },
    }),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  if (!response.ok) {
    throw new OpenAiFallbackError({
      message: "OpenAI fallback request failed.",
      status: response.status,
    });
  }

  const body = (await response.json().catch(() => null)) as OpenAiTextResponse | null;

  if (!body || !isRecord(body)) {
    throw new OpenAiFallbackError({
      message: "OpenAI fallback returned invalid JSON.",
      status: response.status,
    });
  }

  const text = extractResponseText(body);

  if (!text) {
    throw new OpenAiFallbackError({
      message: "OpenAI fallback returned no text.",
      status: response.status,
    });
  }

  return {
    text,
    usage: extractUsage(body.usage),
  };
}
