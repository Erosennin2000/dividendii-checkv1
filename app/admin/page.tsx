"use client";

import { withBase } from "@/lib/base";
import { nairaExact } from "@/lib/site";
import { useCallback, useEffect, useMemo, useState } from "react";
import { naira } from "@/lib/domain/fees";
import { actOnSubmission, adminSignIn, adminToken, downloadFile, fileUrl, leadsCsv, listLeads, listSubmissions, SignedOut, submissionsCsv } from "@/lib/pilot/client";
import { PILOT_REGISTRARS } from "@/lib/pilot/config";
import type { PilotLeadView, PilotSubmission } from "@/lib/pilot/types";
import { saveBlob } from "@/lib/forms/client";
import { errorMessage } from "@/lib/util";

const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lagos" });
const tone = (s: string) => (s === "sent" || s === "paid" ? "teal" : s === "partial" || s === "awaiting_payment" || s === "debit_pending" || s === "queued" || s === "sending" ? "gold" : "red");
const plural = (n: number) => `${n} ${n === 1 ? "company" : "companies"}`;
const label: Record<string, string> = { queued: "Queued", sending: "Sending", sent: "Sent", partial: "Part sent", failed: "Not sent", paid: "Paid", awaiting_payment: "Awaiting payment", debit_pending: "Debit after" };

function SignIn({ onDone, message }: { onDone: () => void; message?: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function go() {
    setBusy(true); setError(null);
    try { await adminSignIn(email, password); onDone(); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  return (
    <section className="card" style={{ maxWidth: 420, margin: "40px auto" }}>
      <h1 style={{ fontSize: 28 }}>Staff sign-in</h1>
      <p className="tiny">{message ?? "Use the account you were added with."}</p>
      <div className="field"><label htmlFor="ae">Email</label><input id="ae" className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
      <div className="field"><label htmlFor="ap">Password</label><input id="ap" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void go(); }} /></div>
      <button className="btn lg" disabled={busy || !email || !password} onClick={go}>{busy ? <span className="spin" /> : "Sign in"}</button>
      {error && <div className="field-error">{error}</div>}
    </section>
  );
}

/** The PDFs that went to one registrar, in a wide pane, with the company count and the chase button. */
function Preview({ sub, registrarId, onClose, onChase, busy }: {
  sub: PilotSubmission; registrarId: string; onClose: () => void; onChase: (message: string) => void; busy: boolean;
}) {
  const reg = PILOT_REGISTRARS.find((r) => r.id === registrarId)!;
  const companies = sub.holdings.filter((h) => h.registrarId === registrarId);
  const files = (["mandate", "authority"] as const).map((k) => sub.files.find((f) => f.registrarId === registrarId && f.kind === k)).filter(Boolean) as PilotSubmission["files"];
  const [which, setWhich] = useState(files[0]?.name ?? "");
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [asking, setAsking] = useState(false);
  const file = files.find((f) => f.name === which);
  const sent = sub.emails.some((e) => e.kind === "registrar" && e.registrarId === registrarId && e.status === "sent");
  const chases = sub.emails.filter((e) => e.kind === "chase" && e.registrarId === registrarId);

  useEffect(() => {
    let made: string | null = null; let dead = false;
    setUrl(null); setErr(null);
    if (which) fileUrl(sub.id, which).then((u) => { made = u; if (dead) URL.revokeObjectURL(u); else setUrl(u); }).catch((e) => setErr(errorMessage(e)));
    return () => { dead = true; if (made) URL.revokeObjectURL(made); };
  }, [sub.id, which]);

  return (
    <div role="dialog" aria-modal="true" aria-label="Preview" style={{ position: "fixed", inset: 0, background: "rgba(23,55,90,.55)", zIndex: 50, display: "flex", justifyContent: "center", alignItems: "flex-start", overflow: "auto", padding: "4vh 16px" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="card" style={{ width: "min(1040px, 100%)", display: "grid", gridTemplateColumns: "minmax(0,1fr) 300px", gap: 20 }}>
        <div style={{ minWidth: 0 }}>
          <div className="tabs" role="tablist" style={{ marginBottom: 12 }}>
            {files.map((f) => <button key={f.name} className="tab" role="tab" aria-selected={which === f.name} onClick={() => setWhich(f.name)}>{f.kind === "mandate" ? "Mandate form" : "Letter of authority"}</button>)}
          </div>
          {err ? <div className="field-error">{err}</div> : url ? <iframe className="pdfview" style={{ height: "74vh" }} src={url} title={file?.filename} /> : <div className="center-note"><span className="spin" /></div>}
        </div>
        <div className="stack" style={{ alignContent: "start" }}>
          <div>
            <div className="tiny">{sub.ref} &middot; {sub.profile.firstName} {sub.profile.surname}</div>
            <h3 style={{ margin: "2px 0 0" }}>{reg.name}</h3>
            <div style={{ fontSize: 32, fontWeight: 700, color: "var(--navy-deep)", lineHeight: 1.1 }}>{companies.length} <span style={{ fontSize: 15, fontWeight: 500 }}>{companies.length === 1 ? "company" : "companies"}</span></div>
          </div>
          <ol className="tiny" style={{ margin: 0, paddingLeft: 18 }}>{companies.map((h) => <li key={h.company}>{h.company}</li>)}</ol>
          <div className="tiny">{sent ? "Sent to the registrar." : "Not sent to the registrar yet."}{chases.length ? ` Chased ${chases.length} ${chases.length === 1 ? "time" : "times"}, last ${when(chases[chases.length - 1].at)}.` : ""}</div>
          {asking ? (
            <div className="field">
              <label htmlFor="cmsg">A line for the registrar (optional)</label>
              <textarea id="cmsg" className="input" rows={3} style={{ minHeight: 80 }} value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="For example: the shareholder has called twice." />
              <div className="btn-row" style={{ marginTop: 8 }}>
                <button className="btn sm" disabled={busy} onClick={() => { onChase(msg); setAsking(false); setMsg(""); }}>{busy ? "Sending" : "Send chase email"}</button>
                <button className="btn ghost sm" onClick={() => setAsking(false)}>Cancel</button>
              </div>
            </div>
          ) : <button className="btn" disabled={!sent || busy} onClick={() => setAsking(true)} title={sent ? "" : "Send the first email before chasing"}>Chase this registrar</button>}
          <div className="btn-row">
            {url && <a className="btn ghost sm" href={url} target="_blank" rel="noreferrer">Open in a tab</a>}
            {file && <button className="btn ghost sm" onClick={() => downloadFile(sub.id, file.name, file.filename).catch((e) => setErr(errorMessage(e)))}>Download this PDF</button>}
            <button className="btn quiet sm" onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function PilotAdmin() {
  const [subs, setSubs] = useState<PilotSubmission[] | null>(null);
  const [leads, setLeads] = useState<PilotLeadView[]>([]);
  const [tab, setTab] = useState<"subs" | "leads">("subs");
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [sfNote, setSfNote] = useState("");

  const [signedOut, setSignedOut] = useState(false);
  const [preview, setPreview] = useState<{ id: string; registrarId: string } | null>(null);
  const load = useCallback(() => Promise.all([listSubmissions(), listLeads()])
    .then(([s, l]) => { setSubs(s); setLeads(l); setSignedOut(false); setError(null); })
    .catch((e) => { if (e instanceof SignedOut) setSignedOut(true); else setError(errorMessage(e)); }), []);
  useEffect(() => { void load(); }, [load]);
  // New submissions appear on their own.
  useEffect(() => { if (signedOut) return; const t = setInterval(() => { void load(); }, 10_000); return () => clearInterval(t); }, [load, signedOut]);

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (subs ?? []).filter((s) => !t || [s.ref, s.profile.firstName, s.profile.surname, s.profile.email, s.profile.phone1, ...s.holdings.map((h) => h.company)].join(" ").toLowerCase().includes(t));
  }, [subs, q]);

  const shownLeads = useMemo(() => {
    const t = q.trim().toLowerCase();
    return leads.filter((l) => !t || [l.email, l.firstName, l.surname, l.chn, l.submittedRef ?? ""].join(" ").toLowerCase().includes(t));
  }, [leads, q]);

  async function run(id: string, body: Parameters<typeof actOnSubmission>[1], key: string) {
    setBusy(key); setError(null);
    try {
      const updated = await actOnSubmission(id, body);
      setSubs((all) => all?.map((s) => (s.id === id ? updated : s)) ?? null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  if (signedOut) return <SignIn onDone={() => { setSubs(null); void load(); }} message={adminToken.get() ? "Your session ended. Sign in again." : undefined} />;
  if (!subs && !error) return <div className="center-note"><span className="spin" /></div>;
  const all = subs ?? [];
  const sel = all.find((s) => s.id === open) ?? null;
  const count = (f: (s: PilotSubmission) => boolean) => all.filter(f).length;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Check my dividends: submissions</h1>
          <p>Everyone who has started or finished the pilot. Leads are people who began step 1, finished or not. Open a submission to preview the PDFs that went to each registrar, send or chase, email a pay link, or ask for the success fee. The list refreshes by itself.</p>
        </div>
        <div className="row" style={{ gap: 8 }}>
        <a className="btn ghost sm" href={withBase("/admin/settings")}>Settings</a>
        <button className="btn ghost sm" onClick={() => tab === "leads"
          ? saveBlob(new Blob([leadsCsv(shownLeads)], { type: "text/csv" }), "dividendii-leads.csv")
          : saveBlob(new Blob([submissionsCsv(shown)], { type: "text/csv" }), "dividendii-submissions.csv")}>Export CSV</button>
        </div>
      </div>

      <div className="stats" style={{ marginBottom: 20 }}>
        <div className="stat-card"><div className="k">{leads.length}</div><div className="v">Started (leads)</div></div>
        <div className="stat-card"><div className="k">{all.length}</div><div className="v">Submissions</div></div>
        <div className="stat-card"><div className="k">{count((s) => s.sendStatus === "sent")}</div><div className="v">Fully sent</div></div>
        <div className="stat-card"><div className="k">{count((s) => s.sendStatus !== "sent")}</div><div className="v">Not fully sent</div></div>
        <div className="stat-card"><div className="k">{count((s) => s.payment.status === "awaiting_payment")}</div><div className="v">Awaiting payment</div></div>
        <div className="stat-card"><div className="k">{all.reduce((n, s) => n + s.holdings.length, 0)}</div><div className="v">Companies</div></div>
      </div>

      {error && <div className="field-error" style={{ marginBottom: 12 }}>{error}</div>}
      <div className="tabs" role="tablist" style={{ marginBottom: 16 }}>
        <button className="tab" role="tab" aria-selected={tab === "subs"} onClick={() => setTab("subs")}>Submissions ({all.length})</button>
        <button className="tab" role="tab" aria-selected={tab === "leads"} onClick={() => setTab("leads")}>Leads ({leads.length})</button>
      </div>
      <input className="input" placeholder="Search name, email, CHN, phone, reference or company" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 16 }} />

      {tab === "leads" && (
        <div className="card" style={{ overflowX: "auto" }}>
          {shownLeads.length === 0 ? <p className="tiny">{leads.length ? "No match." : "Nobody has started yet."}</p> : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
              <thead><tr style={{ textAlign: "left", color: "var(--ink-3)" }}>
                {["Name", "Email", "CHN / CSCS", "Last activity", "Email confirmed", "Sent forms"].map((h) => <th key={h} style={{ padding: "6px 10px", fontWeight: 500 }}>{h}</th>)}
              </tr></thead>
              <tbody>{shownLeads.map((l) => (
                <tr key={l.id} style={{ borderTop: "1px solid var(--rule)" }}>
                  <td style={{ padding: "8px 10px" }}><b>{l.firstName} {l.surname}</b>{l.variants.length > 0 && <div className="tiny">Also: {l.variants.join("; ")}</div>}</td>
                  <td style={{ padding: "8px 10px" }}>{l.email}</td>
                  <td style={{ padding: "8px 10px" }}>{l.chn || "Not given"}</td>
                  <td style={{ padding: "8px 10px" }}>{when(l.updatedAt)}</td>
                  <td style={{ padding: "8px 10px" }}><span className={`tag ${l.verifiedAt ? "teal" : ""}`}>{l.verifiedAt ? "Yes" : "No"}</span></td>
                  <td style={{ padding: "8px 10px" }}>{l.submittedRef ? <span className="tag teal">{l.submittedRef}</span> : <span className="tag">Not yet</span>}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </div>
      )}

      {tab === "subs" && <div className="two-col wide">
        <div className="stack">
          {shown.length === 0 && <div className="card"><p className="tiny">{all.length ? "No match." : "No submissions yet."}</p></div>}
          {shown.map((s) => (
            <button key={s.id} type="button" className="card" onClick={() => { setOpen(s.id); setNote(s.note); }}
              style={{ textAlign: "left", cursor: "pointer", padding: "12px 16px", boxShadow: open === s.id ? "0 0 0 2px var(--navy)" : undefined }}>
              <div className="row-between">
                <b>{s.profile.firstName} {s.profile.surname}</b>
                <span className="tiny">{s.ref} &middot; {when(s.createdAt)}</span>
              </div>
              <div className="tiny">{[...new Set(s.holdings.map((h) => h.registrarId))].map((rid) => `${PILOT_REGISTRARS.find((r) => r.id === rid)?.name.split(" ")[0]} ${s.holdings.filter((h) => h.registrarId === rid).length}`).join(" · ")} &middot; {plural(s.holdings.length)} in all</div>
              <div className="tags" style={{ marginTop: 8 }}>
                <span className={`tag ${tone(s.sendStatus)}`}>{label[s.sendStatus]}</span>
                <span className={`tag ${tone(s.payment.status)}`}>{label[s.payment.status]}{s.payment.method === "pay_ahead" ? ` ${nairaExact(s.payment.amountDue)}` : ""}</span>
                {s.mode === "test" && <span className="tag">Test</span>}
              </div>
            </button>
          ))}
        </div>

        <aside className="card" style={{ position: "sticky", top: 24 }}>
          {!sel ? <p className="tiny">Pick a submission to see it in full.</p> : (
            <div className="stack">
              <div>
                <h3 style={{ margin: 0 }}>{sel.profile.firstName} {sel.profile.otherNames} {sel.profile.surname}</h3>
                <div className="tiny">{sel.ref} &middot; {when(sel.createdAt)} &middot; {sel.mode === "test" ? "test mode" : "live"}</div>
              </div>
              <div className="ledger">
                <div className="row"><span className="k">Email</span><span className="v">{sel.profile.email}</span></div>
                <div className="row"><span className="k">Mobile</span><span className="v">{sel.profile.phone1}</span></div>
                <div className="row"><span className="k">BVN</span><span className="v">{sel.profile.bvn}</span></div>
                <div className="row"><span className="k">Bank</span><span className="v">{sel.profile.bankName} {sel.profile.accountNumber}</span></div>
                <div className="row"><span className="k">Address now</span><span className="v">{[sel.profile.address, sel.profile.city, sel.profile.state].filter(Boolean).join(", ")}</span></div>
                <div className="row"><span className="k">Address then</span><span className="v">{sel.atPurchase.address}</span></div>
                {sel.atPurchase.phone && <div className="row"><span className="k">Phone then</span><span className="v">{sel.atPurchase.phone}</span></div>}
                <div className="row"><span className="k">Next of kin</span><span className="v">{[sel.atPurchase.nextOfKinName, sel.atPurchase.nextOfKinRelationship, sel.atPurchase.nextOfKinPhone].filter(Boolean).join(", ")}</span></div>
              </div>

              {PILOT_REGISTRARS.filter((r) => sel.holdings.some((h) => h.registrarId === r.id)).map((r) => {
                const form = sel.forms.find((f) => f.registrarId === r.id);
                const last = [...sel.emails].reverse().find((e) => e.kind === "registrar" && e.registrarId === r.id);
                return (
                  <div key={r.id} className="card" style={{ padding: 12 }}>
                    <div className="row-between"><b>{r.name} &middot; {plural(sel.holdings.filter((h) => h.registrarId === r.id).length)}</b><span className={`tag ${last ? tone(last.status) : "gold"}`}>{last ? label[last.status] : label[sel.sendStatus] ?? "Not sent"}</span></div>
                    <ul className="tiny" style={{ margin: "6px 0", paddingLeft: 16 }}>{sel.holdings.filter((h) => h.registrarId === r.id).map((h) => <li key={h.company}>{h.company}</li>)}</ul>
                    {last && <div className="tiny">To {last.to}{last.wouldHaveGoneTo ? ` (test; real: ${last.wouldHaveGoneTo})` : ""} &middot; {when(last.at)}</div>}
                    {last?.error && <div className="field-error">{last.error}</div>}
                    {form?.unlisted.length ? <div className="tiny">Not on the form, listed in the email: {form.unlisted.join(", ")}</div> : null}
                    {form?.warnings.length ? <div className="tiny">{form.warnings.join(" ")}</div> : null}
                    <div className="btn-row" style={{ marginTop: 8 }}>
                      <button className="btn sm" onClick={() => setPreview({ id: sel.id, registrarId: r.id })}>Preview PDFs</button>
                      <button className="btn ghost sm" disabled={busy === `r-${r.id}`} onClick={() => run(sel.id, { action: "resend", registrarId: r.id }, `r-${r.id}`)}>{busy === `r-${r.id}` ? "Sending" : last?.status === "sent" ? "Send again" : last ? "Retry send" : "Send now"}</button>
                    </div>
                  </div>
                );
              })}

              <div className="ledger">
                <div className="row"><span className="k">Start fee</span><span className="v">{sel.payment.method === "pay_ahead" ? nairaExact(sel.payment.amountDue) : "None (older submission)"}</span></div>
                <div className="row"><span className="k">Status</span><span className="v">{label[sel.payment.status]}{sel.payment.paidAt ? `, ${when(sel.payment.paidAt)}` : ""}{sel.payment.via === "paystack" ? ` by Paystack${sel.payment.channel ? ` (${sel.payment.channel})` : ""}` : sel.payment.via === "manual" ? ", marked by staff" : ""}</span></div>
                {sel.payment.reference && <div className="row"><span className="k">Paystack reference</span><span className="v">{sel.payment.reference}</span></div>}
              </div>
              {sel.payment.method === "pay_ahead" && (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {sel.payment.status !== "paid" && <button className="btn sm" disabled={busy === "paylink"} onClick={() => run(sel.id, { action: "sendPayLink" }, "paylink")}>{busy === "paylink" ? "Sending" : "Email a pay link"}</button>}
                  {sel.payment.via !== "paystack" && (
                    <button className="btn ghost sm" disabled={busy === "pay"} onClick={() => run(sel.id, { action: sel.payment.status === "paid" ? "markUnpaid" : "markPaid" }, "pay")}>
                      {sel.payment.status === "paid" ? "Undo: mark as not paid" : "Mark as paid by hand"}
                    </button>
                  )}
                </div>
              )}
              {sel.payment.method === "pay_ahead" && sel.payment.status !== "paid" && sel.sendStatus === "queued" && <p className="tiny">The forms have not gone to the registrar. They send by themselves when Paystack confirms the start fee. If you mark it paid by hand, press Send on each registrar above.</p>}

              <div className="ledger">
                <div className="row"><span className="k">Success fee</span><span className="v">
                  {sel.successFee?.status === "paid" ? `Paid ${sel.successFee.fee != null ? nairaExact(sel.successFee.fee) : ""}${sel.successFee.paidAt ? `, ${when(sel.successFee.paidAt)}` : ""}${sel.successFee.via === "manual" ? ", marked by staff" : ""}`
                    : sel.successFee?.requests ? `Asked ${sel.successFee.requests} ${sel.successFee.requests === 1 ? "time" : "times"}, last ${when(sel.successFee.requestedAt!)}` : "Not asked yet"}
                </span></div>
                {sel.successFee?.declared != null && <div className="row"><span className="k">They said they received</span><span className="v">{nairaExact(sel.successFee.declared)}</span></div>}
              </div>
              <div className="field">
                <label htmlFor="sfnote">Ask for the success fee</label>
                <textarea id="sfnote" className="input" rows={2} style={{ minHeight: 56 }} value={sfNote} onChange={(e) => setSfNote(e.target.value)} placeholder="Optional line to add, e.g. Africa Prudential told us they paid you on 3 December." />
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
                  <button className="btn sm" disabled={busy === "sfee"} onClick={() => { if (window.confirm(`Email ${sel.profile.email} asking for the success fee?`)) void run(sel.id, { action: "requestSuccessFee", message: sfNote }, "sfee").then(() => setSfNote("")); }}>{busy === "sfee" ? "Sending" : sel.successFee?.requests ? "Send the request again" : "Email the success-fee request"}</button>
                  {sel.successFee?.status !== "paid" && <button className="btn ghost sm" disabled={busy === "sfpaid"} onClick={() => { const a = window.prompt("Success fee received another way. Amount in naira (leave empty if unknown):", ""); if (a !== null) void run(sel.id, { action: "markSuccessPaid", amount: a }, "sfpaid"); }}>Mark as received by hand</button>}
                </div>
                <p className="tiny" style={{ marginTop: 6 }}>The email asks them to say how much the registrar paid them and to pay the agreed share. It is trust-based: we cannot see what they received.</p>
              </div>

              <div className="field">
                <label htmlFor="pnote">Your note</label>
                <textarea id="pnote" className="input" rows={3} style={{ minHeight: 80 }} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Chased on Monday, registrar said..." />
                <button className="btn ghost sm" style={{ marginTop: 6 }} disabled={busy === "note" || note === sel.note} onClick={() => run(sel.id, { action: "note", note }, "note")}>Save note</button>
              </div>

              <details>
                <summary className="tiny">Email log ({sel.emails.length})</summary>
                {sel.emails.map((e, i) => <div key={i} className="tiny">{when(e.at)}: {e.kind}{e.registrarId ? ` (${e.registrarId})` : ""} to {e.to}: {e.status}{e.error ? `, ${e.error}` : ""}</div>)}
              </details>
            </div>
          )}
        </aside>
      </div>}
      {preview && sel && sel.id === preview.id && (
        <Preview sub={sel} registrarId={preview.registrarId} onClose={() => setPreview(null)} busy={busy === `c-${preview.registrarId}`}
          onChase={(message) => run(sel.id, { action: "chase", registrarId: preview.registrarId, message }, `c-${preview.registrarId}`)} />
      )}
    </>
  );
}
