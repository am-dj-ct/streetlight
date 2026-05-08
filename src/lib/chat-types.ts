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
  return conversationEntryIds.includes(value as ConversationEntryId);
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

export type ClientChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  weakCategory?: WeakCategory;
};

export type ChatRequestBody = {
  entryId: ConversationEntryId;
  language: string;
  messages: ClientChatMessage[];
  turnstileToken?: string;
};

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
