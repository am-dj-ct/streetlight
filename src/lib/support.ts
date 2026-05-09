export const supportEmail = "jesse.c.dunn@outlook.com";
export const maxMailtoHrefLength = 6000;

export function buildMailtoHref({
  body,
  subject,
}: {
  body?: string;
  subject: string;
}) {
  const params = new URLSearchParams();

  params.set("subject", subject);

  if (body) {
    params.set("body", body);
  }

  return `mailto:${supportEmail}?${params.toString()}`;
}

export function isMailtoHrefWithinLimit(href: string) {
  return href.length <= maxMailtoHrefLength;
}
