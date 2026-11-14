"use client";
import { useEffect, useState } from "react";
import { withBase } from "@/lib/base";
import { nairaExact } from "@/lib/site";

interface Info {
  ref: string; firstName: string; companies: string[]; perCompany: number; ratePercent: number;
  start: { amount: number; paid: boolean }; success: { paid: boolean; fee: number | null };
  payOnline: boolean; payMode: "off" | "test" | "live";
}

/** Opened from a link in our email: pay an unpaid start fee, or tell us what you received and pay the success fee. */
export default function PayByLinkPage() {
  const [q, setQ] = useState<{ s: string; k: string; kind: "start" | "success" } | null>(null);
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const s = p.get("s") ?? "", k = p.get("k") ?? "";
    const kind = p.get("kind") === "success" ? "success" : "start";
    setQ({ s, k, kind });
    fetch(withBase(`/api/pilot/pay?s=${encodeURIComponent(s)}&k=${encodeURIComponent(k)}`), { cache: "no-store" })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error ?? "This payment link isn't valid.");
        setInfo(data as Info);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "This payment link isn't valid."));
  }, []);

  const received = Number(amount.replace(/[,₦\s]/g, ""));
  const fee = info && Number.isFinite(received) && received > 0 ? Math.round(received * info.ratePercent) / 100 : 0;

  async function pay() {
    if (!q) return;
    setBusy(true); setFormError(null);
    try {
      const res = await fetch(withBase("/api/pilot/pay"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(q.kind === "success" ? { ...q, amount: received } : q) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? "That didn't work. Try again.");
      if (data.url) { window.location.assign(data.url); return; }
      if (data.paid) window.location.reload();
    } catch (e) { setFormError(e instanceof Error ? e.message : "That didn't work. Try again."); }
    setBusy(false);
  }

  if (error) return <div className="pwrap"><section className="card"><h1>This link didn&apos;t open</h1><p className="lede">{error}</p></section></div>;
  if (!info || !q) return <div className="pwrap"><section className="card"><h1>Opening your payment…</h1><p className="lede"><span className="spin" /></p></section></div>;
  const test = info.payMode === "test" && <p className="tiny"><b>Test payments:</b> no real money moves. Use Paystack&apos;s test card 4084 0840 8408 4081, any future date, CVV 408.</p>;
  const off = !info.payOnline && <p className="tiny">Online payment isn&apos;t switched on yet. Reply to our email and we will send you how to pay.</p>;

  if (q.kind === "start") return (
    <div className="pwrap"><section className="card">
      {info.start.paid ? (
        <><h1>This start fee is already paid</h1><p className="lede">Thank you, {info.firstName}. Reference <b>{info.ref}</b>. There is nothing more to pay here.</p></>
      ) : (
        <>
          <h1>Pay your start fee, {info.firstName}</h1>
          <p className="lede">Your forms are saved under reference <b>{info.ref}</b>. We send them to the registrar as soon as this is paid.</p>
          <div className="ledger" style={{ margin: "8px 0 16px" }}>
            <div className="row"><span className="k">{info.companies.length} {info.companies.length === 1 ? "company" : "companies"} at {nairaExact(info.perCompany)} plus 7.5% VAT</span><span className="v"><b>{nairaExact(info.start.amount)}</b></span></div>
          </div>
          <button className="btn gold lg" disabled={busy || !info.payOnline} onClick={pay}>{busy ? <span className="spin" /> : `Pay ${nairaExact(info.start.amount)} with Paystack`}</button>
          {formError && <div className="field-error">{formError}</div>}
          {off}{test}
        </>
      )}
    </section></div>
  );

  return (
    <div className="pwrap"><section className="card">
      <h1>Your success fee, {info.firstName}</h1>
      {info.success.paid && <p className="lede">We have already received a success fee{info.success.fee != null && <> of <b>{nairaExact(info.success.fee)}</b></>} on reference <b>{info.ref}</b>. Thank you. If you have since been paid more, you can add it below.</p>}
      {!info.success.paid && <p className="lede">Reference <b>{info.ref}</b>. You agreed to pay {info.ratePercent}% of the dividends actually paid to you. The registrar pays you directly, so we rely on you to tell us the amount.</p>}
      <div className="field" style={{ margin: "12px 0" }}>
        <label htmlFor="received">How much did the registrar pay into your account, in total? (₦)</label>
        <input id="received" className="input" inputMode="decimal" placeholder="e.g. 85,000" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.,]/g, ""))} />
      </div>
      <div className="ledger" style={{ margin: "8px 0 16px" }}>
        <div className="row"><span className="k">You received</span><span className="v">{received > 0 ? nairaExact(received) : "—"}</span></div>
        <div className="row"><span className="k">Success fee at {info.ratePercent}%</span><span className="v"><b>{fee > 0 ? nairaExact(fee) : "—"}</b></span></div>
        <div className="row"><span className="k">You keep</span><span className="v">{fee > 0 ? nairaExact(Math.round((received - fee) * 100) / 100) : "—"}</span></div>
      </div>
      <button className="btn gold lg" disabled={busy || !(fee > 0) || !info.payOnline} onClick={pay}>{busy ? <span className="spin" /> : fee > 0 ? `Pay ${nairaExact(fee)} with Paystack` : "Enter the amount you received"}</button>
      {formError && <div className="field-error">{formError}</div>}
      <p className="tiny" style={{ marginTop: 12 }}>Not been paid yet? Don&apos;t pay anything. Reply to our email and we will keep chasing the registrar.</p>
      {off}{test}
    </section></div>
  );
}
