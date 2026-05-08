import en from "../data/conversation-content/en.json";
import es from "../data/conversation-content/es.json";
import vi from "../data/conversation-content/vi.json";
import so from "../data/conversation-content/so.json";
import ru from "../data/conversation-content/ru.json";
import am from "../data/conversation-content/am.json";
import zh from "../data/conversation-content/zh.json";
import type { ConversationEntryId } from "./chat-types";
import type { SupportedLanguageCode } from "./languages";
import {
  buildLanguageDocumentMap,
  type LocaleDocumentMeta,
} from "./locale-documents";

type ConversationContentEntry = {
  label: string;
  assistantMessage: string;
  suggestions: string[];
};

type ConversationContentDocument = {
  meta?: LocaleDocumentMeta;
  buttons: Partial<Record<ConversationEntryId, Partial<ConversationContentEntry>>>;
};

function asConversationContentDocument(value: unknown): ConversationContentDocument {
  if (!value || typeof value !== "object") {
    throw new Error("Conversation content document must be an object.");
  }

  const candidate = value as Partial<ConversationContentDocument>;

  if (!candidate.buttons || typeof candidate.buttons !== "object") {
    throw new Error("Conversation content document must include a buttons object.");
  }

  if (candidate.meta !== undefined && typeof candidate.meta !== "object") {
    throw new Error("Conversation content meta must be an object when present.");
  }

  return candidate as ConversationContentDocument;
}

const contentDocuments = buildLanguageDocumentMap({
  en: asConversationContentDocument(en),
  es: asConversationContentDocument(es),
  vi: asConversationContentDocument(vi),
  so: asConversationContentDocument(so),
  ru: asConversationContentDocument(ru),
  am: asConversationContentDocument(am),
  zh: asConversationContentDocument(zh),
});

export function getConversationContentEntry(
  entryId: ConversationEntryId,
  languageCode: SupportedLanguageCode,
) {
  const englishEntry = contentDocuments.en.buttons[entryId];
  const localizedEntry = contentDocuments[languageCode].buttons[entryId];

  return {
    label: localizedEntry?.label ?? englishEntry?.label ?? "",
    assistantMessage:
      localizedEntry?.assistantMessage ?? englishEntry?.assistantMessage ?? "",
    suggestions: localizedEntry?.suggestions ?? englishEntry?.suggestions ?? [],
  };
}
