import type { ConversationEntryId, WeakCategory } from "./chat-types";

type UsageShape = {
  cache_creation_input_tokens?: null | number;
  cache_read_input_tokens?: null | number;
  input_tokens?: null | number;
  output_tokens?: null | number;
};

export type MainStatus =
  | "not_started"
  | "blocked_soft_pause"
  | "blocked_turnstile"
  | "blocked_rate_limit"
  | "blocked_daily_spend"
  | "completed"
  | "error_no_text"
  | "error_stream"
  | "error_request_setup";

export type ClassifierStatus =
  | "not_started"
  | "completed"
  | "error_classifier";

export type ChatTurnMetadata = {
  timestamp: string;
  model_main: string;
  model_classifier: string;
  classifier_category: WeakCategory;
  main_tokens_in: null | number;
  main_tokens_out: null | number;
  classifier_tokens_in: null | number;
  classifier_tokens_out: null | number;
  main_response_time_ms: null | number;
  classifier_response_time_ms: null | number;
  main_status: MainStatus;
  classifier_status: ClassifierStatus;
  language: string;
  button_id: ConversationEntryId;
  hashed_ip: null | string;
};

function getInputTokens(usage: null | UsageShape | undefined): null | number {
  if (!usage) {
    return null;
  }

  return (
    (usage.input_tokens ?? 0) +
    (usage.cache_creation_input_tokens ?? 0) +
    (usage.cache_read_input_tokens ?? 0)
  );
}

function getOutputTokens(usage: null | UsageShape | undefined): null | number {
  if (!usage) {
    return null;
  }

  return usage.output_tokens ?? 0;
}

export function logChatTurnMetadata({
  buttonId,
  classifierCategory,
  classifierResponseTimeMs,
  classifierStatus,
  classifierUsage,
  hashedIp,
  language,
  mainResponseTimeMs,
  mainStatus,
  mainUsage,
  modelClassifier,
  modelMain,
}: {
  buttonId: ConversationEntryId;
  classifierCategory: WeakCategory;
  classifierResponseTimeMs: null | number;
  classifierStatus: ClassifierStatus;
  classifierUsage?: null | UsageShape;
  hashedIp: null | string;
  language: string;
  mainResponseTimeMs: null | number;
  mainStatus: MainStatus;
  mainUsage?: null | UsageShape;
  modelClassifier: string;
  modelMain: string;
}) {
  const metadata: ChatTurnMetadata = {
    timestamp: new Date().toISOString(),
    model_main: modelMain,
    model_classifier: modelClassifier,
    classifier_category: classifierCategory,
    main_tokens_in: getInputTokens(mainUsage),
    main_tokens_out: getOutputTokens(mainUsage),
    classifier_tokens_in: getInputTokens(classifierUsage),
    classifier_tokens_out: getOutputTokens(classifierUsage),
    main_response_time_ms: mainResponseTimeMs,
    classifier_response_time_ms: classifierResponseTimeMs,
    main_status: mainStatus,
    classifier_status: classifierStatus,
    language,
    button_id: buttonId,
    hashed_ip: hashedIp,
  };

  console.info(JSON.stringify(metadata));
}
