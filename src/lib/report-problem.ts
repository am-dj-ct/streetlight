import { isConversationEntryId, type ConversationEntryId } from "./chat-types";
import { isReportArea, type ReportArea } from "./report-areas";
import {
  sanitizeInternalSourcePath,
  type InternalAppPath,
} from "./routes";

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

export { isReportArea, reportAreas, type ReportArea } from "./report-areas";
