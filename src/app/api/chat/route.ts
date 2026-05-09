import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { classifierPrompt, parseWeakCategory } from "../../../lib/classifier-prompt";
import {
  getAnthropicApiKey,
  getClassifierModel,
  getMainModel,
  isDevMockChatEnabled,
  isProductionMockMisconfigured,
  isSoftPauseEnabled,
} from "../../../lib/env";
import { checkPerIpRateLimit, getHashedIp } from "../../../lib/rate-limit";
import { logChatTurnMetadata } from "../../../lib/metadata-log";
import { buildMockChatTurn } from "../../../lib/mock-chat";
import { checkDailySpendCap, recordDailySpendUsd } from "../../../lib/spend-control";
import { getSystemPrompt } from "../../../lib/system-prompts";
import { validateTurnstileToken } from "../../../lib/turnstile";
import {
  isChatRequestBody,
  maxChatRequestBodyBytes,
  type ChatRequestBody,
  type WeakCategory,
} from "../../../lib/chat-types";

export async function POST(request: Request) {
  let body: ChatRequestBody;
  const contentLengthHeader = request.headers.get("content-length");

  if (contentLengthHeader) {
    const contentLength = Number(contentLengthHeader);

    if (!Number.isSafeInteger(contentLength) || contentLength < 0) {
      return NextResponse.json({ error: "Invalid request shape." }, { status: 400 });
    }

    if (contentLength > maxChatRequestBodyBytes) {
      return NextResponse.json(
        { error: "Request body too large." },
        { status: 413 },
      );
    }
  }

  try {
    const parsedBody = await request.json();

    if (!isChatRequestBody(parsedBody)) {
      return NextResponse.json({ error: "Invalid request shape." }, { status: 400 });
    }

    body = parsedBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const messages = body.messages
    .map((message) => ({
      role: message.role,
      content: message.text.trim(),
    }))
    .filter((message) => message.content.length > 0);
  const latestMessage = messages.at(-1);

  if (messages.length === 0) {
    return NextResponse.json({ error: "No messages to send." }, { status: 400 });
  }

  if (latestMessage?.role !== "user") {
    return NextResponse.json({ error: "Invalid request shape." }, { status: 400 });
  }

  const requestStartedAt = Date.now();
  let model = process.env.MAIN_MODEL ?? "missing";
  let classifierModel = process.env.CLASSIFIER_MODEL ?? "missing";
  const hashedIp = getHashedIp(request);
  let loggedTurnMetadata = false;

  function logTurnMetadataOnce({
    classifierCategory = "none",
    classifierResponseTimeMs = null,
    classifierStatus = "not_started",
    classifierUsage = null,
    mainResponseTimeMs = Date.now() - requestStartedAt,
    mainStatus,
    mainUsage = null,
  }: {
    classifierCategory?: WeakCategory;
    classifierResponseTimeMs?: null | number;
    classifierStatus?: "completed" | "error_classifier" | "not_started";
    classifierUsage?: null | {
      cache_creation_input_tokens: null | number;
      cache_read_input_tokens: null | number;
      input_tokens: null | number;
      output_tokens: number;
    };
    mainResponseTimeMs?: null | number;
    mainStatus:
      | "blocked_daily_spend"
      | "blocked_rate_limit"
      | "blocked_soft_pause"
      | "blocked_turnstile"
      | "completed"
      | "error_no_text"
      | "error_request_setup"
      | "error_stream";
    mainUsage?: null | {
      cache_creation_input_tokens: null | number;
      cache_read_input_tokens: null | number;
      input_tokens: null | number;
      output_tokens: number;
    };
  }) {
    if (loggedTurnMetadata) {
      return;
    }

    loggedTurnMetadata = true;
    logChatTurnMetadata({
      buttonId: body.entryId,
      classifierCategory,
      classifierResponseTimeMs,
      classifierStatus,
      classifierUsage,
      hashedIp,
      language: body.language,
      mainResponseTimeMs,
      mainStatus,
      mainUsage,
      modelClassifier: classifierModel,
      modelMain: model,
    });
  }

  try {
    if (isProductionMockMisconfigured()) {
      logTurnMetadataOnce({
        mainStatus: "error_request_setup",
      });

      return NextResponse.json(
        {
          error: "This deployment is misconfigured.",
          assistantNotice:
            "This deployment is misconfigured right now and is not safe to use. Please try again later.",
        },
        { status: 503 },
      );
    }

    if (isDevMockChatEnabled()) {
      model = "mock-local-main";
      classifierModel = "mock-local-classifier";
      const { classifierCategory, responseText } = buildMockChatTurn(body);
      const encoder = new TextEncoder();
      const chunks = responseText.match(/.{1,120}(\s|$)/g) ?? [responseText];

      const readable = new ReadableStream({
        async start(controller) {
          for (const chunk of chunks) {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ type: "delta", text: chunk })}\n\n`,
              ),
            );
          }

          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                type: "classifier",
                category: classifierCategory,
              })}\n\n`,
            ),
          );
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();

          logTurnMetadataOnce({
            classifierCategory,
            classifierResponseTimeMs: 0,
            classifierStatus: "completed",
            mainStatus: "completed",
          });
        },
      });

      return new Response(readable, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
        },
      });
    }

    if (isSoftPauseEnabled()) {
      logTurnMetadataOnce({
        mainStatus: "blocked_soft_pause",
      });

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
      logTurnMetadataOnce({
        mainStatus: "blocked_turnstile",
      });

      return NextResponse.json(
        { error: "Please try again." },
        { status: 403 },
      );
    }

    const rateLimit = await checkPerIpRateLimit(request);

    if (!rateLimit.allowed) {
      logTurnMetadataOnce({
        mainStatus: "blocked_rate_limit",
      });

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
      logTurnMetadataOnce({
        mainStatus: "blocked_daily_spend",
      });

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
    classifierModel = getClassifierModel();
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
        let classifierCategory: WeakCategory = "none";
        let classifierResponseTimeMs: null | number = null;
        let classifierUsage:
          | {
              cache_creation_input_tokens: null | number;
              cache_read_input_tokens: null | number;
              input_tokens: null | number;
              output_tokens: number;
            }
          | null = null;
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
            logTurnMetadataOnce({
              mainStatus: "error_no_text",
            });

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
              classifierCategory = category;
              classifierResponseTimeMs = Date.now() - classifierStartedAt;
              classifierUsage = classifierResponse.usage;

              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({ type: "classifier", category })}\n\n`,
                ),
              );

              if (mainUsage) {
                try {
                  await recordDailySpendUsd({
                    mainUsage,
                    classifierUsage: classifierResponse.usage,
                  });
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

              logTurnMetadataOnce({
                classifierCategory,
                classifierResponseTimeMs,
                classifierStatus: "completed",
                classifierUsage,
                mainStatus: "completed",
                mainUsage,
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

              logTurnMetadataOnce({
                classifierCategory,
                classifierResponseTimeMs,
                classifierStatus: "error_classifier",
                classifierUsage,
                mainStatus: "completed",
                mainUsage,
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

          logTurnMetadataOnce({
            mainStatus: "error_stream",
            mainUsage,
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

    logTurnMetadataOnce({
      mainStatus: "error_request_setup",
    });

    return NextResponse.json(
      { error: "The response did not come through. Please try again." },
      { status: 502 },
    );
  }
}
