import type { SupportedLanguageCode } from "./languages";
import { isOneOf } from "./is-one-of";
import { isSupportedLanguageCode } from "./languages";

export type ConversationEntryId =
  | "understand-letter-or-form"
  | "write-something"
  | "think-it-through"
  | "figure-out-next"
  | "explain-like-new"
  | "prepare-for-hard"
  | "am-i-being-unreasonable"
  | "embarrassed-to-ask"
  | "type-your-own"
  | "talk-instead";

export const conversationEntryIds: readonly ConversationEntryId[] = [
  "understand-letter-or-form",
  "write-something",
  "think-it-through",
  "figure-out-next",
  "explain-like-new",
  "prepare-for-hard",
  "am-i-being-unreasonable",
  "embarrassed-to-ask",
  "type-your-own",
  "talk-instead",
];

export function isConversationEntryId(
  value: null | string | undefined,
): value is ConversationEntryId {
  return isOneOf(conversationEntryIds, value);
}

export type WeakCategory =
  | "legal_procedure"
  | "medical_dosing"
  | "benefits_eligibility"
  | "immigration"
  | "drug_interactions"
  | "specific_deadlines"
  | "specific_dollar_amounts"
  | "none";

export const weakCategories: readonly WeakCategory[] = [
  "legal_procedure",
  "medical_dosing",
  "benefits_eligibility",
  "immigration",
  "drug_interactions",
  "specific_deadlines",
  "specific_dollar_amounts",
  "none",
];

export function isWeakCategory(
  value: null | string | undefined,
): value is WeakCategory {
  return isOneOf(weakCategories, value);
}

export type ClientChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  weakCategory?: WeakCategory;
};

export type ChatRequestBody = {
  entryId: ConversationEntryId;
  language: SupportedLanguageCode;
  messages: ClientChatMessage[];
  turnstileToken?: string;
};

export function isClientChatMessage(value: unknown): value is ClientChatMessage {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<ClientChatMessage>;
  const hasValidId =
    typeof candidate.id === "string" && candidate.id.trim().length > 0;

  return (
    hasValidId &&
    (candidate.role === "user" || candidate.role === "assistant") &&
    typeof candidate.text === "string"
  );
}

export function isChatRequestBody(value: unknown): value is ChatRequestBody {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<ChatRequestBody>;

  return (
    isConversationEntryId(candidate.entryId) &&
    isSupportedLanguageCode(candidate.language) &&
    (candidate.turnstileToken === undefined ||
      typeof candidate.turnstileToken === "string") &&
    Array.isArray(candidate.messages) &&
    candidate.messages.length > 0 &&
    candidate.messages.every(isClientChatMessage)
  );
}

export type ChatStreamEvent =
  | {
      type: "delta";
      text: string;
    }
  | {
      type: "classifier";
      category: WeakCategory;
    }
  | {
      type: "error";
      error: string;
    };

export type ChatErrorBody = {
  error: string;
  assistantNotice?: string;
};

export function isChatStreamEvent(value: unknown): value is ChatStreamEvent {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<ChatStreamEvent>;

  if (candidate.type === "delta") {
    return typeof candidate.text === "string";
  }

  if (candidate.type === "classifier") {
    return isWeakCategory(candidate.category);
  }

  if (candidate.type === "error") {
    return typeof candidate.error === "string";
  }

  return false;
}

export function isChatErrorBody(value: unknown): value is ChatErrorBody {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<ChatErrorBody>;

  return (
    typeof candidate.error === "string" &&
    (candidate.assistantNotice === undefined ||
      typeof candidate.assistantNotice === "string")
  );
}
