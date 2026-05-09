import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "./globals.css";
import { getLanguageRequestContext } from "../lib/request-context";
import { appTitle, defaultDescription } from "../lib/site-metadata";

export const metadata: Metadata = {
  title: appTitle,
  description: defaultDescription,
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

  return (
    <html lang={languageCode}>
      <body>{children}</body>
    </html>
  );
}
