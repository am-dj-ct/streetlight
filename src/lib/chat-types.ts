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

export const maxChatMessages = 24;
export const maxClientMessageTextLength = 8000;
export const maxChatRequestTextLength = 24000;
// Sized so one turn of downscaled document photos or a small PDF fits under
// Vercel's 4.5 MB function body limit after base64 inflation. See
// docs/decisions/2026-07-26-inline-file-upload-v1.md.
export const maxChatRequestBodyBytes = 4_000_000;
export const maxAttachmentsPerMessage = 5;
export const maxImageAttachmentBase64Length = 1_500_000;
export const maxPdfAttachmentBase64Length = 2_800_000;
export const maxTotalAttachmentBase64Length = 3_000_000;

export const attachmentMediaTypes = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
] as const;

export type AttachmentMediaType = (typeof attachmentMediaTypes)[number];

export type ChatAttachment = {
  dataBase64: string;
  mediaType: AttachmentMediaType;
};

const base64Pattern = /^[A-Za-z0-9+/]+={0,2}$/;

export function isAttachmentMediaType(
  value: null | string | undefined,
): value is AttachmentMediaType {
  return isOneOf(attachmentMediaTypes, value);
}

export function isChatAttachment(value: unknown): value is ChatAttachment {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<ChatAttachment>;

  if (
    !isAttachmentMediaType(candidate.mediaType) ||
    typeof candidate.dataBase64 !== "string" ||
    candidate.dataBase64.length === 0 ||
    candidate.dataBase64.length % 4 !== 0 ||
    !base64Pattern.test(candidate.dataBase64)
  ) {
    return false;
  }

  const maxLength =
    candidate.mediaType === "application/pdf"
      ? maxPdfAttachmentBase64Length
      : maxImageAttachmentBase64Length;

  return candidate.dataBase64.length <= maxLength;
}

export function isConversationEntryId(
  value: null | string | undefined,
): value is ConversationEntryId {
  return isOneOf(conversationEntryIds, value);
}

export type WeakCategory =
  | "legal_procedure"
  | "medical_dosing"
  | "medical_decisionmaking"
  | "benefits_eligibility"
  | "immigration"
  | "drug_interactions"
  | "employment_rights"
  | "identity_documentation"
  | "specific_deadlines"
  | "specific_dollar_amounts"
  | "none";

export const weakCategories: readonly WeakCategory[] = [
  "legal_procedure",
  "medical_dosing",
  "medical_decisionmaking",
  "benefits_eligibility",
  "immigration",
  "drug_interactions",
  "employment_rights",
  "identity_documentation",
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
  attachments?: ChatAttachment[];
  id: string;
  role: "user" | "assistant";
  suggestions?: string[];
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
    typeof candidate.text === "string" &&
    candidate.text.length <= maxClientMessageTextLength &&
    (candidate.suggestions === undefined ||
      (Array.isArray(candidate.suggestions) &&
        candidate.suggestions.every((suggestion) => typeof suggestion === "string"))) &&
    (candidate.weakCategory === undefined ||
      isWeakCategory(candidate.weakCategory)) &&
    (candidate.attachments === undefined ||
      (candidate.role === "user" &&
        Array.isArray(candidate.attachments) &&
        candidate.attachments.length > 0 &&
        candidate.attachments.length <= maxAttachmentsPerMessage &&
        candidate.attachments.every(isChatAttachment)))
  );
}

function totalAttachmentBase64Length(message: ClientChatMessage): number {
  return (message.attachments ?? []).reduce(
    (total, attachment) => total + attachment.dataBase64.length,
    0,
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
    candidate.messages.length <= maxChatMessages &&
    candidate.messages.every(isClientChatMessage) &&
    candidate.messages.reduce(
      (total, message) => total + message.text.length,
      0,
    ) <= maxChatRequestTextLength &&
    // Attachment bytes are never resent with history: only the newest
    // message may carry attachments, and their combined size is capped.
    candidate.messages.every(
      (message, index) =>
        message.attachments === undefined ||
        index === candidate.messages!.length - 1,
    ) &&
    candidate.messages.reduce(
      (total, message) => total + totalAttachmentBase64Length(message),
      0,
    ) <= maxTotalAttachmentBase64Length
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
      type: "suggestions";
      suggestions: string[];
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

  if (candidate.type === "suggestions") {
    return (
      Array.isArray(candidate.suggestions) &&
      candidate.suggestions.every((suggestion) => typeof suggestion === "string")
    );
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
