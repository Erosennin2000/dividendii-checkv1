"use client";
import { useEffect, useState } from "react";
import { withBase } from "@/lib/base";
import { nairaExact } from "@/lib/site";

interface Outcome {
  kind: "start" | "success"; ok: boolean; status: string; message: string;
  ref: string; firstName: string; mode: "test" | "live";
  sendStatus: "queued" | "sending" | "sent" | "partial" | "failed";
  registrars: string[]; companyCount: number; amount: number | null; retry: string | null;
}

/** Where Paystack sends people back to. We ask our server what really happened to the payment before saying anything. */
export default function PaidPage() {
  const [out, setOut] = useState<Outcome | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const reference = q.get("reference") ?? q.get("trxref") ?? "";
    if (!reference) { setError("We couldn't find a payment reference in this link."); return; }
    fetch(withBase("/api/pilot/pay/verify"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reference }) })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error ?? "We couldn't confirm that payment.");
        setOut(data as Outcome);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "We couldn't confirm that payment."));
  }, []);

  if (error) return (
    <div className="pwrap"><section className="card">
      <h1>We couldn&apos;t confirm your payment yet</h1>
      <p className="lede">{error}</p>
      <p className="tiny">If money left your account, it is not lost: we receive a separate confirmation from Paystack and will update your submission. You can also reply to our email and quote your reference.</p>
    </section></div>
  );
  if (!out) return (
    <div className="pwrap"><section className="card">
      <h1>Confirming your payment…</h1>
      <p className="lede"><span className="spin" /> This takes a few seconds. Please keep this page open.</p>
    </section></div>
  );

  if (!out.ok) return (
    <div className="pwrap"><section className="card">
      <h1>{out.message}</h1>
      <p className="lede">
        {out.kind === "start"
          ? <>Your forms are saved under reference <b>{out.ref}</b>, but they have not been sent. They go to the registrar as soon as the start fee is paid. You have not been charged for a payment that did not complete.</>
          : <>Nothing was taken. You can try again whenever you are ready.</>}
      </p>
      {out.retry && <a className="btn gold lg" href={out.retry}>Try the payment again</a>}
    </section></div>
  );

  if (out.kind === "success") return (
    <div className="pwrap"><section className="card">
      <h1>Thank you, {out.firstName}. We&apos;ve received your success fee.</h1>
      <p className="lede">{out.amount != null && <>We received <b>{nairaExact(out.amount)}</b>. </>}Your reference is <b>{out.ref}</b>. Paystack will email your receipt. Thank you for dealing with us honestly.</p>
    </section></div>
  );

  const sent = out.sendStatus === "sent";
  return (
    <div className="pwrap"><section className="card">
      <h1>{sent ? `Payment received, ${out.firstName}. Your forms are on their way.` : `Payment received, ${out.firstName}.`}</h1>
      <p className="lede">
        {sent && <>We sent your completed mandate form and signed letter of authority to {out.registrars.join(" and ")}. A confirmation is on its way to your email.</>}
        {(out.sendStatus === "queued" || out.sendStatus === "sending") && <>We are sending your forms to {out.registrars.join(" and ")} now. A confirmation will reach your email shortly.</>}
        {out.sendStatus === "partial" && <>Most of your forms have gone. One registrar&apos;s email didn&apos;t send, and we will send it for you. You don&apos;t need to do anything.</>}
        {out.sendStatus === "failed" && <>Your payment is safe and recorded, but the email to the registrar didn&apos;t go yet. We will send it for you. You don&apos;t need to pay or fill anything in again.</>}
      </p>
      <div className="ledger" style={{ margin: "8px 0 16px" }}>
        <div className="row"><span className="k">Your reference</span><span className="v">{out.ref}</span></div>
        <div className="row"><span className="k">Companies</span><span className="v">{out.companyCount}</span></div>
        {out.amount != null && <div className="row"><span className="k">Start fee paid</span><span className="v">{nairaExact(out.amount)}</span></div>}
      </div>
      <h2>What happens next</h2>
      <ol className="pdone-steps">
        <li>The registrar checks its records and replies to us. We will send you a first update on WhatsApp or email within 24 hours.</li>
        <li>We follow up until each claim is paid or closed, and tell you when anything changes.</li>
        <li>Any dividend is paid by the registrar straight into your account. We then write to you about the success fee.</li>
      </ol>
      <div className="acct-msg" style={{ marginTop: 16 }}>
        <span><b>Your account is ready.</b> Follow each registrar&apos;s progress, look around the investing demo and send us feedback.</span>
        <a className="btn gold sm" href={withBase("/account")}>Go to my account</a>
      </div>
      {out.mode === "test" && <p className="tiny"><b>Test mode:</b> the registrar emails went to our test inbox, not the registrar.</p>}
    </section></div>
  );
}
