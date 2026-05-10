import Link from "next/link";
import { getCrisisResources } from "../lib/crisis-resources";
import { PhoneAction } from "./phone-action";
import type { ConversationEntryId } from "../lib/chat-types";
import type { SupportedLanguageCode } from "../lib/languages";
import type { RegionScope } from "../lib/geo";
import type { ReportArea } from "../lib/report-areas";
import {
  buildAboutHref,
  buildFindHumanHref,
  buildPrivacyHref,
  buildReportProblemHref,
  type InternalAppPath,
} from "../lib/routes";
import { getUiCopy } from "../lib/ui-copy";

export function CrisisFooter({
  area,
  compact = false,
  entryId,
  languageCode = "en",
  regionScope = "king",
  showFindHumanInCompact = false,
  sourcePath,
}: {
  area?: ReportArea;
  compact?: boolean;
  entryId?: ConversationEntryId;
  languageCode?: SupportedLanguageCode;
  regionScope?: RegionScope;
  showFindHumanInCompact?: boolean;
  sourcePath?: InternalAppPath;
}) {
  const copy = getUiCopy(languageCode);
  const crisisResources = getCrisisResources(regionScope);
  const findHumanHref = buildFindHumanHref({
    entryId,
    languageCode,
  });
  const reportProblemHref = buildReportProblemHref({
    area,
    entryId,
    languageCode,
    sourcePath,
  });
  const fullFooterContent = (
    <>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <strong className="font-semibold">{copy.footerHeading}</strong>
        <PhoneAction
          copy={copy}
          label={copy.footerEmergency}
          phone="988"
          websiteUrl="https://988lifeline.org/"
          buttonClassName="font-semibold underline"
        />
        <PhoneAction
          copy={copy}
          label={copy.footerDangerNow}
          phone="911"
          websiteUrl="https://www.911.gov/"
          buttonClassName="font-semibold underline"
        />
        <span>
          {regionScope === "king"
            ? copy.footerLocalPlaceholder
            : copy.footerFallbackPlaceholder}
        </span>
        {crisisResources.map((resource) => (
          <PhoneAction
            key={resource.id}
            copy={copy}
            label={`${resource.label} ${resource.phone}`}
            phone={resource.phone}
            websiteUrl={resource.url}
            buttonClassName="font-semibold underline"
          />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-2">
        <Link href={findHumanHref} className="font-semibold underline">
          {copy.footerFindHuman}
        </Link>
        <Link href={buildPrivacyHref(languageCode)} className="font-semibold underline">
          {copy.footerPrivacy}
        </Link>
        <Link href={buildAboutHref(languageCode)} className="font-semibold underline">
          {copy.footerAbout}
        </Link>
        <Link href={reportProblemHref} className="font-semibold underline">
          {copy.footerReportProblem}
        </Link>
      </div>
    </>
  );

  return (
    <footer
      id="crisis-resources"
      className={`shrink-0 border-t border-[#cbd6cf] bg-[#edf3ef] px-4 text-[14px] leading-5 text-[#25342b] sm:px-6 lg:px-8 ${
        compact ? "py-2 sm:py-3" : "py-3"
      }`}
    >
      <div className="mx-auto max-w-md sm:max-w-2xl lg:max-w-4xl">
        {compact ? (
          <>
            <div className="sm:hidden">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <strong className="font-semibold">{copy.footerImmediateHelp}</strong>
                  <PhoneAction
                    copy={copy}
                    label="911"
                    phone="911"
                    websiteUrl="https://www.911.gov/"
                    buttonClassName="font-semibold underline"
                  />
                </div>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <strong className="font-semibold">
                    {copy.footerMentalHealthCrisisHelp}
                  </strong>
                  <PhoneAction
                    copy={copy}
                    label="988"
                    phone="988"
                    websiteUrl="https://988lifeline.org/"
                    buttonClassName="font-semibold underline"
                  />
                </div>
              </div>

              {showFindHumanInCompact ? (
                <div className="mt-2">
                  <Link href={findHumanHref} className="font-semibold underline">
                    {copy.footerFindHuman}
                  </Link>
                </div>
              ) : null}

              <details className="mt-2">
                <summary className="cursor-pointer rounded-[14px] border border-[#cbd6cf] bg-white px-3 py-2 text-[13px] font-medium text-[#25342b]">
                  {copy.footerMoreCrisisResources}
                </summary>
                <div className="pt-2">{fullFooterContent}</div>
              </details>
            </div>
            <div className="hidden sm:block">{fullFooterContent}</div>
          </>
        ) : (
          fullFooterContent
        )}
      </div>
    </footer>
  );
}
