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

export type ClientChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
};

export type ChatRequestBody = {
  entryId: ConversationEntryId;
  language: string;
  messages: ClientChatMessage[];
};

export type ChatResponseBody = {
  message: ClientChatMessage;
};
