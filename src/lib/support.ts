export const supportEmail = "jesse.c.dunn@outlook.com";

export function getBugReportHref() {
  const subject = encodeURIComponent("Access Tool problem report");

  return `mailto:${supportEmail}?subject=${subject}`;
}
