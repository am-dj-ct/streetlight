import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";
import { appTitle, defaultDescription } from "../lib/site-metadata";
import { getPreferredLanguageCode, languageHeaderName } from "../lib/languages";

export const metadata: Metadata = {
  title: appTitle,
  description: defaultDescription,
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const requestHeaders = await headers();
  const languageCode = getPreferredLanguageCode({
    acceptLanguageHeader: requestHeaders.get("accept-language"),
    storedLanguageCode: requestHeaders.get(languageHeaderName),
  });

  return (
    <html lang={languageCode}>
      <body>{children}</body>
    </html>
  );
}
