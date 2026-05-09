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
  entryId,
  languageCode = "en",
  regionScope = "king",
  sourcePath,
}: {
  area?: ReportArea;
  entryId?: ConversationEntryId;
  languageCode?: SupportedLanguageCode;
  regionScope?: RegionScope;
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

  return (
    <footer
      id="crisis-resources"
      className="shrink-0 border-t border-[#cbd6cf] bg-[#edf3ef] px-4 py-3 text-[14px] leading-5 text-[#25342b] sm:px-6 lg:px-8"
    >
      <div className="mx-auto max-w-md sm:max-w-2xl lg:max-w-4xl">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <strong className="font-semibold">{copy.footerHeading}</strong>
          <PhoneAction
            copy={copy}
            label={copy.footerEmergency}
            phone="988"
            buttonClassName="font-semibold underline"
          />
          <PhoneAction
            copy={copy}
            label={copy.footerDangerNow}
            phone="911"
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
              buttonClassName="font-semibold underline"
            />
          ))}
        </div>
        <div className="pt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
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
      </div>
    </footer>
  );
}
