import { headers } from "next/headers";
import Link from "next/link";
import type { Metadata } from "next";
import { InfoPageShell } from "../../components/info-page-shell";
import { ReportProblemForm } from "../../components/report-problem-form";
import {
  getDeployCommitSha,
  getDeployEnvironment,
  isDevMockChatEnabled,
} from "../../lib/env";
import { getRegionScope } from "../../lib/geo";
import {
  getLanguageOption,
  getRequestLanguageCode,
} from "../../lib/languages";
import { makeTitle } from "../../lib/site-metadata";
import { getUiCopy } from "../../lib/ui-copy";

type ReportProblemPageProps = {
  searchParams: Promise<{
    area?: string;
    entryId?: string;
    lang?: string;
    source?: string;
  }>;
};

export async function generateMetadata({
  searchParams,
}: ReportProblemPageProps): Promise<Metadata> {
  const requestHeaders = await headers();
  const { lang } = await searchParams;
  const languageCode = getRequestLanguageCode({
    requestHeaders,
    requestedLanguageCode: lang,
  });
  const copy = getUiCopy(languageCode);

  return {
    title: makeTitle(copy.reportPageTitle),
    description: copy.metaReportProblemDescription,
  };
}

export default async function ReportProblemPage({
  searchParams,
}: ReportProblemPageProps) {
  const requestHeaders = await headers();
  const { area, entryId, lang, source } = await searchParams;
  const languageCode = getRequestLanguageCode({
    requestHeaders,
    requestedLanguageCode: lang,
  });
  const currentLanguage = getLanguageOption(languageCode);
  const copy = getUiCopy(languageCode);
  const chatMode = isDevMockChatEnabled() ? "mock-local" : "live-model";
  const commitSha = getDeployCommitSha();
  const deployEnv = getDeployEnvironment();
  const regionScope = getRegionScope({
    countryHeader: requestHeaders.get("x-vercel-ip-country"),
    regionHeader: requestHeaders.get("x-vercel-ip-country-region"),
  });

  return (
    <InfoPageShell
      area="other"
      currentLanguage={currentLanguage}
      regionScope={regionScope}
      sourcePath={source}
      title={copy.reportPageTitle}
      lastUpdated="2026-05-08"
      getLanguageHref={(nextLanguageCode) =>
        `/report-problem?lang=${nextLanguageCode}${area ? `&area=${encodeURIComponent(area)}` : ""}${entryId ? `&entryId=${encodeURIComponent(entryId)}` : ""}${source ? `&source=${encodeURIComponent(source)}` : ""}`
      }
    >
      <ReportProblemForm
        chatMode={chatMode}
        commitSha={commitSha}
        copy={copy}
        deployEnv={deployEnv}
        entryId={entryId}
        initialArea={area}
        languageCode={languageCode}
        regionScope={regionScope}
        sourcePath={source}
      />
      <section className="rounded-[18px] border border-[#cfd7cf] bg-white px-4 py-4 text-[16px] leading-6 text-[#334139] shadow-[0_1px_0_rgba(29,42,34,0.08)]">
        {source ? (
          <p className="pb-2">
            <Link href={source} className="font-semibold underline">
              {copy.backLabel}
            </Link>
          </p>
        ) : null}
        <p>
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
