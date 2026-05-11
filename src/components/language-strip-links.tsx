import Link from "next/link";
import type { InternalAppPath } from "../lib/routes";
import { getUiCopy } from "../lib/ui-copy";
import { languageOptions, type SupportedLanguageCode } from "../lib/languages";

export function LanguageStripLinks({
  currentLanguageCode,
  getHref,
  align = "start",
  mobileScroll = false,
}: {
  currentLanguageCode: SupportedLanguageCode;
  getHref: (languageCode: SupportedLanguageCode) => InternalAppPath;
  align?: "end" | "start";
  mobileScroll?: boolean;
}) {
  const copy = getUiCopy(currentLanguageCode);

  const alignmentClass =
    align === "end"
      ? mobileScroll
        ? "justify-start sm:justify-end"
        : "justify-end"
      : "justify-start";

  return (
    <nav
      aria-label={copy.chooseLanguageLabel}
      className={`flex items-center gap-x-3 gap-y-1 text-[14px] leading-6 text-[#314036] ${
        mobileScroll
          ? "flex-nowrap overflow-x-auto whitespace-nowrap pb-1 [-ms-overflow-style:none] [scrollbar-width:none] sm:flex-wrap sm:overflow-visible sm:whitespace-normal sm:pb-0 [&::-webkit-scrollbar]:hidden"
          : "flex-wrap"
      } ${alignmentClass}`}
    >
      {languageOptions.map((language) => (
        <Link
          key={language.code}
          href={getHref(language.code)}
          aria-current={language.code === currentLanguageCode ? "page" : undefined}
          className={`min-h-10 px-1 font-medium underline-offset-4 hover:underline ${
            language.code === currentLanguageCode ? "underline" : ""
          }`}
        >
          {language.label}
        </Link>
      ))}
    </nav>
  );
}
