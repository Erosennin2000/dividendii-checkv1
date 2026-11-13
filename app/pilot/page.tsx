"use client";

import { useEffect, useMemo, useState } from "react";
import { withBase } from "@/lib/base";
import { nairaExact } from "@/lib/site";
import { CompanyPicker } from "@/components/CompanyPicker";
import { Check, SelectField, TextField } from "@/components/Field";
import { FileDrop } from "@/components/FileDrop";
import { SignaturePad } from "@/components/SignaturePad";
import { PhotoIcon, PlusIcon, XIcon } from "@/components/icons";
import { BANK_GROUPS, OTHER_BANK, ALL_BANKS } from "@/lib/pilot/banks";
import { naira } from "@/lib/domain/fees";
import { emptyProfile } from "@/lib/forms/registry";
import type { FormProfile } from "@/lib/forms/types";
import { resizeImage } from "@/lib/image";
import { DEBIT_RATE, PAY_AHEAD_PER_COMPANY, PILOT_REGISTRARS, companiesFor, type PilotRegistrarId } from "@/lib/pilot/config";
import type { PaymentMethod, PilotInput } from "@/lib/pilot/types";
import { pilotProblemsByStep, type PilotStep } from "@/lib/pilot/validate";
import { errorMessage } from "@/lib/util";

type Held = { registrarId: PilotRegistrarId; company: string };
interface Result {
  id: string; ref: string; sendStatus: "queued" | "sending" | "sent" | "partial" | "failed"; mode: "test" | "live";
  registrars: string[]; companyCount: number; byHand: string[]; payment: { method: PaymentMethod; amountDue: number };
}

const STEPS = ["You", "Your companies", "Your details", "Sign and send"] as const;
const emptyAt = { address: "", phone: "", nextOfKinName: "", nextOfKinRelationship: "", nextOfKinPhone: "" };

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(withBase(url), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? `That didn't work (${res.status}).`);
  return data as T;
}

interface PublicCfg { open: boolean; mode: "test" | "live"; registrars: { id: string; name: string }[]; payAheadPerCompany: number; debitRatePercent: number }
/** Used until the server answers, and if it can't: every registrar on, the standard prices. */
const DEFAULT_CFG: PublicCfg = { open: true, mode: "test", registrars: PILOT_REGISTRARS.map((r) => ({ id: r.id, name: r.name })), payAheadPerCompany: PAY_AHEAD_PER_COMPANY, debitRatePercent: DEBIT_RATE * 100 };

export default function PilotPage() {
  const [cfg, setCfg] = useState<PublicCfg>(DEFAULT_CFG);
  useEffect(() => { fetch(withBase("/api/pilot/config"), { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((c) => { if (c) setCfg(c as PublicCfg); }).catch(() => { /* keep the defaults */ }); }, []);
  const rate = cfg.debitRatePercent;
  const perCompany = cfg.payAheadPerCompany;
  const [step, setStep] = useState<PilotStep>(1);
  // Step 1
  const [profile, setProfile] = useState<FormProfile>(emptyProfile());
  const [variants, setVariants] = useState<string[]>([]);
  const [pending, setPending] = useState("");
  const [lead, setLead] = useState<{ id: string; demo: boolean } | null>(null);
  const [code, setCode] = useState("");
  const [token, setToken] = useState<string | null>(null);
  // Step 2
  const [regName, setRegName] = useState("");
  const [held, setHeld] = useState<Held[]>([]);
  // Step 3
  const [at, setAt] = useState(emptyAt);
  // Step 4
  const [photo, setPhoto] = useState<string | null>(null);
  const [signature, setSignature] = useState<string | null>(null);
  const method: PaymentMethod = "debit_after";
  const [payAck, setPayAck] = useState(false);
  const [consent, setConsent] = useState(false);
  const [website, setWebsite] = useState(""); // honeypot
  // Shared
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  const regId = cfg.registrars.find((r) => r.name === regName)?.id ?? "";
  const options = useMemo(
    () => companiesFor(regId).map((c) => c.company).filter((c) => !held.some((h) => h.registrarId === regId && h.company === c)),
    [regId, held],
  );
  const byRegistrar = PILOT_REGISTRARS.map((r) => ({ r, items: held.filter((h) => h.registrarId === r.id) })).filter((g) => g.items.length);
  const startWithVat = Math.round(perCompany * 1.075 * 100) / 100;

  const input: PilotInput = { profile, atPurchase: at, variants, holdings: held, photo, signature, payment: { method, acknowledged: payAck }, consent };
  const problems = pilotProblemsByStep(input);

  const set = (k: keyof FormProfile) => (v: string) => setProfile((p) => ({ ...p, [k]: v }));
  const digits = (k: keyof FormProfile, n: number) => (v: string) => set(k)(v.replace(/\D/g, "").slice(0, n));
  const setA = (k: keyof typeof emptyAt) => (v: string) => setAt((a) => ({ ...a, [k]: v }));
  const go = (s: PilotStep) => { setStep(s); setError(null); window.scrollTo({ top: 0, behavior: "smooth" }); };

  function addVariant() {
    const v = pending.trim();
    if (v && !variants.some((x) => x.toLowerCase() === v.toLowerCase())) setVariants([...variants, v]);
    setPending("");
  }
  function addCompanies(list: string[]) {
    if (!regId) return;
    setHeld((h) => [...h, ...list.filter((c) => !h.some((x) => x.registrarId === regId && x.company === c)).map((company) => ({ registrarId: regId as PilotRegistrarId, company }))]);
  }
  const bankListed = ALL_BANKS.includes(profile.bankName);
  const [bankOther, setBankOther] = useState(false);

  /** Step 1: save what they've told us, then ask for the code. */
  async function sendCode() {
    setBusy(true); setError(null);
    try {
      const r = await post<{ leadId: string; demo: boolean }>("/api/pilot/start", {
        firstName: profile.firstName, surname: profile.surname, otherNames: profile.otherNames, variants, email: profile.email, chn: profile.chn, website,
      });
      setLead({ id: r.leadId, demo: r.demo }); setCode(""); setToken(null);
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  async function checkCode() {
    if (!lead) return;
    setBusy(true); setError(null);
    try {
      const r = await post<{ token: string }>("/api/pilot/verify", { leadId: lead.id, code });
      setToken(r.token);
      go(2);
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  async function submit() {
    setBusy(true); setError(null);
    try {
      const r = await post<Result>("/api/pilot/submit", { ...input, token, website });
      setResult(r); // the reference shows at once; the emails go out behind it
      window.scrollTo({ top: 0, behavior: "smooth" });
      if (r.sendStatus === "queued") {
        post<{ sendStatus: Result["sendStatus"] }>("/api/pilot/dispatch", { id: r.id, token })
          .then((d) => setResult((cur) => (cur ? { ...cur, sendStatus: d.sendStatus } : cur)))
          .catch(() => setResult((cur) => (cur ? { ...cur, sendStatus: "failed" } : cur)));
      }
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }

  if (result) return <Done r={result} email={profile.email} first={profile.firstName} rate={rate} perCompany={perCompany} />;
  if (!cfg.open) return <div className="card" style={{ maxWidth: 560, margin: "48px auto" }}><h1 style={{ fontSize: 28 }}>We&apos;ve paused new submissions</h1><p className="lede">We aren&apos;t taking new forms for a short while. Please check back soon.</p></div>;

  const waitingForCode = step === 1 && lead && !token;

  return (
    <div className="pwrap">
      <ol className="pstepper" aria-label="Progress">
        {STEPS.map((n, i) => (
          <li key={n} data-s={i + 1 < step ? "done" : i + 1 === step ? "now" : "todo"} aria-current={i + 1 === step ? "step" : undefined}>
            <div className="bar" /><span className="nm"><span className="num">{i + 1}</span><span className="txt">. {n}</span></span>
          </li>
        ))}
      </ol>

      {/* ---------------- Step 1 ---------------- */}
      {step === 1 && !waitingForCode && (
        <section className="card">
          <h1>First, who are you?</h1>
          <p className="lede">Give your name exactly as it appears on your ID. Then add any other ways it was written, because registers rarely match an ID exactly.</p>
          <div className="field-row three">
            <TextField label="First name" value={profile.firstName} onChange={set("firstName")} autoComplete="given-name" />
            <TextField label="Other names" value={profile.otherNames} onChange={set("otherNames")} placeholder="Optional" autoComplete="additional-name" />
            <TextField label="Surname" value={profile.surname} onChange={set("surname")} autoComplete="family-name" />
          </div>

          <div className="field">
            <label htmlFor="variant">Other ways your name was written</label>
            <div className="tags" style={{ marginBottom: variants.length ? 8 : 0 }}>
              {variants.map((v) => (
                <button key={v} type="button" className="chip" onClick={() => setVariants(variants.filter((x) => x !== v))} aria-label={`Remove ${v}`}>{v} <XIcon /></button>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <input id="variant" className="input" value={pending} placeholder="A maiden name, initials, or an old spelling"
                onChange={(e) => setPending(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addVariant(); } }} />
              <button type="button" className="icon-btn" onClick={addVariant} aria-label="Add this spelling"><PlusIcon /></button>
            </div>
            <div className="hint">For example A. B. Ogunyemi, Ogunyemi Adewale, or the name on an old share certificate. Optional.</div>
          </div>

          <div className="field-row">
            <TextField label="Email" value={profile.email} onChange={set("email")} type="email" inputMode="email" autoComplete="email" hint="We send a code here to confirm it's you." />
            <TextField label="CHN or CSCS number" value={profile.chn} onChange={(v) => set("chn")(v.toUpperCase().slice(0, 20))} placeholder="Optional"
              hint="Find it on a dividend warrant or your CSCS statement." />
          </div>
          <input type="text" name="website" value={website} onChange={(e) => setWebsite(e.target.value)} tabIndex={-1} autoComplete="off" aria-hidden="true"
            style={{ position: "absolute", left: "-9999px", width: 1, height: 1, opacity: 0 }} />
          <p className="tiny">We save these as soon as you continue, so you don&apos;t lose your place. We use them only to process your claim.</p>
          <div className="pnav">
            <span className="note">{problems[1].length ? `Still needed: ${problems[1].join(", ")}.` : ""}</span>
            <button className="btn lg" disabled={busy || problems[1].length > 0} onClick={sendCode}>{busy ? <span className="spin" /> : "Continue"}</button>
          </div>
          {error && <div className="field-error">{error}</div>}
        </section>
      )}

      {waitingForCode && lead && (
        <section className="card">
          <h1>Check your email</h1>
          <p className="lede">We sent a 6-digit code to <b>{profile.email}</b>. Enter it to continue.</p>
          <div className="field">
            <label htmlFor="code">Code</label>
            <input id="code" className="input code-input" inputMode="numeric" autoComplete="one-time-code" value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} onKeyDown={(e) => { if (e.key === "Enter" && code.length === 6) void checkCode(); }} />
            {lead.demo && <div className="hint">Demo mode: the code is <b>123456</b>. No email is sent.</div>}
          </div>
          <div className="pnav">
            <button className="btn ghost" onClick={() => { setLead(null); setError(null); }}>Change my details</button>
            <span style={{ display: "flex", gap: 8 }}>
              <button className="btn quiet" disabled={busy} onClick={sendCode}>Send a new code</button>
              <button className="btn lg" disabled={busy || code.length !== 6} onClick={checkCode}>{busy ? <span className="spin" /> : "Confirm"}</button>
            </span>
          </div>
          {error && <div className="field-error">{error}</div>}
        </section>
      )}

      {/* ---------------- Step 2 ---------------- */}
      {step === 2 && (
        <section className="card">
          <h1>Where do you hold shares?</h1>
          <p className="lede">Pick a registrar, tick every company you hold there, then press Add. Then do the same for any other registrar you have shares with.</p>
          <SelectField label="Registrar" value={regName} onChange={(v) => { setRegName(v); }} options={cfg.registrars.map((r) => r.name)} placeholder="Choose a registrar" />
          <CompanyPicker key={regId} options={options} disabled={!regId} placeholder={regId ? "Tick your companies" : "Choose a registrar first"} onAdd={addCompanies} />

          {byRegistrar.length > 0 && (
            <div className="stack" style={{ marginTop: 20 }}>
              {byRegistrar.map(({ r, items }) => (
                <div key={r.id}>
                  <div className="tiny" style={{ fontWeight: 600 }}>{r.name} &middot; {items.length} {items.length === 1 ? "company" : "companies"}</div>
                  <div className="tags" style={{ marginTop: 6 }}>
                    {items.map((h) => (
                      <button key={h.company} type="button" className="chip" aria-label={`Remove ${h.company}`}
                        onClick={() => setHeld((all) => all.filter((x) => !(x.registrarId === h.registrarId && x.company === h.company)))}>{h.company} <XIcon /></button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
          <p className="tiny" style={{ marginTop: 16 }}>Not covered: companies whose registrar isn&apos;t in the list, and FBN Holdings (First Registrars&apos; form doesn&apos;t list it).</p>
          <Nav back={() => go(1)} next={() => go(3)} problems={problems[2]} />
        </section>
      )}

      {/* ---------------- Step 3 ---------------- */}
      {step === 3 && (
        <section className="card">
          <h1>Your details</h1>
          <p className="lede">The registrar needs these to match you to the register and to pay you. Write them as your bank holds them.</p>
          <div className="field-row">
            <TextField label="BVN" value={profile.bvn} onChange={digits("bvn", 11)} inputMode="numeric" placeholder="11 digits" />
            <TextField label="Account number" value={profile.accountNumber} onChange={digits("accountNumber", 10)} inputMode="numeric" placeholder="10 digits"
              hint={profile.accountNumber.length === 10 ? "Looks right." : `${profile.accountNumber.length} of 10 digits`}
              error={profile.accountNumber.length > 0 && profile.accountNumber.length < 10 ? "An account number has exactly 10 digits." : undefined} />
          </div>
          <div className="field">
            <label htmlFor="bank">Bank</label>
            <select id="bank" className="input" value={bankOther ? OTHER_BANK : bankListed ? profile.bankName : ""}
              onChange={(e) => { const v = e.target.value; if (v === OTHER_BANK) { setBankOther(true); set("bankName")(""); } else { setBankOther(false); set("bankName")(v); } }}>
              <option value="">Choose your bank</option>
              {BANK_GROUPS.map((g) => <optgroup key={g.group} label={g.group}>{g.banks.map((b) => <option key={b} value={b}>{b}</option>)}</optgroup>)}
              <option value={OTHER_BANK}>{OTHER_BANK}</option>
            </select>
            {bankOther && <input className="input" style={{ marginTop: 8 }} placeholder="Type your bank's name" value={profile.bankName} onChange={(e) => set("bankName")(e.target.value)} />}
          </div>
          <TextField label="Home address now" value={profile.address} onChange={set("address")} placeholder="House number, street and area" autoComplete="street-address" />
          <div className="field-row three">
            <TextField label="City or town" value={profile.city} onChange={set("city")} autoComplete="address-level2" />
            <TextField label="State" value={profile.state} onChange={set("state")} autoComplete="address-level1" />
            <TextField label="Country" value={profile.country} onChange={set("country")} autoComplete="country-name" />
          </div>
          <TextField label="Mobile number" value={profile.phone1} onChange={set("phone1")} type="tel" inputMode="tel" autoComplete="tel" placeholder="0803 123 4567" />

          <h2 style={{ marginTop: 28 }}>When you bought the shares</h2>
          <p className="tiny">The register holds what you gave back then. These help the registrar find your holding.</p>
          <TextField label="Your home address at that time" value={at.address} onChange={setA("address")} placeholder="House number, street, area and city" />
          <TextField label="Your phone number at that time" value={at.phone} onChange={setA("phone")} type="tel" inputMode="tel" placeholder="Optional, if you remember it" />
          <div className="field-row three">
            <TextField label="Next of kin at that time" value={at.nextOfKinName} onChange={setA("nextOfKinName")} placeholder="Full name" />
            <TextField label="Relationship" value={at.nextOfKinRelationship} onChange={setA("nextOfKinRelationship")} placeholder="e.g. Spouse, mother" />
            <TextField label="Their phone" value={at.nextOfKinPhone} onChange={setA("nextOfKinPhone")} type="tel" inputMode="tel" placeholder="Optional" />
          </div>
          <Nav back={() => go(2)} next={() => go(4)} problems={problems[3]} />
        </section>
      )}

      {/* ---------------- Step 4 ---------------- */}
      {step === 4 && (
        <div className="stack">
          <section className="card">
            <h1>Sign and send</h1>
            <p className="lede">Add your photo and signature. They go on your mandate form and on your letter of authority.</p>
            <FileDrop label="Passport photograph" accept="image/*" icon={<PhotoIcon />}
              hint="A clear, recent photo on a plain background. It goes in the passport box on the form."
              filledLabel={photo ? "Photo added. Tap to replace" : null} preview={photo}
              onFile={async (f) => setPhoto(await resizeImage(f))} />
            <div className="field" style={{ marginTop: 12 }}>
              <span className="label">Signature</span>
              <SignaturePad value={signature} onChange={setSignature} />
              <p className="tiny">Sign the way you signed when you bought the shares. Registrars compare it with their specimen.</p>
            </div>
          </section>

          <section className="card">
            <h2>Our fee, in plain words</h2>
            <p className="tiny">Sending your forms is free. The registrar pays any dividend straight into your own account. Dividendii never holds your money.</p>
            <div className="ledger" style={{ margin: "10px 0" }}>
              <div className="row"><span className="k">Today</span><span className="v">{naira(0)}</span></div>
              <div className="row"><span className="k">If a registrar confirms there is money for you</span><span className="v">{naira(perCompany)} + 7.5% VAT ({nairaExact(startWithVat)}) per company</span></div>
              <div className="row"><span className="k">Only when a dividend reaches your account</span><span className="v">{rate}% of that payment</span></div>
            </div>
            <p className="tiny">We ask for the start fee only after a registrar tells us there is money, and we tell you the exact amount first. The {rate}% is never taken before you are paid. If nothing is found, you owe nothing.</p>
            <div style={{ marginTop: 12 }}>
              <Check checked={payAck} onToggle={() => setPayAck((v) => !v)}>
                <b>I understand the fees above.</b> I&apos;ll be told the exact amount before anything is asked of me.
              </Check>
            </div>
          </section>

          <section className="card">
            <h2>Your go-ahead</h2>
            <Check checked={consent} onToggle={() => setConsent((v) => !v)}>
              <b>I let Dividendii act for me on the companies I listed.</b> That means completing my registrar mandate form, signing a letter of authority with the signature I drew, and emailing both, with my passport photo and the details I gave, to the registrar. It covers these holdings only. Dividendii can&apos;t sell or transfer my shares, and can&apos;t receive my money.
            </Check>
            <div className="psum" style={{ marginTop: 16 }}>
              <span>{held.length} {held.length === 1 ? "company" : "companies"} with {byRegistrar.map((g) => g.r.name).join(" and ")}</span>
              <b>Free to send</b>
            </div>
            <div className="pnav" style={{ marginTop: 0 }}>
              <button className="btn ghost" onClick={() => go(3)}>Back</button>
              <button className="btn gold lg" disabled={busy || problems[4].length > 0} onClick={submit}>{busy ? <span className="spin" /> : "Send my forms"}</button>
            </div>
            {problems[4].length > 0 && <p className="tiny" style={{ marginTop: 8 }}>Still needed: {problems[4].join(", ")}.</p>}
            {error && <div className="field-error">{error}</div>}
            <p className="tiny" style={{ marginTop: 12 }}>Nothing is sent until you press the button. We email the registrar for you, and send you a confirmation.</p>
          </section>
        </div>
      )}
    </div>
  );
}

function Nav({ back, next, problems }: { back: () => void; next: () => void; problems: string[] }) {
  return (
    <div className="pnav">
      <button className="btn ghost" onClick={back}>Back</button>
      <span className="note" style={{ textAlign: "right" }}>{problems.length ? `Still needed: ${problems.join(", ")}.` : ""}</span>
      <button className="btn lg" disabled={problems.length > 0} onClick={next}>Continue</button>
    </div>
  );
}

function Done({ r, email, first, rate, perCompany }: { r: Result; email: string; first: string; rate: number; perCompany: number }) {
  const ok = r.sendStatus === "sent";
  const pending = r.sendStatus === "queued" || r.sendStatus === "sending";
  return (
    <div className="pwrap">
      <section className="card">
        <h1>{pending ? `Got it, ${first}. Sending your forms now.` : ok ? `Done, ${first}. Your forms are on their way.` : r.sendStatus === "partial" ? "Part of your submission went out" : "We saved your details, but the email didn't go yet"}</h1>
        <p className="lede">
          {pending && <>Your details are saved under reference <b>{r.ref}</b>. We&apos;re emailing your completed mandate form and signed letter of authority to {r.registrars.join(" and ")} now. This takes a few seconds.</>}
          {ok && <>We sent your completed mandate form and signed letter of authority to {r.registrars.join(" and ")}. A confirmation is on its way to <b>{email}</b>.</>}
          {r.sendStatus === "partial" && <>One registrar&apos;s email didn&apos;t go. Your details are saved, and we&apos;ll send the rest. You don&apos;t need to do anything.</>}
          {r.sendStatus === "failed" && <>Nothing has reached the registrar yet. Your details are saved with us and we&apos;ll send them. You don&apos;t need to fill this in again.</>}
        </p>
        <div className="ledger" style={{ margin: "8px 0 16px" }}>
          <div className="row"><span className="k">Your reference</span><span className="v">{r.ref}</span></div>
          <div className="row"><span className="k">Companies</span><span className="v">{r.companyCount}</span></div>
          <div className="row"><span className="k">Our fee</span><span className="v">Free to send. {naira(perCompany)} + VAT per company once a registrar confirms money, then {rate}% only when you are paid</span></div>
        </div>
        <h2>What happens next</h2>
        <ol className="pdone-steps">
          <li>The registrar checks its records and replies to us. We will send you a first update on WhatsApp or email within 24 hours.</li>
          <li>We follow up until each claim is paid or closed, and tell you when anything changes.</li>
          <li>Any dividend is paid by the registrar straight into your account.</li>
        </ol>
        {r.byHand.length > 0 && <p className="tiny" style={{ marginTop: 16 }}>Not printed on the registrar&apos;s form, so we listed them in the email for the registrar to add: {r.byHand.join(", ")}.</p>}
        {r.mode === "test" && <p className="tiny"><b>Test mode:</b> the registrar emails went to our test inbox, not the registrar.</p>}
      </section>
    </div>
  );
}
