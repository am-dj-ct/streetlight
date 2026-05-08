import { alternateActions, promptButtons, type AlternateAction } from "./buttons";
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

function buildEnglishConversationSeed(
  id: PromptButtonId | AlternateAction["id"],
): ConversationSeed {
  const content = getConversationContentEntry(id, "en");

  return {
    id,
    label: content.label,
    assistantMessage: content.assistantMessage,
    suggestions: content.suggestions,
  };
}

export const conversationSeeds: readonly ConversationSeed[] = [
  ...promptButtons.map((button) => buildEnglishConversationSeed(button.id)),
  ...alternateActions.map((action) => buildEnglishConversationSeed(action.id)),
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
