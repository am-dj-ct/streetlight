import Link from "next/link";
import { getCrisisResources } from "../lib/crisis-resources";
import type { SupportedLanguageCode } from "../lib/languages";
import type { RegionScope } from "../lib/geo";
import { getUiCopy } from "../lib/ui-copy";

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
      <div className="mx-auto flex max-w-md flex-wrap items-center gap-x-3 gap-y-1">
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
        <Link href={findHumanHref} className="font-semibold underline">
          {copy.footerFindHuman}
        </Link>
      </div>
    </footer>
  );
}
