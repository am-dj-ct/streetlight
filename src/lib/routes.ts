import type { ConversationEntryId, WeakCategory } from "./chat-types";
import type { SupportedLanguageCode } from "./languages";

type FindHumanHrefOptions = {
  category?: null | WeakCategory;
  entryId?: null | string;
  languageCode: SupportedLanguageCode;
};

type ReportProblemHrefOptions = {
  area?: null | string;
  entryId?: null | string;
  languageCode: SupportedLanguageCode;
  sourcePath?: null | string;
};

export function sanitizeInternalSourcePath(
  sourcePath?: null | string,
): null | string {
  if (!sourcePath || !sourcePath.startsWith("/") || sourcePath.startsWith("//")) {
    return null;
  }

  return sourcePath;
}

export function buildHomeHref(languageCode: SupportedLanguageCode) {
  return `/?lang=${languageCode}`;
}

export function buildConversationHref({
  entryId,
  languageCode,
}: {
  entryId: ConversationEntryId;
  languageCode: SupportedLanguageCode;
}) {
  return `/conversation/${entryId}?lang=${languageCode}`;
}

export function buildAboutHref(languageCode: SupportedLanguageCode) {
  return `/about?lang=${languageCode}`;
}

export function buildPrivacyHref(languageCode: SupportedLanguageCode) {
  return `/privacy?lang=${languageCode}`;
}

export function buildFindHumanHref({
  category,
  entryId,
  languageCode,
}: FindHumanHrefOptions) {
  const params = new URLSearchParams();

  if (category) {
    params.set("category", category);
  }

  if (entryId) {
    params.set("entryId", entryId);
  }

  params.set("lang", languageCode);

  return `/find-human?${params.toString()}`;
}

export function buildReportProblemHref({
  area,
  entryId,
  languageCode,
  sourcePath,
}: ReportProblemHrefOptions) {
  const params = new URLSearchParams();
  const safeSourcePath = sanitizeInternalSourcePath(sourcePath);
  params.set("lang", languageCode);

  if (area) {
    params.set("area", area);
  }

  if (entryId) {
    params.set("entryId", entryId);
  }

  if (safeSourcePath) {
    params.set("source", safeSourcePath);
  }

  return `/report-problem?${params.toString()}`;
}
