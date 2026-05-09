export const supportEmail = "jesse.c.dunn@outlook.com";
export const maxMailtoHrefLength = 6000;

export function buildMailtoHref({
  body,
  subject,
  to = supportEmail,
}: {
  body?: string;
  subject: string;
  to?: string;
}) {
  const params = new URLSearchParams();

  params.set("subject", subject);

  if (body) {
    params.set("body", body);
  }

  return `mailto:${to}?${params.toString()}`;
}

export function isMailtoHrefWithinLimit(href: string) {
  return href.length <= maxMailtoHrefLength;
}
