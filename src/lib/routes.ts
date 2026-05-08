import type { ConversationEntryId, WeakCategory } from "./chat-types";
import type { SupportedLanguageCode } from "./languages";

export type InternalAppPath = `/${string}`;

type FindHumanHrefOptions = {
  category?: null | WeakCategory;
  entryId?: null | string;
  languageCode: SupportedLanguageCode;
};

type ReportProblemHrefOptions = {
  area?: null | string;
  entryId?: null | string;
  languageCode: SupportedLanguageCode;
  sourcePath?: InternalAppPath | null;
};

const allowedSourcePathnames = [
  "/",
  "/about",
  "/conversation",
  "/find-human",
  "/privacy",
  "/report-problem",
] as const;

export function sanitizeInternalSourcePath(
  sourcePath?: null | string,
): InternalAppPath | null {
  if (!sourcePath || !sourcePath.startsWith("/") || sourcePath.startsWith("//")) {
    return null;
  }

  try {
    const normalized = new URL(sourcePath, "http://access-tool.local");
    const isAllowedPathname = allowedSourcePathnames.some((pathname) =>
      pathname === "/conversation"
        ? normalized.pathname.startsWith("/conversation/")
        : normalized.pathname === pathname,
    );

    if (!isAllowedPathname) {
      return null;
    }

    return `${normalized.pathname}${normalized.search}${normalized.hash}` as InternalAppPath;
  } catch {
    return null;
  }
}

export function buildHomeHref(languageCode: SupportedLanguageCode) {
  return `/?lang=${languageCode}` as InternalAppPath;
}

export function buildConversationHref({
  entryId,
  languageCode,
}: {
  entryId: ConversationEntryId;
  languageCode: SupportedLanguageCode;
}) {
  return `/conversation/${entryId}?lang=${languageCode}` as InternalAppPath;
}

export function buildAboutHref(languageCode: SupportedLanguageCode) {
  return `/about?lang=${languageCode}` as InternalAppPath;
}

export function buildPrivacyHref(languageCode: SupportedLanguageCode) {
  return `/privacy?lang=${languageCode}` as InternalAppPath;
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

  return `/find-human?${params.toString()}` as InternalAppPath;
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

  return `/report-problem?${params.toString()}` as InternalAppPath;
}
