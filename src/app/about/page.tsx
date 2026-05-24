import { headers } from "next/headers";
import Image from "next/image";
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

function StreetlightAboutImage({
  placement,
}: {
  placement: "desktop" | "mobile";
}) {
  const isMobilePlacement = placement === "mobile";

  return (
    <figure
      className={
        isMobilePlacement
          ? "float-right mb-3 ml-4 w-[36vw] min-w-[7rem] max-w-[9.5rem] overflow-hidden rounded-[14px] border border-[#cfd7cf] bg-[#e8eee8] shadow-[0_1px_0_rgba(29,42,34,0.08)]"
          : "overflow-hidden rounded-[18px] border border-[#cfd7cf] bg-[#e8eee8] shadow-[0_1px_0_rgba(29,42,34,0.08)]"
      }
    >
      <Image
        src="/assets/outreach/streetlight-master-left-panel.png"
        alt=""
        width={502}
        height={1012}
        priority
        sizes={
          isMobilePlacement
            ? "(min-width: 640px) 9.5rem, 36vw"
            : "(min-width: 1280px) 20rem, 18rem"
        }
        className="h-auto w-full"
      />
    </figure>
  );
}

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
    hasTranslatedCopy,
    languageCode,
    regionScope,
  } = getPageRequestContext({
    requestHeaders,
    requestedLanguageCode: lang,
  });
  const page = getStaticPageContent("about", languageCode);
  const [introSection, ...remainingSections] = page.sections;

  const renderSection = (section: (typeof page.sections)[number]) => (
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
  );

  return (
    <InfoPageShell
      area="about"
      contentClassName="flex-1 pb-4 lg:pb-8"
      currentLanguage={currentLanguage}
      regionScope={regionScope}
      sourcePath={buildAboutHref(languageCode)}
      title={page.title}
      lastUpdated={page.lastUpdated}
      getLanguageHref={(nextLanguageCode) => buildAboutHref(nextLanguageCode)}
      showTitleBlock={false}
      wide
    >
      <div className="lg:grid lg:grid-cols-[minmax(0,42rem)_18rem] lg:items-start lg:gap-10 xl:grid-cols-[minmax(0,42rem)_20rem]">
        <div className="space-y-6">
          <div>
            <div className="lg:hidden">
              <StreetlightAboutImage placement="mobile" />
            </div>

            <h1 className="text-[28px] font-semibold leading-[1.16] text-[#171a18] sm:text-[34px]">
              {page.title}
            </h1>
            <p className="pt-3 text-[14px] leading-6 text-[#5f6d64]">
              {copy.lastUpdatedLabel} {page.lastUpdated}
            </p>
            {!hasTranslatedCopy && currentLanguage.code !== "en" ? (
              <p className="pt-2 text-[14px] leading-6 text-[#5f6d64]">
                {copy.infoPageTranslationNotice}
              </p>
            ) : null}
          </div>

          {introSection ? renderSection(introSection) : null}

          {remainingSections.map((section) => renderSection(section))}

          <section className="clear-both rounded-[18px] border border-[#cfd7cf] bg-white px-4 py-4 text-[16px] leading-6 text-[#334139] shadow-[0_1px_0_rgba(29,42,34,0.08)]">
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
        </div>

        <aside className="hidden lg:block">
          <div className="sticky top-0">
            <StreetlightAboutImage placement="desktop" />
          </div>
        </aside>
      </div>
    </InfoPageShell>
  );
}
