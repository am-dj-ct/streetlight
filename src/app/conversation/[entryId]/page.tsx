import { headers } from "next/headers";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ConversationClient } from "../../../components/conversation-client";
import { LocalDevBadge } from "../../../components/local-dev-badge";
import {
  conversationSeeds,
  getLocalizedConversationSeed,
} from "../../../lib/conversation-shell";
import { getRegionScope } from "../../../lib/geo";
import {
  getLanguageOption,
  getRequestLanguageCode,
} from "../../../lib/languages";
import { makeTitle } from "../../../lib/site-metadata";
import { getUiCopy } from "../../../lib/ui-copy";

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
  const languageCode = getRequestLanguageCode({
    requestHeaders,
    requestedLanguageCode: lang,
  });
  const copy = getUiCopy(languageCode);
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
  const languageCode = getRequestLanguageCode({
    requestHeaders,
    requestedLanguageCode: lang,
  });
  const seed = getLocalizedConversationSeed(entryId, languageCode);

  if (!seed) {
    notFound();
  }

  const currentLanguage = getLanguageOption(languageCode);
  const regionScope = getRegionScope({
    countryHeader: requestHeaders.get("x-vercel-ip-country"),
    regionHeader: requestHeaders.get("x-vercel-ip-country-region"),
  });

  return (
    <>
      <LocalDevBadge
        className="mx-auto flex w-full max-w-md px-4 pt-4"
        languageCode={currentLanguage.code}
      />
      <ConversationClient
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
