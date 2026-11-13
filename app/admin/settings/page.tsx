"use client";

import { withBase } from "@/lib/base";
import { useEffect, useMemo, useState } from "react";
import { Check, TextField } from "@/components/Field";
import { getSettings, saveSettings, sendTestEmail, SignedOut, type SettingsView } from "@/lib/pilot/client";
import { REGISTRAR_CAUTIONS, isEmail, type PilotSettings } from "@/lib/pilot/settingsShared";
import { errorMessage } from "@/lib/util";

type Draft = PilotSettings;
const when = (iso?: string) => (iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lagos" }) : "");

export default function PilotSettingsPage() {
  const [view, setView] = useState<SettingsView | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null as Draft | null);
  const [saved, setSaved] = useState<string>(""); // JSON of what's on the server, to tell if there are unsaved changes
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<"save" | "test" | null>(null);
  const [testTo, setTestTo] = useState("");
  const [confirmLive, setConfirmLive] = useState(false);

  const apply = (v: SettingsView) => { setView(v); setDraft(v.settings); setSaved(JSON.stringify(v.settings)); };
  const [signedOut, setSignedOut] = useState(false);
  useEffect(() => { getSettings().then(apply).catch((e) => { if (e instanceof SignedOut) setSignedOut(true); else setError(errorMessage(e)); }); }, []);

  const dirty = draft ? JSON.stringify(draft) !== saved : false;
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => (d ? { ...d, [k]: v } : d));
  const setReg = (id: string, patch: Partial<Draft["registrars"][string]>) => setDraft((d) => (d ? { ...d, registrars: { ...d.registrars, [id]: { ...d.registrars[id], ...patch } } } : d));

  const problems = useMemo(() => {
    if (!draft) return [];
    const p: string[] = [];
    if (!draft.brandName.trim()) p.push("business name");
    for (const [k, label] of [["senderEmail", "sending email"], ["replyTo", "reply-to email"], ["testInbox", "test inbox"]] as const) if (!isEmail(draft[k])) p.push(label);
    if (draft.adminCopy.trim() && !isEmail(draft.adminCopy)) p.push("copy-me email");
    for (const r of view?.registrars ?? []) { const e = draft.registrars[r.id]?.email ?? ""; if (!isEmail(e)) p.push(`${r.name} email`); }
    if (draft.payment.accountNumber && !/^\d{10}$/.test(draft.payment.accountNumber)) p.push("account number (10 digits)");
    return p;
  }, [draft, view]);

  async function save() {
    if (!draft) return;
    setBusy("save"); setError(null); setNotice(null);
    try {
      const { updatedAt, updatedBy, ...body } = draft; void updatedAt; void updatedBy;
      // A registrar address that matches its own form is saved blank, so it keeps following the form's address.
      const registrars = Object.fromEntries((Object.entries(body.registrars) as [string, Draft["registrars"][string]][]).map(([id, r]) => [id, { ...r, email: r.email.trim().toLowerCase() === (view?.registrars.find((x) => x.id === id)?.formEmail ?? "").toLowerCase() ? "" : r.email }]));
      apply(await saveSettings({ ...body, registrars }));
      setNotice("Saved. New submissions use these settings straight away.");
      setConfirmLive(false);
    } catch (e) {
      if (e instanceof SignedOut) setSignedOut(true); else setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function test() {
    setBusy("test"); setError(null); setNotice(null);
    try {
      if (dirty) throw new Error("Save your changes first. The test uses the saved sender.");
      const r = await sendTestEmail(testTo.trim());
      setNotice(`Test email sent from ${r.from} to ${r.to}. Check that inbox (and spam).`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  if (signedOut) return <section className="card" style={{ maxWidth: 420, margin: "40px auto" }}><h1 style={{ fontSize: 28 }}>Sign in first</h1><p className="tiny">Your staff session has ended or you haven&apos;t signed in yet.</p><a className="btn" href={withBase("/admin")}>Go to staff sign-in</a></section>;
  if (!draft || !view) return error ? <div className="field-error">{error}</div> : <div className="center-note"><span className="spin" /></div>;
  const live = draft.mode === "live";
  const enabledCount = (Object.values(draft.registrars) as Draft["registrars"][string][]).filter((r) => r.enabled).length;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <p>Everything here applies to the next submission as soon as you save. Nothing already sent is changed.</p>
        </div>
        <a className="btn ghost sm" href={withBase("/admin")}>Back to submissions</a>
      </div>

      <div className="stack">
        <section className="card">
          <h2>Where emails go</h2>
          <div className="segmented" role="group" aria-label="Mode">
            <button type="button" aria-pressed={!live} onClick={() => { set("mode", "test"); setConfirmLive(false); }}>Test</button>
            <button type="button" aria-pressed={live} onClick={() => set("mode", "live")}>Live</button>
          </div>
          {live ? (
            <>
              <p className="tiny"><b>Live:</b> emails go to the real registrars (shown in the table below), with a blind copy to you. Make sure each address is right first.</p>
              {draft.mode !== JSON.parse(saved).mode && (
                <Check checked={confirmLive} onToggle={() => setConfirmLive((v) => !v)}>
                  <b>I&apos;ve checked the registrar addresses and understand real registrars will receive real submissions.</b>
                </Check>
              )}
            </>
          ) : <p className="tiny"><b>Test:</b> every registrar email goes to your test inbox instead, marked with the registrar it would have gone to. Nothing reaches a registrar.</p>}
          <div style={{ marginTop: 12 }}>
            <Check checked={draft.acceptingSubmissions} onToggle={() => set("acceptingSubmissions", !draft.acceptingSubmissions)}>
              <b>The public form is open.</b> Untick to pause: people see a &quot;paused&quot; message and nothing is sent.
            </Check>
          </div>
        </section>

        <section className="card">
          <h2>Your business and sending email</h2>
          <div className="field-row">
            <TextField label="Business name" value={draft.brandName} onChange={(v) => set("brandName", v)} hint="Shown in emails and on the letter of authority." />
            <TextField label="Sender name" value={draft.senderName} onChange={(v) => set("senderName", v)} hint="What people see as the sender." />
          </div>
          <div className="field-row">
            <TextField label="Sending email (From)" value={draft.senderEmail} onChange={(v) => set("senderEmail", v.trim())} type="email" error={draft.senderEmail && !isEmail(draft.senderEmail) ? "Not a valid email." : undefined}
              hint="Must be an address your mail login is allowed to send from." />
            <TextField label="Replies go to" value={draft.replyTo} onChange={(v) => set("replyTo", v.trim())} type="email" error={draft.replyTo && !isEmail(draft.replyTo) ? "Not a valid email." : undefined}
              hint="Registrars reply here." />
          </div>
          <div className="field-row">
            <TextField label="Copy me on every live registrar email" value={draft.adminCopy} onChange={(v) => set("adminCopy", v.trim())} type="email" hint="Blind copy. Leave blank for no copy." error={draft.adminCopy && !isEmail(draft.adminCopy) ? "Not a valid email." : undefined} />
            <TextField label="Test inbox" value={draft.testInbox} onChange={(v) => set("testInbox", v.trim())} type="email" hint="Where emails go in test mode." error={draft.testInbox && !isEmail(draft.testInbox) ? "Not a valid email." : undefined} />
          </div>
          <p className="tiny">
            Mail login: {view.smtp.configured
              ? <>connected to <b>{view.smtp.host}</b>{view.smtp.user ? <> as <b>{view.smtp.user}</b></> : null}. The password is set by your developer and isn&apos;t shown here.</>
              : <b>not set up yet. Emails can&apos;t be sent until your developer adds the mail server details.</b>}
          </p>
          <div className="field-row" style={{ alignItems: "end" }}>
            <TextField label="Send a test email to" value={testTo} onChange={setTestTo} type="email" placeholder="you@yourcompany.com" hint="Checks the saved sender works before a real submission does." />
            <div className="field"><button type="button" className="btn ghost" disabled={busy !== null || !isEmail(testTo)} onClick={test}>{busy === "test" ? <span className="spin" /> : "Send test email"}</button></div>
          </div>
          <div className="field">
            <label htmlFor="note">Extra note in every registrar email (optional)</label>
            <textarea id="note" className="input" style={{ minHeight: 84 }} rows={3} maxLength={1000} value={draft.registrarNote} onChange={(e) => set("registrarNote", e.target.value)}
              placeholder="e.g. Please confirm receipt and tell us how long processing takes." />
          </div>
        </section>

        <section className="card">
          <h2>Registrars ({enabledCount} of {view.registrars.length} switched on)</h2>
          <p className="tiny">Untick a registrar to hide it from the form. Change an email address if the registrar has moved or the one on its form is wrong. Clear the box to go back to the address printed on its form.</p>
          <div className="stack" style={{ marginTop: 12 }}>
            {view.registrars.map((r) => {
              const cur = draft.registrars[r.id];
              const differs = cur.email.trim().toLowerCase() !== r.formEmail.toLowerCase();
              const caution = REGISTRAR_CAUTIONS[r.id];
              return (
                <div key={r.id} className="card" style={{ padding: 12 }}>
                  <div className="row-between">
                    <Check checked={cur.enabled} onToggle={() => setReg(r.id, { enabled: !cur.enabled })}><b>{r.name}</b> <span className="tiny">{r.companies} {r.companies === 1 ? "company" : "companies"}</span></Check>
                    {differs && <span className="tag gold">Changed</span>}
                  </div>
                  <TextField label="Email address" value={cur.email} onChange={(v) => setReg(r.id, { email: v.trim() })} type="email"
                    error={!isEmail(cur.email) ? "Not a valid email. Clear it to use the form's address." : undefined}
                    hint={differs ? `On the registrar's form: ${r.formEmail}` : "Same as the registrar's own form."} />
                  {differs && <button type="button" className="btn ghost sm" onClick={() => setReg(r.id, { email: r.formEmail })}>Use the form&apos;s address</button>}
                  {caution && <div className="tiny" style={{ marginTop: 6 }}><b>Check:</b> {caution}</div>}
                </div>
              );
            })}
          </div>
        </section>

        <section className="card">
          <h2>What you charge and where people pay</h2>
          <div className="field-row">
            <TextField label="Start fee per company before VAT (₦)" value={String(draft.payAheadPerCompany)} onChange={(v) => set("payAheadPerCompany", Number(v.replace(/\D/g, "")) || 0)} inputMode="numeric" />
            <TextField label="Success fee (% of money received)" value={String(draft.debitRatePercent)} onChange={(v) => set("debitRatePercent", Math.min(50, Number(v.replace(/[^\d.]/g, "")) || 0))} inputMode="decimal" hint="Taken from dividends actually received." />
          </div>
          <div className="field-row">
            <TextField label="Bank" value={draft.payment.bank} onChange={(v) => set("payment", { ...draft.payment, bank: v })} />
            <TextField label="Account name" value={draft.payment.accountName} onChange={(v) => set("payment", { ...draft.payment, accountName: v })} />
            <TextField label="Account number" value={draft.payment.accountNumber} onChange={(v) => set("payment", { ...draft.payment, accountNumber: v.replace(/\D/g, "").slice(0, 10) })} inputMode="numeric" />
          </div>
          <p className="tiny">The account details appear in the confirmation email for people who choose to pay ahead. Prices on the public form update when you save.</p>
        </section>
      </div>

      <div className="card" style={{ position: "sticky", bottom: 12, marginTop: 16 }}>
        <div className="row-between">
          <div>
            {error && <div className="field-error">{error}</div>}
            {notice && !error && <div className="tiny"><b>{notice}</b></div>}
            {!error && !notice && problems.length > 0 && <div className="tiny">Fix before saving: {problems.join(", ")}.</div>}
            {!error && !notice && problems.length === 0 && <div className="tiny">{dirty ? "You have unsaved changes." : draft.updatedAt ? `Last saved ${when(draft.updatedAt)}.` : "Using the defaults from your server settings."}</div>}
          </div>
          <button type="button" className="btn gold" disabled={busy !== null || !dirty || problems.length > 0 || (live && draft.mode !== JSON.parse(saved).mode && !confirmLive)} onClick={save}>
            {busy === "save" ? <span className="spin" /> : "Save settings"}
          </button>
        </div>
      </div>
    </>
  );
}
