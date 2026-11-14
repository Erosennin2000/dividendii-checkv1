import { Logo } from "@/components/Logo";
import { SITE } from "@/lib/site";

// Plain <a> links on purpose: these point at the main site, outside this app's /check base path.
const wa = SITE.whatsapp + "?text=" + encodeURIComponent("Hello Dividendii, I would like to check for unclaimed dividends.");

export function SiteHeader({ active = "check" }: { active?: "check" | "account" | "none" }) {
  return (
    <>
      <div className="sx-notice"><div className="sx-wrap">
        <span>Dividendii staff will never ask for your PIN, OTP or card details. Our fees are paid only on Paystack&apos;s secure page, never to a personal account.</span>
        <a href={wa} target="_blank" rel="noopener noreferrer">WhatsApp us</a>
      </div></div>
      <header className="sx-head"><div className="sx-wrap">
        <a href="/" aria-label="Dividendii home" className="sx-brand"><Logo height={32} /></a>
        <nav aria-label="Main" className="sx-nav">
          <a href="/check" className={active === "check" ? "on" : ""}>Check my dividends</a>
          <a href="/#how">How it works</a>
          <a href="/pricing">Pricing</a>
          <a href="/safety">Safety</a>
          <a href="/learn">Learn</a>
        </nav>
        <a className="sx-account" href="/check/account" aria-current={active === "account" ? "page" : undefined}>My account</a>
        <a className="sx-cta" href={wa} target="_blank" rel="noopener noreferrer">Chat with us</a>
      </div></header>
    </>
  );
}

export function SiteFooter() {
  return (
    <footer className="sx-foot"><div className="sx-wrap">
      <p><strong>{SITE.legal}</strong>, {SITE.rc}. {SITE.address}. <a href={"tel:" + SITE.phoneTel}>{SITE.phone}</a> · <a href={"mailto:" + SITE.email}>{SITE.email}</a> · {SITE.hours}.</p>
      <p>{SITE.legal} has applied to the Securities and Exchange Commission, Nigeria, to be registered as a digital sub-broker. The application is pending, and we are not yet registered.</p>
      <p><a href="/legal#terms">Terms of use</a> · <a href="/legal#privacy">Privacy notice</a> · <a href="/legal#risk">Risk disclosure</a> · <a href="/legal#cookies">Cookies</a> · <a href="/safety#complaints">Complaints</a> · © 2026 {SITE.legal}</p>
    </div></footer>
  );
}
