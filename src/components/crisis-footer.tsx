import Link from "next/link";
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
        <Link href={findHumanHref} className="font-semibold underline">
          {copy.footerFindHuman}
        </Link>
      </div>
    </footer>
  );
}
