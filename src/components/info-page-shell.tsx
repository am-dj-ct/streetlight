import Link from "next/link";
import { CrisisFooter } from "./crisis-footer";
import { LanguageStripLinks } from "./language-strip-links";
import { getUiCopy, hasTranslatedUiCopy } from "../lib/ui-copy";
import type { RegionScope } from "../lib/geo";
import type { LanguageOption, SupportedLanguageCode } from "../lib/languages";
import type { ReportArea } from "../lib/report-areas";
import { buildHomeHref, type InternalAppPath } from "../lib/routes";
import { appTitle } from "../lib/site-metadata";

type InfoPageShellProps = {
  area?: ReportArea;
  contentClassName?: string;
  currentLanguage: LanguageOption;
  regionScope: RegionScope;
  sourcePath?: InternalAppPath;
  title: string;
  lastUpdated: string;
  getLanguageHref: (languageCode: SupportedLanguageCode) => InternalAppPath;
  showTitleBlock?: boolean;
  wide?: boolean;
  children: React.ReactNode;
};

export function InfoPageShell({
  area,
  contentClassName,
  currentLanguage,
  regionScope,
  sourcePath,
  title,
  lastUpdated,
  getLanguageHref,
  showTitleBlock = true,
  wide = false,
  children,
}: InfoPageShellProps) {
  const copy = getUiCopy(currentLanguage.code);
  const hasTranslatedCopy = hasTranslatedUiCopy(currentLanguage.code);
  const containerClassName = [
    "mx-auto flex w-full max-w-md flex-1 flex-col overflow-y-auto px-4 pt-3 pb-4 sm:max-w-2xl sm:px-6 lg:px-8 lg:pt-6 print:overflow-visible",
    wide ? "lg:max-w-5xl" : "lg:max-w-3xl",
  ].join(" ");

  return (
    <main className="flex h-dvh flex-col overflow-hidden bg-[#f7f8f4] text-[#202124] print:h-auto print:overflow-visible">
      <div className={containerClassName}>
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
              getHref={getLanguageHref}
            />
          </div>

          {showTitleBlock ? (
            <>
              <h1 className="pt-4 text-[28px] font-semibold leading-[1.16] text-[#171a18] sm:text-[34px]">
                {title}
              </h1>
              <p className="pt-3 text-[14px] leading-6 text-[#5f6d64]">
                {copy.lastUpdatedLabel} {lastUpdated}
              </p>
              {!hasTranslatedCopy && currentLanguage.code !== "en" ? (
                <p className="pt-2 text-[14px] leading-6 text-[#5f6d64]">
                  {copy.infoPageTranslationNotice}
                </p>
              ) : null}
            </>
          ) : (
            <p className="sr-only">
              {title}. {copy.lastUpdatedLabel} {lastUpdated}
            </p>
          )}
        </header>

        <section className={contentClassName ?? "flex-1 space-y-6 pb-4 lg:pb-8"}>
          {children}
        </section>
      </div>

      <CrisisFooter
        area={area}
        compact
        languageCode={currentLanguage.code}
        regionScope={regionScope}
        showFindHumanInCompact
        sourcePath={sourcePath}
      />
    </main>
  );
}
