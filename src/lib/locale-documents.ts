import type { SupportedLanguageCode } from "./languages";
import { isPlainRecord } from "./plain-record";

type SupportedLanguageDocumentMap<TDocument> = Record<
  SupportedLanguageCode,
  TDocument
>;

export type LocaleDocumentMeta = {
  translated: boolean;
  languageCode: SupportedLanguageCode;
  inherits?: SupportedLanguageCode;
};

function validateLocaleDocument(
  languageCode: SupportedLanguageCode,
  document: { meta?: Partial<LocaleDocumentMeta> } | null | undefined,
) {
  if (!isPlainRecord(document)) {
    throw new Error(`Locale document "${languageCode}" must be an object.`);
  }

  if (!("meta" in document) || document.meta === undefined) {
    return;
  }

  const { meta } = document;

  if (!isPlainRecord(meta)) {
    throw new Error(`Locale document "${languageCode}" meta must be an object.`);
  }

  if (meta.languageCode !== languageCode) {
    throw new Error(
      `Locale document "${languageCode}" must declare meta.languageCode="${languageCode}".`,
    );
  }

  if (typeof meta.translated !== "boolean") {
    throw new Error(
      `Locale document "${languageCode}" must declare meta.translated as a boolean.`,
    );
  }

  if (
    meta.inherits !== undefined &&
    meta.inherits !== "en" &&
    meta.inherits !== languageCode
  ) {
    throw new Error(
      `Locale document "${languageCode}" has unsupported meta.inherits="${meta.inherits}".`,
    );
  }
}

export function buildLanguageDocumentMap<TDocument>({
  en,
  es,
  vi,
  so,
  ru,
  am,
  zh,
}: SupportedLanguageDocumentMap<TDocument>): SupportedLanguageDocumentMap<TDocument> {
  validateLocaleDocument("en", en as { meta?: Partial<LocaleDocumentMeta> });
  validateLocaleDocument("es", es as { meta?: Partial<LocaleDocumentMeta> });
  validateLocaleDocument("vi", vi as { meta?: Partial<LocaleDocumentMeta> });
  validateLocaleDocument("so", so as { meta?: Partial<LocaleDocumentMeta> });
  validateLocaleDocument("ru", ru as { meta?: Partial<LocaleDocumentMeta> });
  validateLocaleDocument("am", am as { meta?: Partial<LocaleDocumentMeta> });
  validateLocaleDocument("zh", zh as { meta?: Partial<LocaleDocumentMeta> });

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
