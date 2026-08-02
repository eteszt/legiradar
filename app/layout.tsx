import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Légiradar – élő repülőjárat-követés",
  description: "Repülőjáratok valós idejű helyzete, útvonala és teljes ADS-B telemetriája egy professzionális műszerfalon.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="hu">
      <body>{children}</body>
    </html>
  );
}
