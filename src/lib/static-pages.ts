import en from "../data/static-pages/en.json";
import es from "../data/static-pages/es.json";
import vi from "../data/static-pages/vi.json";
import so from "../data/static-pages/so.json";
import ru from "../data/static-pages/ru.json";
import am from "../data/static-pages/am.json";
import zh from "../data/static-pages/zh.json";
import type { SupportedLanguageCode } from "./languages";
import { buildLanguageDocumentMap } from "./locale-documents";
import { isPlainRecord } from "./plain-record";

type StaticPageSection = {
  heading: string;
  paragraphs: string[];
  bullets?: string[];
};

type StaticPageContent = {
  title: string;
  lastUpdated: string;
  sections: StaticPageSection[];
};

type StaticPageKey = "about" | "privacy";

type StaticPagesDocument = {
  pages: Partial<Record<StaticPageKey, Partial<StaticPageContent>>>;
};

function asStaticPagesDocument(value: unknown): StaticPagesDocument {
  if (!isPlainRecord(value)) {
    throw new Error("Static pages document must be an object.");
  }

  const candidate = value as Partial<StaticPagesDocument>;

  if (!isPlainRecord(candidate.pages)) {
    throw new Error("Static pages document must include a pages object.");
  }

  return candidate as StaticPagesDocument;
}

const documents = buildLanguageDocumentMap({
  en: asStaticPagesDocument(en),
  es: asStaticPagesDocument(es),
  vi: asStaticPagesDocument(vi),
  so: asStaticPagesDocument(so),
  ru: asStaticPagesDocument(ru),
  am: asStaticPagesDocument(am),
  zh: asStaticPagesDocument(zh),
});

export function getStaticPageContent(
  pageKey: StaticPageKey,
  languageCode: SupportedLanguageCode,
): StaticPageContent {
  const englishPage = documents.en.pages[pageKey];
  const localizedPage = documents[languageCode].pages[pageKey];

  return {
    title: localizedPage?.title ?? englishPage?.title ?? "",
    lastUpdated: localizedPage?.lastUpdated ?? englishPage?.lastUpdated ?? "",
    sections: localizedPage?.sections ?? englishPage?.sections ?? [],
  };
}
