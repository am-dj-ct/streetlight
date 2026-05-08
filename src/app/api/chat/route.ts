import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { getAnthropicApiKey, getMainModel } from "../../../lib/env";
import { getSystemPrompt } from "../../../lib/system-prompts";
import type { ChatRequestBody, ClientChatMessage } from "../../../lib/chat-types";

function isClientChatMessage(value: unknown): value is ClientChatMessage {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<ClientChatMessage>;

  return (
    typeof candidate.id === "string" &&
    (candidate.role === "user" || candidate.role === "assistant") &&
    typeof candidate.text === "string"
  );
}

function extractTextBlocks(response: Anthropic.Messages.Message): string {
  return response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text.trim())
    .filter(Boolean)
    .join("\n\n");
}

export async function POST(request: Request) {
  let body: ChatRequestBody;

  try {
    body = (await request.json()) as ChatRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (
    !body ||
    typeof body.entryId !== "string" ||
    typeof body.language !== "string" ||
    !Array.isArray(body.messages) ||
    body.messages.length === 0 ||
    !body.messages.every(isClientChatMessage)
  ) {
    return NextResponse.json({ error: "Invalid request shape." }, { status: 400 });
  }

  const messages = body.messages
    .map((message) => ({
      role: message.role,
      content: message.text.trim(),
    }))
    .filter((message) => message.content.length > 0);

  if (messages.length === 0) {
    return NextResponse.json({ error: "No messages to send." }, { status: 400 });
  }

  const requestStartedAt = Date.now();
  let model = process.env.MAIN_MODEL ?? "missing";

  try {
    const anthropic = new Anthropic({
      apiKey: getAnthropicApiKey(),
    });
    model = getMainModel();
    const response = await anthropic.messages.create({
      model,
      max_tokens: 900,
      system: getSystemPrompt(body.entryId),
      messages,
    });
    const text = extractTextBlocks(response);

    if (!text) {
      return NextResponse.json(
        { error: "The model returned no text." },
        { status: 502 },
      );
    }

    return NextResponse.json({
      message: {
        id: response.id,
        role: "assistant",
        text,
      },
    });
  } catch (error: unknown) {
    const missingConfig =
      error instanceof Error &&
      error.message.startsWith("Missing required environment variable:");

    if (missingConfig) {
      return NextResponse.json(
        { error: "The response did not come through. Please try again." },
        { status: 503 },
      );
    }

    const responseTimeMs = Date.now() - requestStartedAt;
    const apiError = error instanceof Anthropic.APIError ? error : null;

    console.error({
      code: "anthropic_request_failed",
      errorType: apiError?.name ?? "UnknownError",
      status: apiError?.status ?? 500,
      model,
      responseTimeMs,
    });

    return NextResponse.json(
      { error: "The response did not come through. Please try again." },
      { status: 502 },
    );
  }
}
