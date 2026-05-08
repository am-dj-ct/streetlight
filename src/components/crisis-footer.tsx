import Link from "next/link";
import { getCrisisResources } from "../lib/crisis-resources";
import type { SupportedLanguageCode } from "../lib/languages";
import type { RegionScope } from "../lib/geo";
import { getUiCopy } from "../lib/ui-copy";
import { getBugReportHref } from "../lib/support";

export function CrisisFooter({
  entryId,
  languageCode = "en",
  regionScope = "king",
}: {
  entryId?: string;
  languageCode?: SupportedLanguageCode;
  regionScope?: RegionScope;
}) {
  const copy = getUiCopy(languageCode);
  const crisisResources = getCrisisResources(regionScope);
  const findHumanHref = entryId
    ? `/find-human?entryId=${encodeURIComponent(entryId)}&lang=${languageCode}`
    : `/find-human?lang=${languageCode}`;

  return (
    <footer
      id="crisis-resources"
      className="shrink-0 border-t border-[#cbd6cf] bg-[#edf3ef] px-4 py-3 text-[14px] leading-5 text-[#25342b]"
    >
      <div className="mx-auto max-w-md">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <strong className="font-semibold">{copy.footerHeading}</strong>
          <span>{copy.footerEmergency}</span>
          <span>{copy.footerDangerNow}</span>
          <span>
            {regionScope === "king"
              ? copy.footerLocalPlaceholder
              : copy.footerFallbackPlaceholder}
          </span>
          {crisisResources.map((resource) => (
            <a
              key={resource.id}
              href={`tel:${resource.phone.replace(/[^0-9]/g, "")}`}
              className="font-semibold underline"
            >
              {resource.label} {resource.phone}
            </a>
          ))}
        </div>
        <div className="pt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          <Link href={findHumanHref} className="font-semibold underline">
            {copy.footerFindHuman}
          </Link>
          <Link href={`/privacy?lang=${languageCode}`} className="font-semibold underline">
            {copy.footerPrivacy}
          </Link>
          <Link href={`/about?lang=${languageCode}`} className="font-semibold underline">
            {copy.footerAbout}
          </Link>
          <a href={getBugReportHref()} className="font-semibold underline">
            {copy.footerReportProblem}
          </a>
        </div>
      </div>
    </footer>
  );
}
