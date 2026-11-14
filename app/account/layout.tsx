import type { Metadata } from "next";
import type { ReactNode } from "react";
import { SiteHeader, SiteFooter } from "@/components/SiteChrome";

export const metadata: Metadata = {
  title: "My account | Dividendii",
  description: "Follow your dividend claims, see the investing demo and tell us what you think.",
  robots: { index: false, follow: false },
};

export default function AccountLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SiteHeader active="account" />
      <main className="appmain">{children}</main>
      <SiteFooter />
    </>
  );
}
