import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { classifierPrompt, parseWeakCategory } from "../../../lib/classifier-prompt";
import {
  getDeployEnvironment,
  getAnthropicApiKey,
  getCheapestMainModel,
  getClassifierModel,
  getFallbackMainModel,
  getMainModel,
  getOpenAiApiKey,
  getOpenAiFallbackModel,
  hasHashedIpSalt,
  hasKvConfig,
  hasOpenAiFallbackConfig,
  hasTurnstileSecret,
  hasTurnstileSiteKey,
  isDevMockChatEnabled,
  isProductionMockMisconfigured,
  isSoftPauseEnabled,
  isTurnstileEnabled,
} from "../../../lib/env";
import {
  followUpSuggestionsPrompt,
  parseFollowUpSuggestions,
} from "../../../lib/follow-up-suggestions";
import { checkPerIpRateLimit, getHashedIp } from "../../../lib/rate-limit";
import { logChatTurnMetadata } from "../../../lib/metadata-log";
import {
  recordChatRequestUsage,
  recordChatTurnOutcomeUsage,
  recordLlmTurnStartedUsage,
} from "../../../lib/usage-metrics";
import { buildMockChatTurn } from "../../../lib/mock-chat";
import {
  recordDailySpendUsd,
  selectMainModelForSpend,
  type AuxiliaryModelTier,
  type MainModelTier,
} from "../../../lib/spend-control";
import { getSystemPrompt } from "../../../lib/system-prompts";
import { validateTurnstileToken } from "../../../lib/turnstile";
import {
  createOpenAiTextResponse,
  OpenAiFallbackError,
} from "../../../lib/openai-fallback";
import {
  isChatRequestBody,
  maxChatRequestBodyBytes,
  type ChatRequestBody,
  type WeakCategory,
} from "../../../lib/chat-types";

function jsonNoStore(
  body: { assistantNotice?: string; error: string },
  {
    headers,
    status,
  }: {
    headers?: HeadersInit;
    status: number;
  },
) {
  const response = NextResponse.json(body, {
    status,
    headers,
  });

  response.headers.set("Cache-Control", "no-store");

  return response;
}

function buildClassifierInput({
  assistantResponse,
  latestUserMessage,
}: {
  assistantResponse: string;
  latestUserMessage: string;
}) {
  return [
    "Latest user message:",
    latestUserMessage,
    "",
    "Assistant response:",
    assistantResponse,
  ].join("\n");
}

type WebSearchSource = {
  title: string;
  url: string;
};

type AnthropicUsage = {
  cache_creation_input_tokens: null | number;
  cache_read_input_tokens: null | number;
  input_tokens: null | number;
  output_tokens: number;
  server_tool_use?: null | {
    web_fetch_requests?: null | number;
    web_search_requests?: null | number;
  };
};

function extractWebSearchSources(content: readonly unknown[]): WebSearchSource[] {
  const sources: WebSearchSource[] = [];
  const seenUrls = new Set<string>();

  for (const block of content) {
    if (!block || typeof block !== "object") {
      continue;
    }

    const citations = (block as { citations?: unknown }).citations;

    if (!Array.isArray(citations)) {
      continue;
    }

    for (const citation of citations) {
      if (!citation || typeof citation !== "object") {
        continue;
      }

      const candidate = citation as {
        title?: unknown;
        type?: unknown;
        url?: unknown;
      };

      if (
        candidate.type !== "web_search_result_location" ||
        typeof candidate.url !== "string" ||
        seenUrls.has(candidate.url)
      ) {
        continue;
      }

      seenUrls.add(candidate.url);
      sources.push({
        title:
          typeof candidate.title === "string" && candidate.title.trim().length > 0
            ? candidate.title.trim()
            : candidate.url,
        url: candidate.url,
      });
    }
  }

  return sources.slice(0, 5);
}

function formatSourcesAppendix(sources: WebSearchSource[]): string {
  if (sources.length === 0) {
    return "";
  }

  return `\n\nSources:\n${sources
    .map((source) => `- ${source.title}: ${source.url}`)
    .join("\n")}`;
}

type MainModelAttempt = {
  model: string;
  tier: MainModelTier;
};

function dedupeModelAttempts(attempts: MainModelAttempt[]): MainModelAttempt[] {
  const seen = new Set<string>();
  const result: MainModelAttempt[] = [];

  for (const attempt of attempts) {
    if (seen.has(attempt.model)) {
      continue;
    }

    seen.add(attempt.model);
    result.push(attempt);
  }

  return result;
}

function buildMainModelAttempts({
  cheapestModel,
  fallbackModel,
  primaryModel,
  selectedModel,
  selectedTier,
}: {
  cheapestModel: null | string;
  fallbackModel: string;
  primaryModel: string;
  selectedModel: string;
  selectedTier: MainModelTier;
}): MainModelAttempt[] {
  const configuredAttempts: MainModelAttempt[] = [
    {
      model: primaryModel,
      tier: "primary",
    },
    {
      model: fallbackModel,
      tier: "fallback",
    },
  ];

  if (cheapestModel) {
    configuredAttempts.push({
      model: cheapestModel,
      tier: "cheapest",
    });
  }

  const selectedIndex = configuredAttempts.findIndex(
    (attempt) => attempt.tier === selectedTier,
  );
  const attempts =
    selectedIndex === -1
      ? [
          {
            model: selectedModel,
            tier: selectedTier,
          },
          ...configuredAttempts,
        ]
      : configuredAttempts.slice(selectedIndex);

  return dedupeModelAttempts(attempts);
}

function getApiErrorStatus(error: unknown): null | number {
  return error instanceof Anthropic.APIError &&
    typeof error.status === "number"
    ? error.status
    : null;
}

function getApiErrorName(error: unknown): string {
  return error instanceof Anthropic.APIError ? error.name : "UnknownError";
}

function isRetryableMainModelError(error: unknown): boolean {
  const status = getApiErrorStatus(error);

  if (status === null) {
    return true;
  }

  return status === 408 || status >= 500;
}

function getOpenAiErrorStatus(error: unknown): null | number {
  return error instanceof OpenAiFallbackError ? error.status : null;
}

function getOpenAiFallbackModelLabel(model: string): string {
  return `openai:${model}`;
}

function buildOpenAiInputMessages(
  messages: {
    content: string;
    role: "assistant" | "user";
  }[],
) {
  return messages.map((message) => ({
    content: message.content,
    role: message.role,
  }));
}

async function createOpenAiMainFallback({
  entryId,
  messages,
}: {
  entryId: ChatRequestBody["entryId"];
  messages: {
    content: string;
    role: "assistant" | "user";
  }[];
}) {
  return createOpenAiTextResponse({
    apiKey: getOpenAiApiKey(),
    input: buildOpenAiInputMessages(messages),
    instructions: getSystemPrompt(entryId),
    maxOutputTokens: 900,
    model: getOpenAiFallbackModel(),
  });
}

async function createOpenAiClassifierFallback({
  assistantResponse,
  latestUserMessage,
}: {
  assistantResponse: string;
  latestUserMessage: string;
}) {
  return createOpenAiTextResponse({
    apiKey: getOpenAiApiKey(),
    input: buildClassifierInput({
      assistantResponse,
      latestUserMessage,
    }),
    instructions: classifierPrompt,
    maxOutputTokens: 20,
    model: getOpenAiFallbackModel(),
  });
}

async function createOpenAiSuggestionsFallback(responseText: string) {
  return createOpenAiTextResponse({
    apiKey: getOpenAiApiKey(),
    input: responseText,
    instructions: followUpSuggestionsPrompt,
    maxOutputTokens: 160,
    model: getOpenAiFallbackModel(),
  });
}

function getStreamEventErrorDescription(event: unknown): string {
  if (!event || typeof event !== "object") {
    return "unknown";
  }

  const candidate = event as {
    error?: {
      message?: unknown;
      type?: unknown;
    };
  };
  const type =
    typeof candidate.error?.type === "string"
      ? candidate.error.type
      : "unknown";
  const message =
    typeof candidate.error?.message === "string"
      ? candidate.error.message
      : "stream error";

  return `${type}: ${message}`;
}

async function readLimitedRequestBody(request: Request) {
  if (!request.body) {
    return "";
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    totalBytes += value.byteLength;

    if (totalBytes > maxChatRequestBodyBytes) {
      await reader.cancel().catch(() => undefined);
      return null;
    }

    chunks.push(value);
  }

  const bodyBytes = new Uint8Array(totalBytes);
  let offset = 0;

  for (const chunk of chunks) {
    bodyBytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder().decode(bodyBytes);
}

export async function POST(request: Request) {
  let body: ChatRequestBody;
  const contentLengthHeader = request.headers.get("content-length");

  if (contentLengthHeader) {
    const contentLength = Number(contentLengthHeader);

    if (!Number.isSafeInteger(contentLength) || contentLength < 0) {
      return jsonNoStore({ error: "Invalid request shape." }, { status: 400 });
    }

    if (contentLength > maxChatRequestBodyBytes) {
      return jsonNoStore(
        { error: "Request body too large." },
        { status: 413 },
      );
    }
  }

  try {
    const requestBodyText = await readLimitedRequestBody(request);

    if (requestBodyText === null) {
      return jsonNoStore(
        { error: "Request body too large." },
        { status: 413 },
      );
    }

    const parsedBody = JSON.parse(requestBodyText);

    if (!isChatRequestBody(parsedBody)) {
      return jsonNoStore({ error: "Invalid request shape." }, { status: 400 });
    }

    body = parsedBody;
  } catch {
    return jsonNoStore({ error: "Invalid JSON body." }, { status: 400 });
  }

  const messages = body.messages
    .map((message) => ({
      role: message.role,
      content: message.text.trim(),
    }))
    .filter((message) => message.content.length > 0);
  const latestMessage = messages.at(-1);

  if (messages.length === 0) {
    return jsonNoStore({ error: "No messages to send." }, { status: 400 });
  }

  if (latestMessage?.role !== "user") {
    return jsonNoStore({ error: "Invalid request shape." }, { status: 400 });
  }

  const latestUserMessageText = latestMessage.content;
  const requestStartedAt = Date.now();
  let model = process.env.MAIN_MODEL ?? "missing";
  let classifierModel = process.env.CLASSIFIER_MODEL ?? "missing";
  let mainModelTier: MainModelTier = "primary";
  const deployEnv = getDeployEnvironment();
  const isProductionDeploy = deployEnv === "production";
  const turnstileProtectionEnabled = isTurnstileEnabled();
  const hasAbuseControlsConfig =
    (!turnstileProtectionEnabled ||
      (hasTurnstileSecret() && hasTurnstileSiteKey())) &&
    hasKvConfig() &&
    hasHashedIpSalt();
  const hashedIp = getHashedIp(request);
  let loggedTurnMetadata = false;

  async function logTurnMetadataOnce({
    classifierCategory = "none",
    classifierResponseTimeMs = null,
    classifierStatus = "not_started",
    classifierUsage = null,
    mainResponseTimeMs = Date.now() - requestStartedAt,
    mainStatus,
    mainUsage = null,
    suggestionsResponseTimeMs = null,
    suggestionsStatus = "not_started",
    suggestionsUsage = null,
  }: {
    classifierCategory?: WeakCategory;
    classifierResponseTimeMs?: null | number;
    classifierStatus?: "completed" | "error_classifier" | "not_started";
    classifierUsage?: null | AnthropicUsage;
    mainResponseTimeMs?: null | number;
    mainStatus:
      | "blocked_abuse_controls"
      | "blocked_daily_spend"
      | "blocked_rate_limit"
      | "blocked_soft_pause"
      | "blocked_turnstile"
      | "completed"
      | "error_no_text"
      | "error_request_setup"
      | "error_stream";
    mainUsage?: null | AnthropicUsage;
    suggestionsResponseTimeMs?: null | number;
    suggestionsStatus?: "completed" | "error_suggestions" | "not_started";
    suggestionsUsage?: null | AnthropicUsage;
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
      suggestionsResponseTimeMs,
      suggestionsStatus,
      suggestionsUsage,
    });
    await recordChatTurnOutcomeUsage({
      buttonId: body.entryId,
      classifierCategory,
      language: body.language,
      mainStatus,
      modelMain: model,
    });
  }

  await recordChatRequestUsage({ hashedIp });

  try {
    if (isProductionMockMisconfigured()) {
      await logTurnMetadataOnce({
        mainStatus: "error_request_setup",
      });

      return jsonNoStore(
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
      const { classifierCategory, responseText, suggestions } = buildMockChatTurn(body);
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
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                type: "suggestions",
                suggestions,
              })}\n\n`,
            ),
          );
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();

          await logTurnMetadataOnce({
            classifierCategory,
            classifierResponseTimeMs: 0,
            classifierStatus: "completed",
            mainStatus: "completed",
            suggestionsResponseTimeMs: 0,
            suggestionsStatus: "completed",
          });
        },
      });

      return new Response(readable, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-store, no-transform",
          Connection: "keep-alive",
        },
      });
    }

    if (isProductionDeploy && !hasAbuseControlsConfig) {
      await logTurnMetadataOnce({
        mainStatus: "blocked_abuse_controls",
      });

      return jsonNoStore(
        {
          error: "This deployment is misconfigured.",
          assistantNotice:
            "This deployment is misconfigured right now and is not safe to use. Please try again later.",
        },
        { status: 503 },
      );
    }

    if (isSoftPauseEnabled()) {
      await logTurnMetadataOnce({
        mainStatus: "blocked_soft_pause",
      });

      return jsonNoStore(
        {
          error: "The tool is paused right now. Please try again later today.",
          assistantNotice:
            "The tool is paused right now while the person who runs it checks on something. Try again later today.\n\nIf you need help right now: 988 for crisis, 211 for resources, 911 for emergencies.",
        },
        { status: 503 },
      );
    }

    if (turnstileProtectionEnabled) {
      const turnstile = await validateTurnstileToken({
        request,
        token: body.turnstileToken,
      });

      if (isProductionDeploy && turnstile.reason === "disabled") {
        await logTurnMetadataOnce({
          mainStatus: "blocked_abuse_controls",
        });

        return jsonNoStore(
          {
            error: "This deployment is misconfigured.",
            assistantNotice:
              "This deployment is misconfigured right now and is not safe to use. Please try again later.",
          },
          { status: 503 },
        );
      }

      if (!turnstile.allowed) {
        await logTurnMetadataOnce({
          mainStatus:
            turnstile.reason === "unavailable"
              ? "error_request_setup"
              : "blocked_turnstile",
        });

        return jsonNoStore(
          { error: "The response did not come through. Please try again." },
          { status: turnstile.reason === "unavailable" ? 503 : 403 },
        );
      }
    }

    const rateLimit = await checkPerIpRateLimit(request);

    if (isProductionDeploy && rateLimit.reason === "disabled") {
      await logTurnMetadataOnce({
        mainStatus: "blocked_abuse_controls",
      });

      return jsonNoStore(
        {
          error: "This deployment is misconfigured.",
          assistantNotice:
            "This deployment is misconfigured right now and is not safe to use. Please try again later.",
        },
        { status: 503 },
      );
    }

    if (!rateLimit.allowed) {
      await logTurnMetadataOnce({
        mainStatus: "blocked_rate_limit",
      });

      return jsonNoStore(
        { error: "Too many messages today. Please try again tomorrow." },
        {
          status: 429,
          headers: {
            "Retry-After": String(rateLimit.resetInSeconds),
          },
        },
      );
    }

    const primaryModel = getMainModel();
    const fallbackModel = getFallbackMainModel();
    const cheapestModel = getCheapestMainModel();
    model = primaryModel;
    classifierModel = getClassifierModel();
    const modelSelection = await selectMainModelForSpend({
      primaryModel: model,
    });

    if (!modelSelection.allowed) {
      await logTurnMetadataOnce({
        mainStatus: "blocked_daily_spend",
      });

      return jsonNoStore(
        {
          error: "Today's limit has been reached. Please try again tomorrow.",
          assistantNotice:
            "Today's limit has been reached, so the tool is resting for now. Try again tomorrow.\n\nIf you need help right now: 988 for crisis, 211 for resources, 911 for emergencies.",
        },
        {
          status: 503,
          headers: {
            "Retry-After": String(modelSelection.resetInSeconds),
          },
        },
      );
    }

    await recordLlmTurnStartedUsage({ hashedIp });

    const anthropic = new Anthropic({
      apiKey: getAnthropicApiKey(),
      maxRetries: 0,
    });
    const mainModelAttempts = buildMainModelAttempts({
      cheapestModel,
      fallbackModel,
      primaryModel,
      selectedModel: modelSelection.model,
      selectedTier: modelSelection.tier,
    });
    const anthropicAuxiliaryModel = classifierModel;
    const encoder = new TextEncoder();

    const readable = new ReadableStream({
      async start(controller) {
        let sentAnyText = false;
        let responseText = "";
        let classifierCategory: WeakCategory = "none";
        let classifierCompleted = false;
        let classifierResponseTimeMs: null | number = null;
        let classifierUsage: AnthropicUsage | null = null;
        let suggestionsResponseTimeMs: null | number = null;
        let suggestionsUsage: AnthropicUsage | null = null;
        let suggestionsStatus: "completed" | "error_suggestions" | "not_started" =
          "not_started";
        let mainUsage: AnthropicUsage | null = null;
        let classifierModelTier: AuxiliaryModelTier = "classifier";
        let suggestionsModelTier: AuxiliaryModelTier = "classifier";
        let finalMessageContent: readonly unknown[] = [];

        try {
          for (const [attemptIndex, attempt] of mainModelAttempts.entries()) {
            model = attempt.model;
            mainModelTier = attempt.tier;
            const nextAttempt = mainModelAttempts[attemptIndex + 1] ?? null;
            const attemptStartedAt = Date.now();
            let attemptSentAnyText = false;

            try {
              const stream = anthropic.messages.stream({
                model,
                max_tokens: 900,
                system: getSystemPrompt(body.entryId),
                messages,
                tools: [
                  {
                    type: "web_search_20250305",
                    name: "web_search",
                    max_uses: 5,
                    user_location: {
                      type: "approximate",
                      city: "Seattle",
                      region: "Washington",
                      country: "US",
                      timezone: "America/Los_Angeles",
                    },
                  },
                ],
              });

              for await (const event of stream) {
                const eventType = (event as { type?: unknown }).type;

                if (eventType === "error") {
                  throw new Error(
                    `Anthropic stream error: ${getStreamEventErrorDescription(event)}`,
                  );
                }

                if (
                  event.type !== "content_block_delta" ||
                  event.delta.type !== "text_delta"
                ) {
                  continue;
                }

                attemptSentAnyText = true;
                sentAnyText = true;
                responseText += event.delta.text;
                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({ type: "delta", text: event.delta.text })}\n\n`,
                  ),
                );
              }

              if (!attemptSentAnyText) {
                if (nextAttempt) {
                  console.error({
                    code: "anthropic_main_model_no_text_fallback",
                    model,
                    modelTier: mainModelTier,
                    nextModel: nextAttempt.model,
                    nextModelTier: nextAttempt.tier,
                    responseTimeMs: Date.now() - attemptStartedAt,
                  });
                  continue;
                }

                break;
              }

              const finalMessage = await stream.finalMessage();
              mainUsage = finalMessage.usage;
              finalMessageContent = finalMessage.content;
              break;
            } catch (error: unknown) {
              const shouldTryNext =
                !attemptSentAnyText &&
                nextAttempt !== null &&
                isRetryableMainModelError(error);

              if (shouldTryNext) {
                console.error({
                  code: "anthropic_main_model_fallback",
                  errorType: getApiErrorName(error),
                  status: getApiErrorStatus(error) ?? 500,
                  model,
                  modelTier: mainModelTier,
                  nextModel: nextAttempt.model,
                  nextModelTier: nextAttempt.tier,
                  responseTimeMs: Date.now() - attemptStartedAt,
                });
                continue;
              }

              throw error;
            }
          }

          if (!sentAnyText && hasOpenAiFallbackConfig()) {
            const openAiFallbackModel = getOpenAiFallbackModel();
            const fallbackStartedAt = Date.now();

            try {
              const openAiResponse = await createOpenAiMainFallback({
                entryId: body.entryId,
                messages,
              });

              model = getOpenAiFallbackModelLabel(openAiFallbackModel);
              mainModelTier = "openai_fallback";
              mainUsage = openAiResponse.usage;
              sentAnyText = true;
              responseText += openAiResponse.text;
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({ type: "delta", text: openAiResponse.text })}\n\n`,
                ),
              );

              console.error({
                code: "openai_main_model_fallback_after_anthropic",
                model,
                responseTimeMs: Date.now() - fallbackStartedAt,
              });
            } catch (error: unknown) {
              console.error({
                code: "openai_main_model_fallback_failed",
                errorType:
                  error instanceof OpenAiFallbackError
                    ? error.name
                    : "UnknownError",
                model: getOpenAiFallbackModelLabel(openAiFallbackModel),
                responseTimeMs: Date.now() - fallbackStartedAt,
                status: getOpenAiErrorStatus(error) ?? 500,
              });
            }
          }

          if (!sentAnyText) {
            await logTurnMetadataOnce({
              mainStatus: "error_no_text",
            });

            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  type: "error",
                  error: "The response did not come through. Please try again.",
                })}\n\n`,
              ),
            );
          } else {
            const sourcesAppendix = formatSourcesAppendix(
              extractWebSearchSources(finalMessageContent),
            );

            if (sourcesAppendix) {
              responseText += sourcesAppendix;
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({ type: "delta", text: sourcesAppendix })}\n\n`,
                ),
              );
            }

            try {
              const classifierStartedAt = Date.now();
              const classifierResponse = await anthropic.messages.create({
                model: anthropicAuxiliaryModel,
                max_tokens: 20,
                system: classifierPrompt,
                messages: [
                  {
                    role: "user",
                    content: buildClassifierInput({
                      assistantResponse: responseText,
                      latestUserMessage: latestUserMessageText,
                    }),
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
              classifierCompleted = true;
              classifierResponseTimeMs = Date.now() - classifierStartedAt;
              classifierUsage = classifierResponse.usage;

              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({ type: "classifier", category })}\n\n`,
                ),
              );
            } catch (error: unknown) {
              const responseTimeMs = Date.now() - requestStartedAt;
              const apiError = error instanceof Anthropic.APIError ? error : null;

              console.error({
                code: "anthropic_classifier_failed",
                errorType: apiError?.name ?? "UnknownError",
                status: apiError?.status ?? 500,
                modelMain: model,
                modelClassifier: anthropicAuxiliaryModel,
                responseTimeMs,
              });

              if (hasOpenAiFallbackConfig()) {
                const openAiFallbackModel = getOpenAiFallbackModel();
                const fallbackStartedAt = Date.now();

                try {
                  const classifierResponse = await createOpenAiClassifierFallback({
                    assistantResponse: responseText,
                    latestUserMessage: latestUserMessageText,
                  });
                  const category = parseWeakCategory(classifierResponse.text);

                  classifierModel = getOpenAiFallbackModelLabel(openAiFallbackModel);
                  classifierModelTier = "openai_fallback";
                  classifierCategory = category;
                  classifierCompleted = true;
                  classifierResponseTimeMs = Date.now() - fallbackStartedAt;
                  classifierUsage = classifierResponse.usage;

                  controller.enqueue(
                    encoder.encode(
                      `data: ${JSON.stringify({ type: "classifier", category })}\n\n`,
                    ),
                  );
                } catch (fallbackError: unknown) {
                  console.error({
                    code: "openai_classifier_fallback_failed",
                    errorType:
                      fallbackError instanceof OpenAiFallbackError
                        ? fallbackError.name
                        : "UnknownError",
                    modelMain: model,
                    modelClassifier: getOpenAiFallbackModelLabel(openAiFallbackModel),
                    responseTimeMs: Date.now() - fallbackStartedAt,
                    status: getOpenAiErrorStatus(fallbackError) ?? 500,
                  });
                }
              }
            }

            try {
              const suggestionsStartedAt = Date.now();
              const suggestionsResponse = await anthropic.messages.create({
                model: anthropicAuxiliaryModel,
                max_tokens: 160,
                system: followUpSuggestionsPrompt,
                messages: [
                  {
                    role: "user",
                    content: responseText,
                  },
                ],
              });
              const suggestionsText = suggestionsResponse.content
                .filter((block) => block.type === "text")
                .map((block) => block.text)
                .join(" ")
                .trim();
              const suggestions = parseFollowUpSuggestions(suggestionsText);

              suggestionsResponseTimeMs = Date.now() - suggestionsStartedAt;
              suggestionsUsage = suggestionsResponse.usage;
              suggestionsStatus = "completed";

              if (suggestions.length > 0) {
                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({ type: "suggestions", suggestions })}\n\n`,
                  ),
                );
              }
            } catch (error: unknown) {
              const responseTimeMs = Date.now() - requestStartedAt;
              const apiError = error instanceof Anthropic.APIError ? error : null;
              suggestionsStatus = "error_suggestions";

              console.error({
                code: "anthropic_suggestions_failed",
                errorType: apiError?.name ?? "UnknownError",
                status: apiError?.status ?? 500,
                modelMain: model,
                modelClassifier: anthropicAuxiliaryModel,
                responseTimeMs,
              });

              if (hasOpenAiFallbackConfig()) {
                const openAiFallbackModel = getOpenAiFallbackModel();
                const fallbackStartedAt = Date.now();

                try {
                  const suggestionsResponse =
                    await createOpenAiSuggestionsFallback(responseText);
                  const suggestions = parseFollowUpSuggestions(
                    suggestionsResponse.text,
                  );

                  classifierModel = getOpenAiFallbackModelLabel(openAiFallbackModel);
                  suggestionsModelTier = "openai_fallback";
                  suggestionsResponseTimeMs = Date.now() - fallbackStartedAt;
                  suggestionsUsage = suggestionsResponse.usage;
                  suggestionsStatus = "completed";

                  if (suggestions.length > 0) {
                    controller.enqueue(
                      encoder.encode(
                        `data: ${JSON.stringify({ type: "suggestions", suggestions })}\n\n`,
                      ),
                    );
                  }
                } catch (fallbackError: unknown) {
                  console.error({
                    code: "openai_suggestions_fallback_failed",
                    errorType:
                      fallbackError instanceof OpenAiFallbackError
                        ? fallbackError.name
                        : "UnknownError",
                    modelMain: model,
                    modelClassifier: getOpenAiFallbackModelLabel(openAiFallbackModel),
                    responseTimeMs: Date.now() - fallbackStartedAt,
                    status: getOpenAiErrorStatus(fallbackError) ?? 500,
                  });
                }
              }
            }

            if (mainUsage) {
              try {
                const emptyUsage = {
                  cache_creation_input_tokens: null,
                  cache_read_input_tokens: null,
                  input_tokens: 0,
                  output_tokens: 0,
                };

                await recordDailySpendUsd({
                  classifierModelTier,
                  mainModelTier,
                  mainUsage,
                  classifierUsage: classifierUsage ?? emptyUsage,
                  suggestionsModelTier,
                  suggestionsUsage,
                });
              } catch {
                console.error({
                  code: "daily_spend_record_failed",
                  errorType: "SpendTrackingError",
                  modelMain: model,
                  modelClassifier: classifierModel,
                });
              }
            }

            await logTurnMetadataOnce({
              classifierCategory,
              classifierResponseTimeMs,
              classifierStatus: classifierCompleted
                ? "completed"
                : "error_classifier",
              classifierUsage,
              mainStatus: "completed",
              mainUsage,
              suggestionsResponseTimeMs,
              suggestionsStatus,
              suggestionsUsage,
            });
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

          await logTurnMetadataOnce({
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
        "Cache-Control": "no-store, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (error: unknown) {
    const missingConfig =
      error instanceof Error &&
      error.message.startsWith("Missing required environment variable:");

    if (missingConfig) {
      return jsonNoStore(
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

    await logTurnMetadataOnce({
      mainStatus: "error_request_setup",
    });

    return jsonNoStore(
      { error: "The response did not come through. Please try again." },
      { status: 502 },
    );
  }
}

export function GET() {
  return jsonNoStore(
    { error: "Method not allowed." },
    {
      headers: {
        Allow: "POST",
      },
      status: 405,
    },
  );
}

export function OPTIONS() {
  return jsonNoStore(
    { error: "Method not allowed." },
    {
      headers: {
        Allow: "POST",
      },
      status: 405,
    },
  );
}
