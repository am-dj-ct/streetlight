import Link from "next/link";
import { languageOptions, type SupportedLanguageCode } from "../lib/languages";

export function LanguageStripLinks({
  currentLanguageCode,
  getHref,
}: {
  currentLanguageCode: SupportedLanguageCode;
  getHref: (languageCode: SupportedLanguageCode) => string;
}) {
  return (
    <nav
      aria-label="Choose language"
      className="flex flex-wrap items-center justify-end gap-x-1 gap-y-1 text-[14px] leading-6 text-[#314036]"
    >
      {languageOptions.map((language, i) => (
        <span key={language.code} className="flex items-center gap-x-1">
          <Link
            href={getHref(language.code)}
            className={`min-h-10 px-1 font-medium underline-offset-4 hover:underline ${
              language.code === currentLanguageCode ? "underline" : ""
            }`}
          >
            {language.label}
          </Link>
          {i < languageOptions.length - 1 ? (
            <span aria-hidden="true" className="text-[#8a9b8f]">
              ·
            </span>
          ) : null}
        </span>
      ))}
    </nav>
  );
}
