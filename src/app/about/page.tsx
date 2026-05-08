import { headers } from "next/headers";
import Link from "next/link";
import type { Metadata } from "next";
import { InfoPageShell } from "../../components/info-page-shell";
import { getPageRequestContext } from "../../lib/request-context";
import {
  buildAboutHref,
  buildReportProblemHref,
} from "../../lib/routes";
import { getStaticPageContent } from "../../lib/static-pages";
import { makeTitle } from "../../lib/site-metadata";

type AboutPageProps = {
  searchParams: Promise<{
    lang?: string;
  }>;
};

export async function generateMetadata({
  searchParams,
}: AboutPageProps): Promise<Metadata> {
  const requestHeaders = await headers();
  const { lang } = await searchParams;
  const { copy, languageCode } = getPageRequestContext({
    requestHeaders,
    requestedLanguageCode: lang,
  });
  const page = getStaticPageContent("about", languageCode);

  return {
    title: makeTitle(page.title),
    description: copy.metaAboutDescription,
  };
}

export default async function AboutPage({ searchParams }: AboutPageProps) {
  const requestHeaders = await headers();
  const { lang } = await searchParams;
  const {
    copy,
    currentLanguage,
    languageCode,
    regionScope,
  } = getPageRequestContext({
    requestHeaders,
    requestedLanguageCode: lang,
  });
  const page = getStaticPageContent("about", languageCode);

  return (
    <InfoPageShell
      area="about"
      currentLanguage={currentLanguage}
      regionScope={regionScope}
      sourcePath={buildAboutHref(languageCode)}
      title={page.title}
      lastUpdated={page.lastUpdated}
      getLanguageHref={(nextLanguageCode) => buildAboutHref(nextLanguageCode)}
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
          href={buildReportProblemHref({
            area: "about",
            languageCode,
            sourcePath: buildAboutHref(languageCode),
          })}
          className="font-semibold underline"
        >
          {copy.reportProblemByEmail}
        </Link>
      </section>
    </InfoPageShell>
  );
}
