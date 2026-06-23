import { headers } from "next/headers";
import type { Metadata } from "next";
import { CrisisFooter } from "../components/crisis-footer";
import { LanguageStripLinks } from "../components/language-strip-links";
import { LocalDevBadge } from "../components/local-dev-badge";
import { TrackedConversationLink } from "../components/tracked-conversation-link";
import { getAlternateActions, getPromptButtons } from "../lib/buttons";
import { getPageRequestContext } from "../lib/request-context";
import { buildConversationHref, buildHomeHref } from "../lib/routes";
import { appTitle, defaultDescription } from "../lib/site-metadata";

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
    <main className="flex h-dvh flex-col overflow-hidden bg-[#f7f8f4] text-[#202124] print:h-auto print:overflow-visible">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col overflow-y-auto px-4 pt-4 pb-4 sm:max-w-2xl sm:px-6 lg:max-w-4xl lg:px-8 lg:pt-7 print:overflow-visible">
        <header className="pb-4">
          <div className="sm:flex sm:items-start sm:justify-between sm:gap-4">
            <p className="text-[24px] font-semibold leading-8 text-[#171a18] sm:text-[24px] sm:leading-10">
              {appTitle}
            </p>
            <div className="-mx-4 mt-3 border-y border-[#e1e8e2] bg-[#f7f8f4] px-4 py-1 sm:mx-0 sm:mt-0 sm:flex-1 sm:border-0 sm:bg-transparent sm:px-0 sm:py-0">
              <LanguageStripLinks
                align="end"
                currentLanguageCode={currentLanguage.code}
                getHref={buildHomeHref}
                mobileScroll
              />
            </div>
          </div>
        </header>

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
              <TrackedConversationLink
                key={button.id}
                entryId={button.id}
                href={buildConversationHref({
                  entryId: button.id,
                  languageCode: currentLanguage.code,
                })}
                languageCode={currentLanguage.code}
                className="flex min-h-16 w-full items-center rounded-lg border border-[#b7c7bd] bg-white px-4 py-3 text-left text-[17px] font-semibold leading-6 text-[#1d2a22] shadow-[0_1px_0_rgba(29,42,34,0.08)] sm:px-5"
              >
                {button.label}
              </TrackedConversationLink>
            ))}

            {alternateActions.map((action) => (
              <TrackedConversationLink
                key={action.id}
                entryId={action.id}
                href={buildConversationHref({
                  entryId: action.id,
                  languageCode: currentLanguage.code,
                })}
                languageCode={currentLanguage.code}
                className="flex min-h-16 w-full items-center rounded-lg border border-[#b7c7bd] bg-white px-4 py-3 text-left text-[17px] font-semibold leading-6 text-[#1d2a22] shadow-[0_1px_0_rgba(29,42,34,0.08)] sm:px-5"
              >
                {action.label}
              </TrackedConversationLink>
            ))}
          </div>
        </section>

      </div>
      <CrisisFooter
        area="main-screen"
        compact
        languageCode={currentLanguage.code}
        regionScope={regionScope}
        showFindHumanInCompact
        sourcePath={buildHomeHref(currentLanguage.code)}
      />
    </main>
  );
}
