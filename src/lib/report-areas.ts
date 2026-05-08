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
