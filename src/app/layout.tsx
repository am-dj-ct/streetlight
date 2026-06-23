import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "./globals.css";
import { getLanguageRequestContext } from "../lib/request-context";
import { appTitle, defaultDescription } from "../lib/site-metadata";
import { recordSiteUsageFromHeaders } from "../lib/usage-metrics";

export const metadata: Metadata = {
  description: defaultDescription,
  icons: {
    icon: "/icon.svg",
  },
  title: appTitle,
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#f7f8f4",
  colorScheme: "light",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const requestHeaders = await headers();
  const { languageCode } = getLanguageRequestContext({ requestHeaders });
  await recordSiteUsageFromHeaders(requestHeaders);

  return (
    <html lang={languageCode}>
      <body>{children}</body>
    </html>
  );
}
