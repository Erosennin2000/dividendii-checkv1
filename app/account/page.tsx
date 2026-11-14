"use client";
import { useCallback, useEffect, useState } from "react";
import { withBase } from "@/lib/base";
import { nairaExact } from "@/lib/site";

type Tab = "dividends" | "investing" | "feedback";
interface Step { label: string; at: string | null; done: boolean; tone?: "good" | "warn" | "bad"; note?: string }
interface Sub {
  ref: string; createdAt: string; test: boolean; message: string | null;
  registrars: { id: string; name: string; companies: string[]; steps: Step[]; current: string }[];
  fees: {
    start: { amount: number; paid: boolean; paidAt: string | null };
    success: { status: "requested" | "paid"; fee: number | null; declared: number | null } | null;
    payStartLink: string | null; paySuccessLink: string | null;
  };
  details: Record<"name" | "email" | "phone" | "bvn" | "bank" | "account" | "address" | "chn" | "addressThen" | "nextOfKin", string> & { otherNames: string[] };
}
interface Me {
  account: { firstName: string; surname: string; email: string; chn: string; hasPassword: boolean; memberSince: string; waitlist: string | null };
  submissions: Sub[];
  session: { via: "code" | "password"; expires: string };
}

const day = (iso: string | null) => iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Lagos" }) : "";
async function call<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(withBase(path), body === undefined ? { cache: "no-store" } : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data?.error ?? `That didn't work (${res.status}).`), { status: res.status });
  return data as T;
}
const msg = (e: unknown) => (e instanceof Error ? e.message : "That didn't work. Try again.");

export default function AccountPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [state, setState] = useState<"loading" | "out" | "in">("loading");
  const [tab, setTab] = useState<Tab>("dividends");
  const [next, setNext] = useState<string | null>(null);
  const [from, setFrom] = useState<"account" | "demo">("account");

  const load = useCallback(async () => {
    try { const m = await call<Me>("/api/account/me"); setMe(m); setState("in"); }
    catch { setMe(null); setState("out"); }
  }, []);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const t = q.get("tab"); if (t === "investing" || t === "feedback" || t === "dividends") setTab(t);
    const n = q.get("next"); if (n && /^\/app(\/[A-Za-z0-9/_-]*)?$/.test(n)) setNext(n);
    if (q.get("from") === "demo") setFrom("demo");
    if (q.get("signout") === "1") { void call("/api/account/logout", {}).finally(() => { window.history.replaceState(null, "", window.location.pathname); void load(); }); return; }
    void load();
  }, [load]);

  const signedIn = async () => {
    if (next) { window.location.assign(next); return; }
    await load();
  };

  if (state === "loading") return <div className="pwrap"><section className="card"><h1>My account</h1><p className="lede"><span className="spin" /></p></section></div>;
  if (state === "out" || !me) return <SignIn onDone={signedIn} demoNext={!!next} />;

  const go = (t: Tab) => { setTab(t); window.history.replaceState(null, "", `?tab=${t}`); };
  return (
    <div className="pwrap acct">
      <div className="acct-head">
        <div>
          <h1>Hello, {me.account.firstName}</h1>
          <p className="tiny">{me.account.email}{me.account.chn ? ` · CHN ${me.account.chn}` : ""}</p>
        </div>
        <button className="btn ghost sm" onClick={async () => { await call("/api/account/logout", {}); setState("out"); setMe(null); }}>Sign out</button>
      </div>

      {!me.account.hasPassword && <SetPasswordNow onDone={load} />}

      <div className="acct-tabs" role="tablist" aria-label="Account">
        {([["dividends", "My dividends"], ["investing", "Investing"], ["feedback", "Feedback"]] as [Tab, string][]).map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => go(k)}>{label}{k === "investing" && <span className="tag gold" style={{ marginLeft: 6 }}>Soon</span>}</button>
        ))}
      </div>

      {tab === "dividends" && <Dividends subs={me.submissions} />}
      {tab === "investing" && <Investing waitlist={me.account.waitlist} onChange={(w) => setMe({ ...me, account: { ...me.account, waitlist: w } })} />}
      {tab === "feedback" && <Feedback from={from} />}
    </div>
  );
}

/* ---------------- signed out ---------------- */

function SignIn({ onDone, demoNext }: { onDone: () => void; demoNext: boolean }) {
  const [mode, setMode] = useState<"password" | "ask" | "code">("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [code, setCode] = useState("");
  const [demo, setDemo] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<void>) { setBusy(true); setError(null); try { await fn(); } catch (e) { setError(msg(e)); } setBusy(false); }

  return (
    <div className="pwrap">
      <section className="card acct-signin">
        {mode === "password" && <>
          <h1>Sign in to your account</h1>
          <p className="lede">{demoNext ? "The investing demo is for account holders. Sign in to open it." : "Follow your dividend claims, see the investing demo and tell us what you think."}</p>
          <form onSubmit={(e) => { e.preventDefault(); void run(async () => { await call("/api/account/login", { email, password }); onDone(); }); }}>
            <div className="field"><label htmlFor="em">Email</label><input id="em" className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
            <div className="field"><label htmlFor="pw">Password</label><input id="pw" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></div>
            {error && <div className="field-error" role="alert">{error}</div>}
            <div className="btn-row" style={{ marginTop: 12 }}>
              <button className="btn lg" disabled={busy || !email || !password}>{busy ? <span className="spin" /> : "Sign in"}</button>
              <button type="button" className="btn quiet" onClick={() => { setMode("ask"); setError(null); }}>Set or reset my password</button>
            </div>
          </form>
          <div className="acct-note">
            <b>First time back?</b> Your account was made when you confirmed your email on the dividend form. You don&apos;t have a password yet: press <i>Set or reset my password</i> and we&apos;ll email you a code.
          </div>
          <p className="tiny" style={{ marginTop: 14 }}>Haven&apos;t checked your dividends yet? <a className="link" href={withBase("/pilot")}>Start a check</a>. Your account is made as you go.</p>
        </>}

        {mode === "ask" && <>
          <h1>Set or reset your password</h1>
          <p className="lede">Enter the email you used on the dividend form. We&apos;ll send you a 6-digit code.</p>
          <form onSubmit={(e) => { e.preventDefault(); void run(async () => { const r = await call<{ demo: boolean }>("/api/account/code", { email }); setDemo(r.demo); setMode("code"); }); }}>
            <div className="field"><label htmlFor="em2">Email</label><input id="em2" className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
            {error && <div className="field-error" role="alert">{error}</div>}
            <div className="btn-row" style={{ marginTop: 12 }}>
              <button className="btn lg" disabled={busy || !email}>{busy ? <span className="spin" /> : "Send me a code"}</button>
              <button type="button" className="btn ghost" onClick={() => { setMode("password"); setError(null); }}>Back</button>
            </div>
          </form>
        </>}

        {mode === "code" && <>
          <h1>Choose your password</h1>
          <p className="lede">If <b>{email}</b> has an account, a code is on its way. It works for 15 minutes.</p>
          {demo && <p className="acct-note"><b>Test mode:</b> no email is sent. The code is <b>123456</b>.</p>}
          <form onSubmit={(e) => { e.preventDefault(); if (password !== password2) { setError("The two passwords don't match."); return; } void run(async () => { await call("/api/account/password", { email, code, password }); onDone(); }); }}>
            <div className="field"><label htmlFor="cd">6-digit code</label><input id="cd" className="input code-input" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} /></div>
            <div className="field-row">
              <div className="field"><label htmlFor="np">New password</label><input id="np" className="input" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} /></div>
              <div className="field"><label htmlFor="np2">Type it again</label><input id="np2" className="input" type="password" autoComplete="new-password" value={password2} onChange={(e) => setPassword2(e.target.value)} /></div>
            </div>
            <p className="tiny">At least 8 characters, with letters as well as numbers.</p>
            {error && <div className="field-error" role="alert">{error}</div>}
            <div className="btn-row" style={{ marginTop: 12 }}>
              <button className="btn lg" disabled={busy || code.length !== 6 || !password}>{busy ? <span className="spin" /> : "Save and sign in"}</button>
              <button type="button" className="btn ghost" onClick={() => { setMode("ask"); setError(null); }}>Send a new code</button>
            </div>
          </form>
        </>}
      </section>
    </div>
  );
}

function SetPasswordNow({ onDone }: { onDone: () => void }) {
  const [pw, setPw] = useState(""); const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  return (
    <section className="card acct-setpw">
      <h2>Set a password so you can come back</h2>
      <p className="tiny">You&apos;re signed in because you just confirmed your email. That lasts a few hours. A password lets you check your progress any time.</p>
      <form className="field-row" style={{ alignItems: "end" }} onSubmit={async (e) => {
        e.preventDefault(); if (pw !== pw2) { setError("The two passwords don't match."); return; }
        setBusy(true); setError(null);
        try { await call("/api/account/password", { password: pw }); onDone(); } catch (err) { setError(msg(err)); }
        setBusy(false);
      }}>
        <div className="field"><label htmlFor="sp1">New password</label><input id="sp1" className="input" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></div>
        <div className="field"><label htmlFor="sp2">Type it again</label><input id="sp2" className="input" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></div>
        <div className="field"><button className="btn" disabled={busy || !pw}>{busy ? <span className="spin" /> : "Save password"}</button></div>
      </form>
      {error && <div className="field-error" role="alert">{error}</div>}
    </section>
  );
}

/* ---------------- tabs ---------------- */

function Dividends({ subs }: { subs: Sub[] }) {
  if (!subs.length) return (
    <section className="card"><h2>No dividend checks yet</h2><p>Tell us the companies you hold shares in and we&apos;ll send the forms to the registrars for you.</p><a className="btn gold" href={withBase("/pilot")}>Start a check</a></section>
  );
  return <>{subs.map((s) => <SubCard key={s.ref} s={s} />)}
    <p className="tiny" style={{ marginTop: 12 }}>Want to check more companies? <a className="link" href={withBase("/pilot")}>Start another check</a>.</p>
  </>;
}

function SubCard({ s }: { s: Sub }) {
  const companies = s.registrars.reduce((n, r) => n + r.companies.length, 0);
  return (
    <section className="card acct-sub">
      <div className="acct-subhead">
        <div><h2>Check {s.ref}</h2><p className="tiny">Started {day(s.createdAt)} · {companies} {companies === 1 ? "company" : "companies"} · {s.registrars.length} {s.registrars.length === 1 ? "registrar" : "registrars"}{s.test ? " · test" : ""}</p></div>
      </div>
      {s.message && <div className="acct-msg"><b>Message from Dividendii:</b> {s.message}</div>}
      {s.fees.payStartLink && <div className="acct-msg warn">Your forms are saved but not sent. They go to the registrar once the start fee of <b>{nairaExact(s.fees.start.amount)}</b> is paid. <a className="btn gold sm" href={s.fees.payStartLink}>Pay now</a></div>}
      {s.fees.paySuccessLink && <div className="acct-msg">We&apos;ve asked for the success fee on this check. <a className="btn gold sm" href={s.fees.paySuccessLink}>Tell us the amount and pay</a></div>}

      {s.registrars.map((r) => (
        <div key={r.id} className="acct-reg">
          <div className="acct-reghead"><b>{r.name}</b><span className="tag navy">{r.current}</span></div>
          <p className="tiny">{r.companies.join(" · ")}</p>
          <ol className="timeline">
            {r.steps.map((st, i) => (
              <li key={i} data-done={st.done} data-tone={st.tone}>
                <span className="dot" aria-hidden />
                <span className="lbl">{st.label}{st.at && <span className="when"> · {day(st.at)}</span>}</span>
                {st.note && <span className="note">{st.note}</span>}
              </li>
            ))}
          </ol>
        </div>
      ))}

      <div className="ledger" style={{ marginTop: 12 }}>
        <div className="row"><span className="k">Start fee</span><span className="v">{s.fees.start.amount ? `${nairaExact(s.fees.start.amount)} · ${s.fees.start.paid ? `paid ${day(s.fees.start.paidAt)}` : "not paid yet"}` : "None"}</span></div>
        <div className="row"><span className="k">Success fee</span><span className="v">{s.fees.success?.status === "paid" ? `Paid${s.fees.success.fee != null ? ` ${nairaExact(s.fees.success.fee)}` : ""}. Thank you` : s.fees.success ? "Asked for" : "Only after a dividend reaches your account"}</span></div>
      </div>

      <details className="acct-details">
        <summary>What you gave us</summary>
        <p className="tiny">Numbers are hidden except the last four. Your photo and signature are only on the forms sent to the registrar.</p>
        <div className="ledger">
          <div className="row"><span className="k">Name</span><span className="v">{s.details.name}</span></div>
          {s.details.otherNames.length > 0 && <div className="row"><span className="k">Also written as</span><span className="v">{s.details.otherNames.join("; ")}</span></div>}
          <div className="row"><span className="k">Email</span><span className="v">{s.details.email}</span></div>
          <div className="row"><span className="k">Mobile</span><span className="v">{s.details.phone}</span></div>
          <div className="row"><span className="k">BVN</span><span className="v">{s.details.bvn}</span></div>
          <div className="row"><span className="k">Bank account</span><span className="v">{s.details.bank} {s.details.account}</span></div>
          {s.details.chn && <div className="row"><span className="k">CHN</span><span className="v">{s.details.chn}</span></div>}
          <div className="row"><span className="k">Address now</span><span className="v">{s.details.address}</span></div>
          <div className="row"><span className="k">Address when you bought</span><span className="v">{s.details.addressThen}</span></div>
          <div className="row"><span className="k">Next of kin then</span><span className="v">{s.details.nextOfKin}</span></div>
        </div>
        <p className="tiny">Something wrong? Reply to any of our emails and quote {s.ref}.</p>
      </details>
    </section>
  );
}

function Investing({ waitlist, onChange }: { waitlist: string | null; onChange: (w: string | null) => void }) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const set = async (join: boolean) => {
    setBusy(true); setError(null);
    try { const r = await call<{ waitlist: string | null }>("/api/account/waitlist", { join }); onChange(r.waitlist); } catch (e) { setError(msg(e)); }
    setBusy(false);
  };
  return (
    <>
      <section className="card acct-invest">
        <span className="tag gold">Coming soon</span>
        <h2>Investing with Dividendii</h2>
        <p>Buy and sell shares on the Nigerian Exchange, hold mutual funds and government bonds, and see your dividends in one place, with your shares held in your own name at CSCS.</p>
        <p className="tiny">Dividendii Limited has applied to the Securities and Exchange Commission, Nigeria, to be registered as a digital sub-broker. The application is pending, and we are not yet registered. Investing opens only once we are.</p>
        <div className="btn-row" style={{ marginTop: 8 }}>
          <a className="btn gold lg" href="/app">Look around the demo</a>
          {waitlist
            ? <button className="btn ghost" disabled={busy} onClick={() => set(false)}>Leave the waitlist</button>
            : <button className="btn" disabled={busy} onClick={() => set(true)}>{busy ? <span className="spin" /> : "Join the waitlist"}</button>}
        </div>
        {waitlist && <p className="acct-ok" role="status">You&apos;re on the waitlist since {day(waitlist)}. We&apos;ll email you when investing opens.</p>}
        {error && <div className="field-error" role="alert">{error}</div>}
      </section>
      <section className="card">
        <h2>About the demo</h2>
        <p>The demo shows what your investing account will look like. Everything in it is sample data: the prices, the balance and the orders are not real, and no money moves. Click around as much as you like.</p>
        <p className="tiny">Tell us what you think in the Feedback tab. It shapes what we build first.</p>
      </section>
    </>
  );
}

function Feedback({ from }: { from: "account" | "demo" }) {
  const [rating, setRating] = useState<number | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  if (sent) return <section className="card"><h2>Thank you</h2><p>We read every message. If you asked a question, we&apos;ll reply by email.</p><button className="btn ghost" onClick={() => { setSent(false); setText(""); setRating(null); }}>Send more feedback</button></section>;
  return (
    <section className="card">
      <h2>Tell us what you think</h2>
      <p>{from === "demo" ? "About the investing demo: what made sense, what was confusing, what you would want first." : "About checking your dividends, this account, or the investing demo. What was confusing, what you liked, what you want next."}</p>
      <div className="field">
        <span className="label" id="rlab">How was it overall? (optional)</span>
        <div className="acct-rating" role="radiogroup" aria-labelledby="rlab">
          {[1, 2, 3, 4, 5].map((n) => <button key={n} type="button" role="radio" aria-checked={rating === n} className={rating === n ? "on" : ""} onClick={() => setRating(rating === n ? null : n)}>{n}</button>)}
          <span className="tiny" style={{ marginLeft: 8 }}>1 is poor, 5 is great</span>
        </div>
      </div>
      <div className="field"><label htmlFor="fb">Your feedback</label><textarea id="fb" className="input" rows={5} style={{ minHeight: 120 }} value={text} onChange={(e) => setText(e.target.value)} maxLength={3000} /></div>
      {error && <div className="field-error" role="alert">{error}</div>}
      <button className="btn" disabled={busy || text.trim().length < 3} onClick={async () => {
        setBusy(true); setError(null);
        try { await call("/api/account/feedback", { message: text, rating, page: from }); setSent(true); } catch (e) { setError(msg(e)); }
        setBusy(false);
      }}>{busy ? <span className="spin" /> : "Send feedback"}</button>
    </section>
  );
}
