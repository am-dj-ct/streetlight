import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { ConversationClient } from "../../../components/conversation-client";
import { getConversationSeed, conversationSeeds } from "../../../lib/conversation-shell";
import { getRegionScope } from "../../../lib/geo";
import {
  getLanguageOption,
  getPreferredLanguageCode,
} from "../../../lib/languages";

type ConversationPageProps = {
  params: Promise<{
    entryId: string;
  }>;
  searchParams: Promise<{
    lang?: string;
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
  searchParams,
}: ConversationPageProps) {
  const requestHeaders = await headers();
  const { entryId } = await params;
  const { lang } = await searchParams;
  const seed = getConversationSeed(entryId);

  if (!seed) {
    notFound();
  }

  const languageCode = getPreferredLanguageCode({
    acceptLanguageHeader: requestHeaders.get("accept-language"),
    requestedLanguageCode: lang,
  });
  const currentLanguage = getLanguageOption(languageCode);
  const regionScope = getRegionScope({
    countryHeader: requestHeaders.get("x-vercel-ip-country"),
    regionHeader: requestHeaders.get("x-vercel-ip-country-region"),
  });

  return (
    <ConversationClient
      currentLanguageCode={currentLanguage.code}
      currentLanguageLabel={currentLanguage.label}
      entryId={seed.id}
      initialAssistantMessage={seed.assistantMessage}
      initialSuggestions={seed.suggestions}
      regionScope={regionScope}
    />
  );
}
