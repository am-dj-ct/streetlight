import { headers } from "next/headers";
import Link from "next/link";
import type { Metadata } from "next";
import { InfoPageShell } from "../../components/info-page-shell";
import { getRegionScope } from "../../lib/geo";
import {
  getLanguageOption,
  getPreferredLanguageCode,
  languageHeaderName,
} from "../../lib/languages";
import { getStaticPageContent } from "../../lib/static-pages";
import { makeTitle } from "../../lib/site-metadata";
import { getUiCopy } from "../../lib/ui-copy";

type PrivacyPageProps = {
  searchParams: Promise<{
    lang?: string;
  }>;
};

export async function generateMetadata({
  searchParams,
}: PrivacyPageProps): Promise<Metadata> {
  const requestHeaders = await headers();
  const { lang } = await searchParams;
  const languageCode = getPreferredLanguageCode({
    acceptLanguageHeader: requestHeaders.get("accept-language"),
    requestedLanguageCode: lang,
    storedLanguageCode: requestHeaders.get(languageHeaderName),
  });
  const copy = getUiCopy(languageCode);
  const page = getStaticPageContent("privacy", languageCode);

  return {
    title: makeTitle(page.title),
    description: copy.metaPrivacyDescription,
  };
}

export default async function PrivacyPage({ searchParams }: PrivacyPageProps) {
  const requestHeaders = await headers();
  const { lang } = await searchParams;
  const languageCode = getPreferredLanguageCode({
    acceptLanguageHeader: requestHeaders.get("accept-language"),
    requestedLanguageCode: lang,
    storedLanguageCode: requestHeaders.get(languageHeaderName),
  });
  const currentLanguage = getLanguageOption(languageCode);
  const copy = getUiCopy(languageCode);
  const regionScope = getRegionScope({
    countryHeader: requestHeaders.get("x-vercel-ip-country"),
    regionHeader: requestHeaders.get("x-vercel-ip-country-region"),
  });
  const page = getStaticPageContent("privacy", languageCode);

  return (
    <InfoPageShell
      area="privacy"
      currentLanguage={currentLanguage}
      regionScope={regionScope}
      sourcePath={`/privacy?lang=${languageCode}`}
      title={page.title}
      lastUpdated={page.lastUpdated}
      getLanguageHref={(nextLanguageCode) => `/privacy?lang=${nextLanguageCode}`}
    >
      {page.sections.map((section) => (
        <article key={section.heading} className="space-y-3">
          <h2 className="text-[20px] font-semibold leading-7 text-[#171a18]">
            {section.heading}
          </h2>
          {section.paragraphs.map((paragraph) => (
            <p key={paragraph} className="text-[17px] leading-7 text-[#334139]">
              {paragraph}
            </p>
          ))}
          {section.bullets?.length ? (
            <ul className="list-disc space-y-2 pl-5 text-[17px] leading-7 text-[#334139]">
              {section.bullets.map((bullet) => (
                <li key={bullet}>{bullet}</li>
              ))}
            </ul>
          ) : null}
        </article>
      ))}

      <section className="rounded-[18px] border border-[#cfd7cf] bg-white px-4 py-4 text-[16px] leading-6 text-[#334139] shadow-[0_1px_0_rgba(29,42,34,0.08)]">
        <Link
          href={`/report-problem?lang=${languageCode}&area=privacy&source=${encodeURIComponent(`/privacy?lang=${languageCode}`)}`}
          className="font-semibold underline"
        >
          {copy.reportProblemByEmail}
        </Link>
        <p className="pt-2">
          {copy.goBackPrefix}{" "}
          <Link href={`/?lang=${languageCode}`} className="font-semibold underline">
            {copy.backToMainScreen}
          </Link>
          .
        </p>
      </section>
    </InfoPageShell>
  );
}
