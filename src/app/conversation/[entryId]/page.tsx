import { notFound } from "next/navigation";
import { ConversationClient } from "../../../components/conversation-client";
import { getConversationSeed, conversationSeeds } from "../../../lib/conversation-shell";
import { languageOptions } from "../../../lib/languages";

type ConversationPageProps = {
  params: Promise<{
    entryId: string;
  }>;
};

export function generateStaticParams() {
  return conversationSeeds.map((entry) => ({
    entryId: entry.id,
  }));
}

export const dynamicParams = false;

export default async function ConversationPage({
  params,
}: ConversationPageProps) {
  const { entryId } = await params;
  const seed = getConversationSeed(entryId);

  if (!seed) {
    notFound();
  }

  const currentLanguage = languageOptions[0];

  return (
    <ConversationClient
      currentLanguageLabel={currentLanguage.label}
      entryId={seed.id}
      initialAssistantMessage={seed.assistantMessage}
      initialSuggestions={seed.suggestions}
    />
  );
}
