import { headers } from "next/headers";
import Link from "next/link";
import type { Metadata } from "next";
import { CrisisFooter } from "../components/crisis-footer";
import { LanguageStripLinks } from "../components/language-strip-links";
import { getPageRequestContext } from "../lib/request-context";
import { buildHomeHref } from "../lib/routes";
import { appTitle, makeTitle } from "../lib/site-metadata";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const { copy } = getPageRequestContext({ requestHeaders });

  return {
    title: makeTitle(copy.notFoundTitle),
  };
}

export default async function NotFound() {
  const requestHeaders = await headers();
  const { copy, currentLanguage, regionScope } = getPageRequestContext({
    requestHeaders,
  });

  return (
    <main className="flex h-dvh flex-col overflow-hidden bg-[#f7f8f4] text-[#202124]">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col overflow-y-auto px-4 pt-3 pb-4 sm:max-w-2xl sm:px-6 lg:max-w-3xl lg:px-8 lg:pt-6">
        <header className="pb-4 lg:pb-6">
          <div className="grid grid-cols-[auto_1fr_auto] items-center gap-3">
            <Link
              href={buildHomeHref(currentLanguage.code)}
              aria-label={copy.homeLabel}
              className="flex min-h-10 min-w-10 items-center justify-center rounded-full border border-[#cfd7cf] bg-white text-[20px] leading-none text-[#1d2a22]"
            >
              <span aria-hidden="true">{"<"}</span>
            </Link>
            <p className="truncate text-center text-[16px] font-semibold text-[#171a18]">
              {appTitle}
            </p>
            <span aria-hidden="true" className="min-h-10 min-w-10" />
          </div>
          <div className="pt-3">
            <LanguageStripLinks
              currentLanguageCode={currentLanguage.code}
              getHref={(nextLanguageCode) => buildHomeHref(nextLanguageCode)}
            />
          </div>
        </header>

        <section className="flex-1 space-y-4 pb-4 lg:pb-8">
          <h1 className="text-[28px] font-semibold leading-[1.16] text-[#171a18] sm:text-[34px]">
            {copy.notFoundTitle}
          </h1>
          <p className="text-[17px] leading-7 text-[#334139]">
            {copy.notFoundBody}
          </p>
          <p>
            <Link
              href={buildHomeHref(currentLanguage.code)}
              className="inline-flex min-h-12 items-center justify-center rounded-[16px] bg-[#24594d] px-5 text-[16px] font-semibold text-white shadow-[0_2px_8px_rgba(31,95,67,0.2)] transition-colors hover:bg-[#1d4a40]"
            >
              {copy.notFoundHomeCta}
            </Link>
          </p>
        </section>
      </div>

      <CrisisFooter
        compact
        languageCode={currentLanguage.code}
        regionScope={regionScope}
        showFindHumanInCompact
      />
    </main>
  );
}
