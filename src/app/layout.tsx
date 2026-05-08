import type { Metadata } from "next";
import "./globals.css";
import { appTitle, defaultDescription } from "../lib/site-metadata";

export const metadata: Metadata = {
  title: appTitle,
  description: defaultDescription,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
