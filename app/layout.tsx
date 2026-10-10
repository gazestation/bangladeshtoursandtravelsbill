import type { Metadata } from "next";
import "@fontsource/noto-sans-bengali/400.css";
import "@fontsource/noto-sans-bengali/700.css";
import "@fontsource/noto-sans-devanagari/400.css";
import "@fontsource/noto-sans-devanagari/700.css";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "BTNT Bill Book | Bangladesh Tours & Travels",
  description: "Customer accounts, travel bills, payments, and outstanding balances for Bangladesh Tours & Travels.",
  applicationName: "BTNT Bill Book",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
