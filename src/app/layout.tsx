import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Access Tool",
  description: "A free mobile web tool for getting unstuck.",
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
