import Link from "next/link";
import { SiteHeader, SiteFooter } from "@/components/SiteChrome";
import { SITE, START_FEE, VAT_RATE, startFeeWithVat, SUCCESS_PERCENT } from "@/lib/site";

const naira = (n: number) => "₦" + n.toLocaleString("en-NG", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });

/** Check my dividends: the way in. Lives at /check on dividendii.com. */
export default function Landing() {
  return (
    <>
      <SiteHeader />
      <section className="hero">
        <div className="hero-grid">
          <div className="hero-main">
            <h1>Find dividends in your name.</h1>
            <p>
              Tell us the companies you hold shares in. We fill in each registrar&apos;s mandate form, send it for you with your
              signed permission, and follow up. If there is money, the registrar pays you directly.
            </p>
            <div className="hero-cta">
              <Link className="btn gold lg" href="/pilot">Start my check</Link>
            </div>
            <div className="hero-note">It takes about ten minutes. {naira(START_FEE)} plus VAT per company to send. First update within 24 hours.</div>
          </div>
          <div className="hero-stat">
            <div className="sum">{"₦"}270bn</div>
            <div className="lbl">in dividends sits unclaimed in Nigeria, much of it owed to people who bought shares years ago</div>
            <div className="src"><a href={SITE.source} target="_blank" rel="noopener noreferrer" style={{ color: "inherit" }}>Source: Nairametrics, 16 July 2026, on the SEC campaign</a></div>
          </div>
        </div>
      </section>

      <section className="strip">
        <h2>Four steps, one sitting</h2>
        <div className="strip-grid four">
          <div className="strip-item"><div className="n">1</div><h3>You</h3>
            <p>Your name and the other ways it was written, your email and your CHN or CSCS number. We confirm your email with a code.</p></div>
          <div className="strip-item"><div className="n">2</div><h3>Your companies</h3>
            <p>Pick the companies you hold shares in. Add as many as you need.</p></div>
          <div className="strip-item"><div className="n">3</div><h3>Your details</h3>
            <p>Your BVN and bank account, and the address, phone and next of kin you gave when you bought the shares.</p></div>
          <div className="strip-item"><div className="n">4</div><h3>Sign and send</h3>
            <p>Add your photo and signature, pay the start fee, and we email the registrar for you.</p></div>
        </div>
      </section>

      <section className="trust">
        <div><div className="k">{naira(START_FEE)}</div><div className="v">Start fee per company, plus {VAT_RATE * 100}% VAT ({naira(startFeeWithVat())}), paid securely with Paystack when you send your forms</div></div>
        <div><div className="k">Direct</div><div className="v">The registrar pays your own bank account. Dividendii never holds your dividend</div></div>
        <div><div className="k">{SUCCESS_PERCENT}%</div><div className="v">Of what is actually paid to you, paid by you only after a dividend reaches your account</div></div>
      </section>

      <p className="foot-note tiny">
        You can claim directly from any registrar yourself at no cost. Dividendii does the paperwork and the follow-up for you.
        We collect your BVN, bank details, photo and signature to complete the forms; they are sent only to the registrars you choose.
        See our <a href="/legal#privacy" className="link">privacy notice</a>.
      </p>
      <SiteFooter />
    </>
  );
}
