import { headers } from "next/headers";
import Link from "next/link";
import type { Metadata } from "next";
import { InfoPageShell } from "../../components/info-page-shell";
import { ReportProblemForm } from "../../components/report-problem-form";
import { isDevMockChatEnabled } from "../../lib/env";
import { getRegionScope } from "../../lib/geo";
import {
  getLanguageOption,
  getPreferredLanguageCode,
} from "../../lib/languages";
import { makeTitle } from "../../lib/site-metadata";
import { getUiCopy } from "../../lib/ui-copy";

export const metadata: Metadata = {
  title: makeTitle("Report a Problem"),
  description: "Structured, no-content bug reporting for Access Tool.",
};

type ReportProblemPageProps = {
  searchParams: Promise<{
    area?: string;
    entryId?: string;
    lang?: string;
  }>;
};

export default async function ReportProblemPage({
  searchParams,
}: ReportProblemPageProps) {
  const requestHeaders = await headers();
  const { area, entryId, lang } = await searchParams;
  const languageCode = getPreferredLanguageCode({
    acceptLanguageHeader: requestHeaders.get("accept-language"),
    requestedLanguageCode: lang,
  });
  const currentLanguage = getLanguageOption(languageCode);
  const copy = getUiCopy(languageCode);
  const chatMode = isDevMockChatEnabled() ? "mock-local" : "live-model";
  const regionScope = getRegionScope({
    countryHeader: requestHeaders.get("x-vercel-ip-country"),
    regionHeader: requestHeaders.get("x-vercel-ip-country-region"),
  });

  return (
    <InfoPageShell
      currentLanguage={currentLanguage}
      regionScope={regionScope}
      title={copy.reportPageTitle}
      lastUpdated="2026-05-08"
      getLanguageHref={(nextLanguageCode) =>
        `/report-problem?lang=${nextLanguageCode}${area ? `&area=${encodeURIComponent(area)}` : ""}${entryId ? `&entryId=${encodeURIComponent(entryId)}` : ""}`
      }
    >
      <ReportProblemForm
        chatMode={chatMode}
        copy={copy}
        entryId={entryId}
        initialArea={area}
        languageCode={languageCode}
        regionScope={regionScope}
      />
      <section className="rounded-[18px] border border-[#cfd7cf] bg-white px-4 py-4 text-[16px] leading-6 text-[#334139] shadow-[0_1px_0_rgba(29,42,34,0.08)]">
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
