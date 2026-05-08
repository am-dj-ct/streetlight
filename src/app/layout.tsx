import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";
import { getLanguageRequestContext } from "../lib/request-context";
import { appTitle, defaultDescription } from "../lib/site-metadata";

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
  const { languageCode } = getLanguageRequestContext({ requestHeaders });

  return (
    <html lang={languageCode}>
      <body>{children}</body>
    </html>
  );
}
