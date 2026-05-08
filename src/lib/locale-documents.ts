import type { SupportedLanguageCode } from "./languages";

type SupportedLanguageDocumentMap<TDocument> = Record<
  SupportedLanguageCode,
  TDocument
>;

export type LocaleDocumentMeta = {
  translated: boolean;
  languageCode: SupportedLanguageCode;
  inherits?: SupportedLanguageCode;
};

export function buildLanguageDocumentMap<TDocument>({
  en,
  es,
  vi,
  so,
  ru,
  am,
  zh,
}: SupportedLanguageDocumentMap<TDocument>): SupportedLanguageDocumentMap<TDocument> {
  return {
    en,
    es,
    vi,
    so,
    ru,
    am,
    zh,
  };
}
