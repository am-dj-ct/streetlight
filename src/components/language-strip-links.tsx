import Link from "next/link";
import { languageOptions, type SupportedLanguageCode } from "../lib/languages";

export function LanguageStripLinks({
  currentLanguageCode,
  getHref,
  align = "start",
}: {
  currentLanguageCode: SupportedLanguageCode;
  getHref: (languageCode: SupportedLanguageCode) => string;
  align?: "end" | "start";
}) {
  return (
    <nav
      aria-label="Choose language"
      className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-[14px] leading-6 text-[#314036] ${
        align === "end" ? "justify-end" : "justify-start"
      }`}
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
