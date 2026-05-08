import { isConversationEntryId, type ConversationEntryId } from "./chat-types";
import {
  sanitizeInternalSourcePath,
  type InternalAppPath,
} from "./routes";

export const reportAreas = [
  "main-screen",
  "conversation",
  "find-human",
  "saving",
  "voice-or-mic",
  "privacy",
  "about",
  "other",
] as const;

export type ReportArea = (typeof reportAreas)[number];

export function isReportArea(
  value: null | string | undefined,
): value is ReportArea {
  return reportAreas.includes(value as ReportArea);
}

export function sanitizeReportProblemSearchParams({
  area,
  entryId,
  sourcePath,
}: {
  area?: null | string;
  entryId?: null | string;
  sourcePath?: null | string;
}): {
  area: ReportArea | undefined;
  entryId: ConversationEntryId | undefined;
  sourcePath: InternalAppPath | undefined;
} {
  return {
    area: isReportArea(area) ? area : undefined,
    entryId: isConversationEntryId(entryId) ? entryId : undefined,
    sourcePath: sanitizeInternalSourcePath(sourcePath) ?? undefined,
  };
}
