import Link from "next/link";
import { headers } from "next/headers";
import type { Metadata } from "next";
import { CrisisFooter } from "../../components/crisis-footer";
import { LanguageStripLinks } from "../../components/language-strip-links";
import { getRegionScope } from "../../lib/geo";
import {
  getLanguageOption,
  getPreferredLanguageCode,
} from "../../lib/languages";
import {
  formatTelephoneHref,
  getBackHrefForReferrals,
  getCheckedThroughDate,
  getReferralsForCategory,
  getWeakCategoryLabel,
  isReferralSpecificToCategory,
  isWeakCategory,
} from "../../lib/referrals";
import { makeTitle } from "../../lib/site-metadata";
import { getUiCopy, hasTranslatedUiCopy } from "../../lib/ui-copy";

export const metadata: Metadata = {
  title: makeTitle("Find a human"),
  description: "Maintained human-help resources, with King County and U.S. fallback options.",
};

type FindHumanPageProps = {
  searchParams: Promise<{
    category?: string;
    entryId?: string;
    lang?: string;
  }>;
};

export default async function FindHumanPage({
  searchParams,
}: FindHumanPageProps) {
  const requestHeaders = await headers();
  const { category: rawCategory, entryId, lang } = await searchParams;
  const languageCode = getPreferredLanguageCode({
    acceptLanguageHeader: requestHeaders.get("accept-language"),
    requestedLanguageCode: lang,
  });
  const currentLanguage = getLanguageOption(languageCode);
  const copy = getUiCopy(languageCode);
  const hasTranslatedCopy = hasTranslatedUiCopy(languageCode);
  const regionScope = getRegionScope({
    countryHeader: requestHeaders.get("x-vercel-ip-country"),
    regionHeader: requestHeaders.get("x-vercel-ip-country-region"),
  });
  const category =
    rawCategory && isWeakCategory(rawCategory) ? rawCategory : undefined;
  const referrals = getReferralsForCategory({ category, regionScope });
  const formatResourceDate = (value: string) =>
    new Intl.DateTimeFormat(currentLanguage.code, {
      dateStyle: "medium",
      timeZone: "UTC",
    }).format(new Date(`${value}T00:00:00Z`));
  const checkedThroughDate = getCheckedThroughDate(referrals);
  const backHref = getBackHrefForReferrals({
    entryId,
    languageCode,
  });
  const categoryLabel = category ? getWeakCategoryLabel(category) : "";
  const formattedCheckedThroughDate = checkedThroughDate
    ? formatResourceDate(checkedThroughDate)
    : null;

  return (
    <main className="flex h-dvh flex-col overflow-hidden bg-[#f7f8f4] text-[#202124]">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col overflow-y-auto px-4 pt-3 pb-4">
        <header className="pb-4">
          <div className="flex items-center justify-between">
            <Link
              href={backHref}
              aria-label={copy.backLabel}
              className="flex min-h-10 min-w-10 items-center justify-center rounded-full border border-[#cfd7cf] bg-white text-[20px] leading-none text-[#1d2a22]"
            >
              <span aria-hidden="true">{"<"}</span>
            </Link>
            <div className="flex items-center gap-2">
              <span className="rounded-full border border-[#cfd7cf] bg-white px-3 py-2 text-[14px] font-medium text-[#314036]">
                {regionScope === "king" ? copy.referralsRegionKing : copy.referralsRegionFallback}
              </span>
            </div>
          </div>
          <div className="pt-3">
            <LanguageStripLinks
              currentLanguageCode={currentLanguage.code}
              getHref={(nextLanguageCode) => {
                const nextParams = new URLSearchParams();

                if (category) {
                  nextParams.set("category", category);
                }

                if (entryId) {
                  nextParams.set("entryId", entryId);
                }

                nextParams.set("lang", nextLanguageCode);

                return `/find-human?${nextParams.toString()}`;
              }}
            />
          </div>

          <h1 className="pt-4 text-[28px] font-semibold leading-[1.16] text-[#171a18]">
            <span className="block">{copy.referralsHeadingLineOne}</span>
            <span className="block">{copy.referralsHeadingLineTwo}</span>
          </h1>
          <p className="pt-3 text-[16px] leading-6 text-[#47564d]">
            {regionScope === "king"
              ? copy.referralsIntroKing
              : copy.referralsIntroFallback}
          </p>
          {formattedCheckedThroughDate ? (
            <p className="pt-2 text-[14px] leading-6 text-[#5f6d64]">
              {copy.referralsCheckedThroughLabel} {formattedCheckedThroughDate}
            </p>
          ) : null}
          {!hasTranslatedCopy && currentLanguage.code !== "en" ? (
            <p className="pt-2 text-[14px] leading-6 text-[#5f6d64]">
              {copy.infoPageTranslationNotice}
            </p>
          ) : null}
        </header>

        {category && category !== "none" ? (
          <section className="mb-4 rounded-[18px] border border-[#ead8b7] bg-[#fff9ef] px-4 py-3 text-[15px] leading-6 text-[#6a4c12]">
            {copy.referralsFilteredPrefix}{" "}
            <span className="font-semibold">{categoryLabel}</span>.
            <div className="pt-2">
              <Link
                href={`/find-human?entryId=${entryId ?? ""}&lang=${languageCode}`}
                className="font-semibold underline"
              >
                {copy.referralsShowAll}
              </Link>
            </div>
          </section>
        ) : null}

        <section className="flex flex-1 flex-col gap-3 pb-4">
          {referrals.map((resource) => {
            const formattedVerifiedDate = formatResourceDate(
              resource.lastVerified,
            );

            return (
              <article
                key={resource.id}
                className="rounded-[18px] border border-[#cfd7cf] bg-white px-4 py-4 shadow-[0_1px_0_rgba(29,42,34,0.08)]"
              >
                <div className="flex items-start justify-between gap-3">
                  <h2 className="text-[18px] font-semibold leading-6 text-[#1f2923]">
                    {resource.name}
                  </h2>
                  {isReferralSpecificToCategory(resource, category) ? (
                    <span className="shrink-0 rounded-full bg-[#edf3ef] px-3 py-1 text-[12px] font-semibold text-[#2d5c45]">
                      {copy.referralsBestFit}
                    </span>
                  ) : null}
                </div>
                <p className="pt-2 text-[15px] leading-6 text-[#47564d]">
                  {resource.description}
                </p>

                <div className="pt-4 flex flex-wrap gap-2">
                  {resource.phone ? (
                    <a
                      href={formatTelephoneHref(resource.phone)}
                      aria-label={`${copy.referralsCallLabel} ${resource.name} ${resource.phone}`}
                      className="flex min-h-11 items-center rounded-full border border-[#b7c7bd] bg-white px-4 text-[15px] font-medium text-[#1d2a22]"
                    >
                      {copy.referralsCallLabel} {resource.phone}
                    </a>
                  ) : null}

                  {resource.secondaryPhone ? (
                    <a
                      href={formatTelephoneHref(resource.secondaryPhone)}
                      aria-label={`${copy.referralsAltLabel} ${resource.name} ${resource.secondaryPhone}`}
                      className="flex min-h-11 items-center rounded-full border border-[#b7c7bd] bg-white px-4 text-[15px] font-medium text-[#1d2a22]"
                    >
                      {copy.referralsAltLabel} {resource.secondaryPhone}
                    </a>
                  ) : null}

                  <a
                    href={resource.website}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`${copy.referralsWebsiteLabel} ${resource.name}`}
                    className="flex min-h-11 items-center rounded-full bg-[#1f5f43] px-4 text-[15px] font-semibold text-white"
                  >
                    {copy.referralsWebsiteLabel}
                  </a>
                </div>

                <div className="mt-4 border-t border-[#e7ece8] pt-4 text-[13px] leading-5 text-[#5f6d64]">
                  <p>
                    {copy.referralsSourceLabel} {resource.sourceName}
                  </p>
                  <p className="pt-1">
                    {copy.referralsVerifiedLabel} {formattedVerifiedDate}
                  </p>
                </div>
              </article>
            );
          })}
        </section>
      </div>

      <CrisisFooter
        area="find-human"
        entryId={entryId}
        languageCode={languageCode}
        regionScope={regionScope}
        sourcePath={(() => {
          const params = new URLSearchParams();

          if (category) {
            params.set("category", category);
          }

          if (entryId) {
            params.set("entryId", entryId);
          }

          params.set("lang", languageCode);
          return `/find-human?${params.toString()}`;
        })()}
      />
    </main>
  );
}
