import type { SupportedLanguageCode } from "./languages";
import en from "../data/ui-copy/en.json";
import es from "../data/ui-copy/es.json";
import vi from "../data/ui-copy/vi.json";
import so from "../data/ui-copy/so.json";
import ru from "../data/ui-copy/ru.json";
import am from "../data/ui-copy/am.json";
import zh from "../data/ui-copy/zh.json";

export type UiCopy = typeof en.strings;

type LocaleCopyDocument = {
  meta: {
    translated: boolean;
    languageCode: SupportedLanguageCode;
    inherits?: SupportedLanguageCode;
  };
  strings: Partial<UiCopy>;
};

function asLocaleCopyDocument(value: unknown): LocaleCopyDocument {
  return value as LocaleCopyDocument;
}

const localeDocuments: Record<SupportedLanguageCode, LocaleCopyDocument> = {
  en: asLocaleCopyDocument(en),
  es: asLocaleCopyDocument(es),
  vi: asLocaleCopyDocument(vi),
  so: asLocaleCopyDocument(so),
  ru: asLocaleCopyDocument(ru),
  am: asLocaleCopyDocument(am),
  zh: asLocaleCopyDocument(zh),
};

export function getUiCopy(languageCode: SupportedLanguageCode): UiCopy {
  const localeDocument = localeDocuments[languageCode];

  return {
    ...en.strings,
    ...localeDocument.strings,
  };
}

export function hasTranslatedUiCopy(languageCode: SupportedLanguageCode) {
  return localeDocuments[languageCode].meta.translated;
}
