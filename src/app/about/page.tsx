import { headers } from "next/headers";
import Link from "next/link";
import type { Metadata } from "next";
import { InfoPageShell } from "../../components/info-page-shell";
import { getRegionScope } from "../../lib/geo";
import {
  getLanguageOption,
  getPreferredLanguageCode,
} from "../../lib/languages";
import { getStaticPageContent } from "../../lib/static-pages";
import { makeTitle } from "../../lib/site-metadata";
import { getUiCopy } from "../../lib/ui-copy";

export const metadata: Metadata = {
  title: makeTitle("About"),
  description: "What Access Tool is, what it is not, and who runs it.",
};

type AboutPageProps = {
  searchParams: Promise<{
    lang?: string;
  }>;
};

export default async function AboutPage({ searchParams }: AboutPageProps) {
  const requestHeaders = await headers();
  const { lang } = await searchParams;
  const languageCode = getPreferredLanguageCode({
    acceptLanguageHeader: requestHeaders.get("accept-language"),
    requestedLanguageCode: lang,
  });
  const currentLanguage = getLanguageOption(languageCode);
  const copy = getUiCopy(languageCode);
  const regionScope = getRegionScope({
    countryHeader: requestHeaders.get("x-vercel-ip-country"),
    regionHeader: requestHeaders.get("x-vercel-ip-country-region"),
  });
  const page = getStaticPageContent("about", languageCode);

  return (
    <InfoPageShell
      currentLanguage={currentLanguage}
      regionScope={regionScope}
      title={page.title}
      lastUpdated={page.lastUpdated}
      getLanguageHref={(nextLanguageCode) => `/about?lang=${nextLanguageCode}`}
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
        </article>
      ))}

      <section className="rounded-[18px] border border-[#cfd7cf] bg-white px-4 py-4 text-[16px] leading-6 text-[#334139] shadow-[0_1px_0_rgba(29,42,34,0.08)]">
        <Link
          href={`/report-problem?lang=${languageCode}&area=about`}
          className="font-semibold underline"
        >
          {copy.reportProblemByEmail}
        </Link>
      </section>
    </InfoPageShell>
  );
}
