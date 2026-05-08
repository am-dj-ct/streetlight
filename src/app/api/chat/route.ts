import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { classifierPrompt, parseWeakCategory } from "../../../lib/classifier-prompt";
import { getAnthropicApiKey, getClassifierModel, getMainModel } from "../../../lib/env";
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
    const classifierModel = getClassifierModel();
    const stream = anthropic.messages.stream({
      model,
      max_tokens: 900,
      system: getSystemPrompt(body.entryId),
      messages,
    });
    const encoder = new TextEncoder();

    const readable = new ReadableStream({
      async start(controller) {
        let sentAnyText = false;
        let responseText = "";

        try {
          for await (const event of stream) {
            if (event.type !== "content_block_delta" || event.delta.type !== "text_delta") {
              continue;
            }

            sentAnyText = true;
            responseText += event.delta.text;
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ type: "delta", text: event.delta.text })}\n\n`),
            );
          }

          if (!sentAnyText) {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ type: "error", error: "The model returned no text." })}\n\n`,
              ),
            );
          } else {
            try {
              const classifierStartedAt = Date.now();
              const classifierResponse = await anthropic.messages.create({
                model: classifierModel,
                max_tokens: 20,
                system: classifierPrompt,
                messages: [
                  {
                    role: "user",
                    content: responseText,
                  },
                ],
              });
              const classifierText = classifierResponse.content
                .filter((block) => block.type === "text")
                .map((block) => block.text)
                .join(" ")
                .trim();
              const category = parseWeakCategory(classifierText);

              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({ type: "classifier", category })}\n\n`,
                ),
              );

              console.info({
                code: "weak_category_classified",
                category,
                modelMain: model,
                modelClassifier: classifierModel,
                classifierResponseTimeMs: Date.now() - classifierStartedAt,
              });
            } catch (error: unknown) {
              const responseTimeMs = Date.now() - requestStartedAt;
              const apiError = error instanceof Anthropic.APIError ? error : null;

              console.error({
                code: "anthropic_classifier_failed",
                errorType: apiError?.name ?? "UnknownError",
                status: apiError?.status ?? 500,
                modelMain: model,
                modelClassifier: classifierModel,
                responseTimeMs,
              });
            }
          }

          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        } catch (error: unknown) {
          const responseTimeMs = Date.now() - requestStartedAt;
          const apiError = error instanceof Anthropic.APIError ? error : null;

          console.error({
            code: "anthropic_stream_failed",
            errorType: apiError?.name ?? "UnknownError",
            status: apiError?.status ?? 500,
            model,
            responseTimeMs,
          });

          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                type: "error",
                error: "The response did not come through. Please try again.",
              })}\n\n`,
            ),
          );
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        }
      },
    });

    return new Response(readable, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
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
      code: "anthropic_request_setup_failed",
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
