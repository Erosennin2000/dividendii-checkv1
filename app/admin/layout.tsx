import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Logo } from "@/components/Logo";

export const metadata: Metadata = { title: "Staff | Dividendii", robots: { index: false, follow: false } };

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <header className="appbar">
        <a href="/" aria-label="Dividendii home"><Logo height={26} /></a>
        <span className="spacer" />
        <span className="tag">Staff</span>
      </header>
      <main className="appmain">{children}</main>
    </>
  );
}
