import { headers } from "next/headers";
import Link from "next/link";
import type { Metadata } from "next";
import { InfoPageShell } from "../../components/info-page-shell";
import { ReportProblemForm } from "../../components/report-problem-form";
import { isConversationEntryId } from "../../lib/chat-types";
import { getPageRequestContext } from "../../lib/request-context";
import { isReportArea } from "../../lib/report-problem";
import {
  buildHomeHref,
  buildReportProblemHref,
  sanitizeInternalSourcePath,
} from "../../lib/routes";
import { getRuntimeState } from "../../lib/runtime-state";
import { makeTitle } from "../../lib/site-metadata";

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
  const { copy } = getPageRequestContext({
    requestHeaders,
    requestedLanguageCode: lang,
  });

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
  const {
    copy,
    currentLanguage,
    languageCode,
    regionScope,
  } = getPageRequestContext({
    requestHeaders,
    requestedLanguageCode: lang,
  });
  const runtimeState = getRuntimeState();
  const safeSourcePath = sanitizeInternalSourcePath(source);
  const safeEntryId = isConversationEntryId(entryId) ? entryId : undefined;
  const safeArea = isReportArea(area) ? area : undefined;

  return (
    <InfoPageShell
      area="other"
      currentLanguage={currentLanguage}
      regionScope={regionScope}
      sourcePath={safeSourcePath ?? undefined}
      title={copy.reportPageTitle}
      lastUpdated="2026-05-08"
      getLanguageHref={(nextLanguageCode) =>
        buildReportProblemHref({
          area: safeArea,
          entryId: safeEntryId,
          languageCode: nextLanguageCode,
          sourcePath: safeSourcePath,
        })
      }
    >
      <ReportProblemForm
        chatMode={runtimeState.chatMode}
        commitSha={runtimeState.commitSha}
        copy={copy}
        deployEnv={runtimeState.deployEnv}
        entryId={safeEntryId}
        initialArea={safeArea}
        languageCode={languageCode}
        regionScope={regionScope}
        sourcePath={safeSourcePath ?? undefined}
      />
      <section className="rounded-[18px] border border-[#cfd7cf] bg-white px-4 py-4 text-[16px] leading-6 text-[#334139] shadow-[0_1px_0_rgba(29,42,34,0.08)]">
        {safeSourcePath ? (
          <p className="pb-2">
            <Link href={safeSourcePath} className="font-semibold underline">
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
