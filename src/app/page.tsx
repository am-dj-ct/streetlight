import { headers } from "next/headers";
import Link from "next/link";
import type { Metadata } from "next";
import { CrisisFooter } from "../components/crisis-footer";
import { LanguageStripLinks } from "../components/language-strip-links";
import { LocalDevBadge } from "../components/local-dev-badge";
import { getAlternateActions, getPromptButtons } from "../lib/buttons";
import { getPageRequestContext } from "../lib/request-context";
import { buildConversationHref, buildHomeHref } from "../lib/routes";
import { defaultDescription } from "../lib/site-metadata";

type HomePageProps = {
  searchParams: Promise<{
    lang?: string;
  }>;
};

export async function generateMetadata({
  searchParams,
}: HomePageProps): Promise<Metadata> {
  const requestHeaders = await headers();
  const { lang } = await searchParams;
  const { copy } = getPageRequestContext({
    requestHeaders,
    requestedLanguageCode: lang,
  });

  return {
    description: copy.metaDefaultDescription ?? defaultDescription,
  };
}

export default async function Home({ searchParams }: HomePageProps) {
  const requestHeaders = await headers();
  const { lang } = await searchParams;
  const {
    copy,
    currentLanguage,
    hasTranslatedCopy,
    regionScope,
  } = getPageRequestContext({
    requestHeaders,
    requestedLanguageCode: lang,
  });
  const promptButtons = getPromptButtons(currentLanguage.code);
  const alternateActions = getAlternateActions(currentLanguage.code);

  return (
    <main className="flex h-dvh flex-col overflow-hidden bg-[#f7f8f4] text-[#202124]">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col overflow-y-auto px-4 pt-4 pb-4 sm:max-w-2xl sm:px-6 lg:max-w-4xl lg:px-8 lg:pt-7">
        <div className="pb-4">
          <LanguageStripLinks
            currentLanguageCode={currentLanguage.code}
            getHref={buildHomeHref}
          />
        </div>

        <section className="flex-1 pb-4 lg:pb-8">
          <LocalDevBadge className="pb-3" languageCode={currentLanguage.code} />
          <h1 className="pt-2 text-[28px] font-semibold leading-[1.16] text-[#171a18] sm:text-[34px]">
            <span className="block">{copy.landingHeadingLineOne}</span>
            <span className="block">{copy.landingHeadingLineTwo}</span>
          </h1>
          <p className="max-w-[42rem] pt-3 text-[15px] leading-6 text-[#4d5c53] sm:text-[16px]">
            {copy.landingScopeNote}
          </p>
          {!hasTranslatedCopy && currentLanguage.code !== "en" ? (
            <p className="pt-2 text-[14px] leading-6 text-[#5f6d64]">
              {copy.translationNotice}
            </p>
          ) : null}

          <div className="mt-5 grid gap-2.5 lg:grid-cols-2 lg:gap-3">
            {promptButtons.map((button) => (
              <Link
                key={button.id}
                href={buildConversationHref({
                  entryId: button.id,
                  languageCode: currentLanguage.code,
                })}
                className="flex min-h-16 w-full items-center rounded-lg border border-[#b7c7bd] bg-white px-4 py-3 text-left text-[17px] font-semibold leading-6 text-[#1d2a22] shadow-[0_1px_0_rgba(29,42,34,0.08)] sm:px-5"
              >
                {button.label}
              </Link>
            ))}

            {alternateActions.map((action) => (
              <Link
                key={action.id}
                href={buildConversationHref({
                  entryId: action.id,
                  languageCode: currentLanguage.code,
                })}
                className="flex min-h-16 w-full items-center rounded-lg border border-[#b7c7bd] bg-white px-4 py-3 text-left text-[17px] font-semibold leading-6 text-[#1d2a22] shadow-[0_1px_0_rgba(29,42,34,0.08)] sm:px-5"
              >
                {action.label}
              </Link>
            ))}
          </div>
        </section>

      </div>
      <CrisisFooter
        area="main-screen"
        languageCode={currentLanguage.code}
        regionScope={regionScope}
        sourcePath={buildHomeHref(currentLanguage.code)}
      />
    </main>
  );
}
