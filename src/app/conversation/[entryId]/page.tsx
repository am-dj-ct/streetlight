import { headers } from "next/headers";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ConversationClient } from "../../../components/conversation-client";
import { LocalDevBadge } from "../../../components/local-dev-badge";
import {
  conversationSeeds,
  getLocalizedConversationSeed,
} from "../../../lib/conversation-shell";
import { getPageRequestContext } from "../../../lib/request-context";
import { makeTitle } from "../../../lib/site-metadata";

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

export async function generateMetadata({
  params,
  searchParams,
}: ConversationPageProps): Promise<Metadata> {
  const requestHeaders = await headers();
  const { entryId } = await params;
  const { lang } = await searchParams;
  const { copy, languageCode } = getPageRequestContext({
    requestHeaders,
    requestedLanguageCode: lang,
  });
  const seed = getLocalizedConversationSeed(entryId, languageCode);

  return {
    title: makeTitle(seed?.label ?? copy.metaConversationFallbackTitle),
    description: copy.metaConversationDescription,
  };
}

export const dynamicParams = false;

export default async function ConversationPage({
  params,
  searchParams,
}: ConversationPageProps) {
  const requestHeaders = await headers();
  const { entryId } = await params;
  const { lang } = await searchParams;
  const { currentLanguage, languageCode, regionScope } = getPageRequestContext({
    requestHeaders,
    requestedLanguageCode: lang,
  });
  const seed = getLocalizedConversationSeed(entryId, languageCode);

  if (!seed) {
    notFound();
  }

  return (
    <>
      <LocalDevBadge
        className="mx-auto flex w-full max-w-md px-4 pt-4 sm:max-w-2xl sm:px-6 lg:max-w-3xl lg:px-8"
        languageCode={currentLanguage.code}
      />
      <ConversationClient
        key={`${seed.id}-${currentLanguage.code}`}
        currentLanguageCode={currentLanguage.code}
        currentLanguageLabel={currentLanguage.label}
        entryId={seed.id}
        initialAssistantMessage={seed.assistantMessage}
        initialSuggestions={seed.suggestions}
        regionScope={regionScope}
      />
    </>
  );
}
