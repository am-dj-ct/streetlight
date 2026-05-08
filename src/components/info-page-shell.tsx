import Link from "next/link";
import { CrisisFooter } from "./crisis-footer";
import { LanguageStripLinks } from "./language-strip-links";
import { getUiCopy, hasTranslatedUiCopy } from "../lib/ui-copy";
import type { RegionScope } from "../lib/geo";
import type { LanguageOption, SupportedLanguageCode } from "../lib/languages";
import type { ReportArea } from "../lib/report-areas";
import { buildHomeHref, type InternalAppPath } from "../lib/routes";

type InfoPageShellProps = {
  area?: ReportArea;
  currentLanguage: LanguageOption;
  regionScope: RegionScope;
  sourcePath?: InternalAppPath;
  title: string;
  lastUpdated: string;
  getLanguageHref: (languageCode: SupportedLanguageCode) => string;
  children: React.ReactNode;
};

export function InfoPageShell({
  area,
  currentLanguage,
  regionScope,
  sourcePath,
  title,
  lastUpdated,
  getLanguageHref,
  children,
}: InfoPageShellProps) {
  const copy = getUiCopy(currentLanguage.code);
  const hasTranslatedCopy = hasTranslatedUiCopy(currentLanguage.code);

  return (
    <main className="flex h-dvh flex-col overflow-hidden bg-[#f7f8f4] text-[#202124]">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col overflow-y-auto px-4 pt-3 pb-4">
        <header className="pb-4">
          <div className="flex items-center justify-between">
            <Link
              href={buildHomeHref(currentLanguage.code)}
              aria-label={copy.homeLabel}
              className="flex min-h-10 min-w-10 items-center justify-center rounded-full border border-[#cfd7cf] bg-white text-[20px] leading-none text-[#1d2a22]"
            >
              <span aria-hidden="true">{"<"}</span>
            </Link>
          </div>
          <div className="pt-3">
            <LanguageStripLinks
              currentLanguageCode={currentLanguage.code}
              getHref={getLanguageHref}
            />
          </div>

          <h1 className="pt-4 text-[28px] font-semibold leading-[1.16] text-[#171a18]">
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
        </header>

        <section className="flex-1 space-y-6 pb-4">{children}</section>
      </div>

      <CrisisFooter
        area={area}
        languageCode={currentLanguage.code}
        regionScope={regionScope}
        sourcePath={sourcePath}
      />
    </main>
  );
}
