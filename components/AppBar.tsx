"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { auth } from "@/lib/auth";
import { useAuth } from "@/lib/auth/context";
import { Logo } from "./Logo";

export function AppBar() {
  const { session } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  // The old claim screens are hidden: nobody is linked to them. Staff get their two consoles.
  const links = session?.role === "ops" ? [{ href: "/admin", label: "Pilot submissions" }, { href: "/ops", label: "Ops console" }] : [];

  return (
    <header className="appbar">
      <Link href="/" aria-label="Vendii home"><Logo height={24} /></Link>
      <nav>
        {links.map((l) => (
          <Link key={l.href} href={l.href} className="navlink" data-on={l.href === "/ops" ? pathname === "/ops" : pathname.startsWith(l.href)}>{l.label}</Link>
        ))}
      </nav>
      <span className="spacer" />
      {session && (
        <>
          <span className="who">{session.identifier}</span>
          <button className="btn ghost sm" onClick={async () => { await auth.signOut(); router.push("/"); }}>Sign out</button>
        </>
      )}
    </header>
  );
}
