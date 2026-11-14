import type { Metadata } from "next";
import type { ReactNode } from "react";
import { SiteHeader, SiteFooter } from "@/components/SiteChrome";

export const metadata: Metadata = {
  title: "Send your registrar forms | Dividendii",
  description: "Tell us which companies you hold shares in. Dividendii completes your registrar mandate form, signs it with your permission, and sends it for you.",
  robots: { index: false, follow: true },
};

/** Public form pages: the site header and footer around the steps. */
export default function PilotLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SiteHeader />
      <main className="appmain">
        {children}
        <div className="pwrap pfoot">
          <span>Dividendii &middot; Get back what&apos;s yours</span>
          <span>The registrar pays you directly. Dividendii never holds your dividend.</span>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
