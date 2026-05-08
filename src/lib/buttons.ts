import { getConversationContentEntry } from "./conversation-content";
import type { SupportedLanguageCode } from "./languages";

export type PromptButtonId =
  | "understand-letter-or-form"
  | "write-something"
  | "think-it-through"
  | "figure-out-next"
  | "explain-like-new"
  | "prepare-for-hard"
  | "am-i-being-unreasonable"
  | "embarrassed-to-ask";

export type PromptButton = {
  id: PromptButtonId;
  label: string;
  systemPrompt: string;
};

export type AlternateAction = {
  id: "type-your-own" | "talk-instead";
  label: string;
};

function getEnglishConversationLabel(id: PromptButtonId | AlternateAction["id"]) {
  return getConversationContentEntry(id, "en").label;
}

export const promptButtons: readonly PromptButton[] = [
  {
    id: "understand-letter-or-form",
    label: getEnglishConversationLabel("understand-letter-or-form"),
    systemPrompt: "",
  },
  {
    id: "write-something",
    label: getEnglishConversationLabel("write-something"),
    systemPrompt: "",
  },
  {
    id: "think-it-through",
    label: getEnglishConversationLabel("think-it-through"),
    systemPrompt: "",
  },
  {
    id: "figure-out-next",
    label: getEnglishConversationLabel("figure-out-next"),
    systemPrompt: "",
  },
  {
    id: "explain-like-new",
    label: getEnglishConversationLabel("explain-like-new"),
    systemPrompt: "",
  },
  {
    id: "prepare-for-hard",
    label: getEnglishConversationLabel("prepare-for-hard"),
    systemPrompt: "",
  },
  {
    id: "am-i-being-unreasonable",
    label: getEnglishConversationLabel("am-i-being-unreasonable"),
    systemPrompt: "",
  },
  {
    id: "embarrassed-to-ask",
    label: getEnglishConversationLabel("embarrassed-to-ask"),
    systemPrompt: "",
  },
];

export const alternateActions: readonly AlternateAction[] = [
  { id: "type-your-own", label: getEnglishConversationLabel("type-your-own") },
  { id: "talk-instead", label: getEnglishConversationLabel("talk-instead") },
];

export function getPromptButtons(languageCode: SupportedLanguageCode): readonly PromptButton[] {
  return promptButtons.map((button) => ({
    ...button,
    label: getConversationContentEntry(button.id, languageCode).label,
  }));
}

export function getAlternateActions(
  languageCode: SupportedLanguageCode,
): readonly AlternateAction[] {
  return alternateActions.map((action) => ({
    ...action,
    label: getConversationContentEntry(action.id, languageCode).label,
  }));
}
