import {
  isConversationEntryId,
  type ConversationEntryId,
  type WeakCategory,
} from "./chat-types";
import type { SupportedLanguageCode } from "./languages";
import type { ReportArea } from "./report-areas";

export type InternalAppPath = `/${string}`;

type FindHumanHrefOptions = {
  category?: null | WeakCategory;
  entryId?: ConversationEntryId | null;
  languageCode: SupportedLanguageCode;
};

type ReportProblemHrefOptions = {
  area?: ReportArea | null;
  entryId?: ConversationEntryId | null;
  languageCode: SupportedLanguageCode;
  sourcePath?: InternalAppPath | null;
};

const allowedSourcePathnames = [
  "/",
  "/about",
  "/find-human",
  "/privacy",
  "/report-problem",
] as const;
const maxInternalSourcePathLength = 512;

function makeInternalAppPath(value: string): InternalAppPath {
  if (!value.startsWith("/")) {
    throw new Error(`Internal app path must start with "/": ${value}`);
  }

  return value as InternalAppPath;
}

export function sanitizeInternalSourcePath(
  sourcePath?: null | string,
): InternalAppPath | null {
  if (
    !sourcePath ||
    sourcePath.length > maxInternalSourcePathLength ||
    !sourcePath.startsWith("/") ||
    sourcePath.startsWith("//")
  ) {
    return null;
  }

  try {
    const normalized = new URL(sourcePath, "http://access-tool.local");
    const conversationPathMatch = normalized.pathname.match(
      /^\/conversation\/([^/]+)$/,
    );
    const isAllowedConversationPath =
      conversationPathMatch !== null &&
      isConversationEntryId(conversationPathMatch[1]);
    const isAllowedPathname =
      isAllowedConversationPath ||
      allowedSourcePathnames.some((pathname) => normalized.pathname === pathname);

    if (!isAllowedPathname) {
      return null;
    }

    return makeInternalAppPath(
      `${normalized.pathname}${normalized.search}${normalized.hash}`,
    );
  } catch {
    return null;
  }
}

export function buildHomeHref(languageCode: SupportedLanguageCode) {
  return makeInternalAppPath(`/?lang=${languageCode}`);
}

export function buildConversationHref({
  entryId,
  languageCode,
}: {
  entryId: ConversationEntryId;
  languageCode: SupportedLanguageCode;
}) {
  return makeInternalAppPath(`/conversation/${entryId}?lang=${languageCode}`);
}

export function buildAboutHref(languageCode: SupportedLanguageCode) {
  return makeInternalAppPath(`/about?lang=${languageCode}`);
}

export function buildPrivacyHref(languageCode: SupportedLanguageCode) {
  return makeInternalAppPath(`/privacy?lang=${languageCode}`);
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

  return makeInternalAppPath(`/find-human?${params.toString()}`);
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

  return makeInternalAppPath(`/report-problem?${params.toString()}`);
}
