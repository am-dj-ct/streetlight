import { headers } from "next/headers";
import Link from "next/link";
import { CrisisFooter } from "../components/crisis-footer";
import { getAlternateActions, getPromptButtons } from "../lib/buttons";
import { getRegionScope } from "../lib/geo";
import {
  getLanguageOption,
  getPreferredLanguageCode,
  languageOptions,
} from "../lib/languages";
import { getUiCopy, hasTranslatedUiCopy } from "../lib/ui-copy";

type HomePageProps = {
  searchParams: Promise<{
    lang?: string;
  }>;
};

export default async function Home({ searchParams }: HomePageProps) {
  const requestHeaders = await headers();
  const { lang } = await searchParams;
  const languageCode = getPreferredLanguageCode({
    acceptLanguageHeader: requestHeaders.get("accept-language"),
    requestedLanguageCode: lang,
  });
  const currentLanguage = getLanguageOption(languageCode);
  const promptButtons = getPromptButtons(currentLanguage.code);
  const alternateActions = getAlternateActions(currentLanguage.code);
  const regionScope = getRegionScope({
    countryHeader: requestHeaders.get("x-vercel-ip-country"),
    regionHeader: requestHeaders.get("x-vercel-ip-country-region"),
  });
  const copy = getUiCopy(languageCode);
  const hasTranslatedCopy = hasTranslatedUiCopy(languageCode);

  return (
    <main className="flex h-dvh flex-col overflow-hidden bg-[#f7f8f4] text-[#202124]">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col overflow-y-auto px-4 pt-4 pb-4">
        <nav
          aria-label={copy.chooseLanguageLabel}
          className="flex flex-wrap items-center gap-x-1 gap-y-1 pb-4 text-[15px] leading-6 text-[#314036]"
        >
          {languageOptions.map((language, i) => (
            <span key={language.code} className="flex items-center gap-x-1">
              <Link
                href={`/?lang=${language.code}`}
                className={`min-h-10 px-1 font-medium underline-offset-4 hover:underline ${
                  language.code === currentLanguage.code ? "underline" : ""
                }`}
              >
                {language.label}
              </Link>
              {i < languageOptions.length - 1 && (
                <span aria-hidden="true" className="text-[#8a9b8f]">
                  ·
                </span>
              )}
            </span>
          ))}
        </nav>

        <section className="flex-1 pb-4">
          <h1 className="pt-2 text-[28px] font-semibold leading-[1.16] text-[#171a18]">
            <span className="block">{copy.landingHeadingLineOne}</span>
            <span className="block">{copy.landingHeadingLineTwo}</span>
          </h1>
          <p className="pt-3 max-w-[28rem] text-[15px] leading-6 text-[#4d5c53]">
            {copy.landingScopeNote}
          </p>
          {!hasTranslatedCopy && currentLanguage.code !== "en" ? (
            <p className="pt-2 text-[14px] leading-6 text-[#5f6d64]">
              {copy.translationNotice}
            </p>
          ) : null}

          <div className="mt-5 flex flex-col gap-2.5">
            {promptButtons.map((button) => (
              <Link
                key={button.id}
                href={`/conversation/${button.id}?lang=${currentLanguage.code}`}
                className="flex min-h-16 w-full items-center rounded-lg border border-[#b7c7bd] bg-white px-4 py-3 text-left text-[17px] font-semibold leading-6 text-[#1d2a22] shadow-[0_1px_0_rgba(29,42,34,0.08)]"
              >
                {button.label}
              </Link>
            ))}

            {alternateActions.map((action) => (
              <Link
                key={action.id}
                href={`/conversation/${action.id}?lang=${currentLanguage.code}`}
                className="flex min-h-16 w-full items-center rounded-lg border border-[#b7c7bd] bg-white px-4 py-3 text-left text-[17px] font-semibold leading-6 text-[#1d2a22] shadow-[0_1px_0_rgba(29,42,34,0.08)]"
              >
                {action.label}
              </Link>
            ))}
          </div>
        </section>

      </div>
      <CrisisFooter languageCode={currentLanguage.code} regionScope={regionScope} />
    </main>
  );
}
