import type { Metadata } from "next";
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
