import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

const BASE = "/check";
export const metadata: Metadata = {
  metadataBase: new URL("https://www.dividendii.com"),
  title: "Check for unclaimed dividends | Dividendii",
  description: "Tell us which companies you hold shares in. Dividendii completes your registrar mandate form, signs it with your permission, and sends it for you. The registrar pays you directly.",
  icons: { icon: [{ url: `${BASE}/brand/favicon.ico` }, { url: `${BASE}/brand/favicon-32.png`, sizes: "32x32", type: "image/png" }], apple: `${BASE}/brand/apple-touch-icon-180.png` },
  openGraph: { title: "Nigerian companies may still owe you dividends", description: "Dividendii checks the registrars for money in your name and helps you recover it into your bank account.", images: ["https://www.dividendii.com/og-card.png"] },
  twitter: { card: "summary_large_image", images: ["https://www.dividendii.com/og-card.png"] },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#17375A" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
