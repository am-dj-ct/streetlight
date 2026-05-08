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
import { getRequestRegionScope } from "../../lib/geo";
import {
  getLanguageOption,
  getRequestLanguageCode,
} from "../../lib/languages";
import {
  buildHomeHref,
  buildReportProblemHref,
} from "../../lib/routes";
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
  const regionScope = getRequestRegionScope({ requestHeaders });

  return (
    <InfoPageShell
      area="other"
      currentLanguage={currentLanguage}
      regionScope={regionScope}
      sourcePath={source}
      title={copy.reportPageTitle}
      lastUpdated="2026-05-08"
      getLanguageHref={(nextLanguageCode) =>
        buildReportProblemHref({
          area,
          entryId,
          languageCode: nextLanguageCode,
          sourcePath: source,
        })
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
          <Link href={buildHomeHref(languageCode)} className="font-semibold underline">
            {copy.backToMainScreen}
          </Link>
          .
        </p>
      </section>
    </InfoPageShell>
  );
}
