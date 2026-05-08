import { promptButtons, type AlternateAction, alternateActions } from "./buttons";
import { getConversationContentEntry } from "./conversation-content";
import type { PromptButtonId } from "./buttons";
import type { ConversationEntryId } from "./chat-types";
import type { SupportedLanguageCode } from "./languages";

export type ConversationSeed = {
  id: ConversationEntryId;
  label: string;
  assistantMessage: string;
  suggestions: readonly string[];
};

const promptConversationSeeds: Record<PromptButtonId, ConversationSeed> = {
  "understand-letter-or-form": {
    id: "understand-letter-or-form",
    label: getConversationContentEntry("understand-letter-or-form", "en").label,
    assistantMessage: getConversationContentEntry("understand-letter-or-form", "en").assistantMessage,
    suggestions: getConversationContentEntry("understand-letter-or-form", "en").suggestions,
  },
  "write-something": {
    id: "write-something",
    label: getConversationContentEntry("write-something", "en").label,
    assistantMessage: getConversationContentEntry("write-something", "en").assistantMessage,
    suggestions: getConversationContentEntry("write-something", "en").suggestions,
  },
  "think-it-through": {
    id: "think-it-through",
    label: getConversationContentEntry("think-it-through", "en").label,
    assistantMessage: getConversationContentEntry("think-it-through", "en").assistantMessage,
    suggestions: getConversationContentEntry("think-it-through", "en").suggestions,
  },
  "figure-out-next": {
    id: "figure-out-next",
    label: getConversationContentEntry("figure-out-next", "en").label,
    assistantMessage: getConversationContentEntry("figure-out-next", "en").assistantMessage,
    suggestions: getConversationContentEntry("figure-out-next", "en").suggestions,
  },
  "explain-like-new": {
    id: "explain-like-new",
    label: getConversationContentEntry("explain-like-new", "en").label,
    assistantMessage: getConversationContentEntry("explain-like-new", "en").assistantMessage,
    suggestions: getConversationContentEntry("explain-like-new", "en").suggestions,
  },
  "prepare-for-hard": {
    id: "prepare-for-hard",
    label: getConversationContentEntry("prepare-for-hard", "en").label,
    assistantMessage: getConversationContentEntry("prepare-for-hard", "en").assistantMessage,
    suggestions: getConversationContentEntry("prepare-for-hard", "en").suggestions,
  },
  "am-i-being-unreasonable": {
    id: "am-i-being-unreasonable",
    label: getConversationContentEntry("am-i-being-unreasonable", "en").label,
    assistantMessage: getConversationContentEntry("am-i-being-unreasonable", "en").assistantMessage,
    suggestions: getConversationContentEntry("am-i-being-unreasonable", "en").suggestions,
  },
  "embarrassed-to-ask": {
    id: "embarrassed-to-ask",
    label: getConversationContentEntry("embarrassed-to-ask", "en").label,
    assistantMessage: getConversationContentEntry("embarrassed-to-ask", "en").assistantMessage,
    suggestions: getConversationContentEntry("embarrassed-to-ask", "en").suggestions,
  },
};

const alternateConversationSeeds: Record<AlternateAction["id"], ConversationSeed> = {
  "type-your-own": {
    id: "type-your-own",
    label: getConversationContentEntry("type-your-own", "en").label,
    assistantMessage: getConversationContentEntry("type-your-own", "en").assistantMessage,
    suggestions: getConversationContentEntry("type-your-own", "en").suggestions,
  },
  "talk-instead": {
    id: "talk-instead",
    label: getConversationContentEntry("talk-instead", "en").label,
    assistantMessage: getConversationContentEntry("talk-instead", "en").assistantMessage,
    suggestions: getConversationContentEntry("talk-instead", "en").suggestions,
  },
};

export const conversationSeeds: readonly ConversationSeed[] = [
  ...promptButtons.map((button) => promptConversationSeeds[button.id]),
  ...alternateActions.map((action) => alternateConversationSeeds[action.id]),
];

export function getConversationSeed(
  entryId: string,
): ConversationSeed | undefined {
  return conversationSeeds.find((entry) => entry.id === entryId);
}

export function getLocalizedConversationSeed(
  entryId: string,
  languageCode: SupportedLanguageCode,
): ConversationSeed | undefined {
  const seed = getConversationSeed(entryId);

  if (!seed) {
    return undefined;
  }

  const localized = getConversationContentEntry(seed.id, languageCode);

  return {
    ...seed,
    label: localized.label,
    assistantMessage: localized.assistantMessage,
    suggestions: localized.suggestions,
  };
}
