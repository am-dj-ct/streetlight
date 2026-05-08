import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { classifierPrompt, parseWeakCategory } from "../../../lib/classifier-prompt";
import {
  getAnthropicApiKey,
  getClassifierModel,
  getMainModel,
  isSoftPauseEnabled,
} from "../../../lib/env";
import { checkPerIpRateLimit } from "../../../lib/rate-limit";
import { checkDailySpendCap, recordDailySpendUsd } from "../../../lib/spend-control";
import { getSystemPrompt } from "../../../lib/system-prompts";
import { validateTurnstileToken } from "../../../lib/turnstile";
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
    if (isSoftPauseEnabled()) {
      return NextResponse.json(
        {
          error: "The tool is paused right now. Please try again later today.",
          assistantNotice:
            "The tool is paused right now while the person who runs it checks on something. Try again later today.\n\nIf you need help right now: 988 for crisis, 211 for resources, 911 for emergencies.",
        },
        { status: 503 },
      );
    }

    const turnstile = await validateTurnstileToken({
      request,
      token: body.turnstileToken,
    });

    if (!turnstile.allowed) {
      return NextResponse.json(
        { error: "Please try again." },
        { status: 403 },
      );
    }

    const rateLimit = await checkPerIpRateLimit(request);

    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: "Too many messages today. Please try again tomorrow." },
        {
          status: 429,
          headers: {
            "Retry-After": String(rateLimit.resetInSeconds),
          },
        },
      );
    }

    const spendLimit = await checkDailySpendCap();

    if (!spendLimit.allowed) {
      return NextResponse.json(
        {
          error: "Today's limit has been reached. Please try again tomorrow.",
          assistantNotice:
            "Today's limit has been reached, so the tool is resting for now. Try again tomorrow.\n\nIf you need help right now: 988 for crisis, 211 for resources, 911 for emergencies.",
        },
        {
          status: 503,
          headers: {
            "Retry-After": String(spendLimit.resetInSeconds),
          },
        },
      );
    }

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
        let mainUsage:
          | {
              cache_creation_input_tokens: null | number;
              cache_read_input_tokens: null | number;
              input_tokens: null | number;
              output_tokens: number;
            }
          | null = null;

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
              const finalMessage = await stream.finalMessage();
              mainUsage = finalMessage.usage;
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

              if (mainUsage) {
                try {
                  const spend = await recordDailySpendUsd({
                    mainUsage,
                    classifierUsage: classifierResponse.usage,
                  });

                  if (spend) {
                    console.info({
                      code: "daily_spend_recorded",
                      mainCostUsd: spend.mainCostUsd,
                      classifierCostUsd: spend.classifierCostUsd,
                      totalCostUsd: spend.totalCostUsd,
                      modelMain: model,
                      modelClassifier: classifierModel,
                    });
                  }
                } catch (error: unknown) {
                  const spendErrorMessage =
                    error instanceof Error ? error.message : "";
                  const isSpendKvError = spendErrorMessage.includes("@vercel/kv");

                  console.error({
                    code: isSpendKvError ? "daily_spend_record_failed" : "daily_spend_record_failed",
                    errorType: "SpendTrackingError",
                    modelMain: model,
                    modelClassifier: classifierModel,
                  });
                }
              }
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
    const errorMessage = error instanceof Error ? error.message : "";
    const isKvError = errorMessage.includes("@vercel/kv");

    console.error({
      code: isKvError ? "request_guard_failed" : "anthropic_request_setup_failed",
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
