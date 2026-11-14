import { isEmail, isElevenDigits, isNuban } from "@/lib/domain/validation";
import { normalizeNgPhone } from "@/lib/domain/phone";
import type { FormProfile } from "@/lib/forms/types";
import { MAX_COMPANIES, PILOT_COMPANIES, pilotRegistrar, type PilotRegistrarId } from "./config";
import { clean } from "./text";
import type { PilotInput } from "./types";

export class PilotValidationError extends Error {
  constructor(public problems: string[]) {
    super(problems.join(" "));
  }
}

const PROFILE_KEYS: (keyof FormProfile)[] = ["surname", "firstName", "otherNames", "bvn", "bankName", "accountNumber", "address", "city", "state", "country", "previousAddress", "chn", "phone1", "phone2", "email"];

export type PilotStep = 1 | 2 | 3 | 4;

/** What is still missing or wrong, grouped by the four steps of the form. Plain language, so the form can show it as is. */
export function pilotProblemsByStep(i: PilotInput): Record<PilotStep, string[]> {
  const has = (s: string) => !!s?.trim();
  const p: Record<PilotStep, string[]> = { 1: [], 2: [], 3: [], 4: [] };
  if (!has(i.profile.firstName)) p[1].push("your first name");
  if (!has(i.profile.surname)) p[1].push("your surname");
  if (!isEmail(i.profile.email)) p[1].push("a valid email address");
  if (!i.holdings.length) p[2].push("at least one company");
  if (i.holdings.length > MAX_COMPANIES) p[2].push(`no more than ${MAX_COMPANIES} companies`);
  if (!isElevenDigits(i.profile.bvn)) p[3].push("your 11-digit BVN");
  if (!has(i.profile.bankName)) p[3].push("your bank");
  if (!isNuban(i.profile.accountNumber)) p[3].push("your 10-digit account number");
  if (!has(i.profile.address)) p[3].push("your current address");
  if (!has(i.profile.city) || !has(i.profile.state)) p[3].push("your city and state");
  if (!normalizeNgPhone(i.profile.phone1)) p[3].push("a Nigerian mobile number");
  if (!has(i.atPurchase.address)) p[3].push("your address when you bought the shares");
  if (!has(i.atPurchase.nextOfKinName)) p[3].push("your next of kin when you bought the shares");
  if (!i.photo) p[4].push("a passport photo");
  if (!i.signature) p[4].push("your signature");
  if (!i.payment.acknowledged) p[4].push("a tick to confirm you understand the fees");
  if (!i.consent) p[4].push("a tick to let us send your forms");
  return p;
}

/** Everything missing, in step order. The server uses this as its final check. */
export function pilotProblems(i: PilotInput): string[] {
  const by = pilotProblemsByStep(i);
  return [...by[1], ...by[2], ...by[3], ...by[4]];
}

/** Server side: take untrusted JSON, return a clean PilotInput or throw with every problem listed. */
/** `isOpen` lets the caller refuse registrars an admin has switched off. Left out, every registrar is accepted. */
export function parsePilotInput(raw: unknown, opts: { isOpen?: (registrarId: string) => boolean } = {}): PilotInput {
  const b = (raw ?? {}) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const rp = (b.profile ?? {}) as Record<string, unknown>;
  const profile = Object.fromEntries(PROFILE_KEYS.map((k) => [k, clean(rp[k], k === "address" || k === "previousAddress" ? 300 : 120)])) as unknown as FormProfile;
  profile.bvn = profile.bvn.replace(/\D/g, "");
  profile.accountNumber = profile.accountNumber.replace(/\D/g, "");
  profile.email = profile.email.toLowerCase();
  profile.chn = profile.chn.toUpperCase().replace(/\s/g, "");
  profile.country ||= "Nigeria";
  const phone = normalizeNgPhone(profile.phone1);
  if (phone) profile.phone1 = phone;

  const ap = (b.atPurchase ?? {}) as Record<string, unknown>;
  const atPurchase = {
    address: clean(ap.address, 300),
    phone: clean(ap.phone, 40),
    nextOfKinName: clean(ap.nextOfKinName, 120),
    nextOfKinRelationship: clean(ap.nextOfKinRelationship, 60),
    nextOfKinPhone: clean(ap.nextOfKinPhone, 40),
  };
  // The registrar forms have one "previous address" box. The address at purchase is what the register holds.
  profile.previousAddress = atPurchase.address;

  const variants = (Array.isArray(b.variants) ? b.variants : []).map((v: unknown) => clean(v, 120)).filter(Boolean).slice(0, 10);
  const holdings: PilotInput["holdings"] = [];
  const problems: string[] = [];
  for (const h of Array.isArray(b.holdings) ? b.holdings.slice(0, MAX_COMPANIES + 1) : []) {
    const registrarId = String(h?.registrarId ?? "");
    const company = String(h?.company ?? "");
    if (!pilotRegistrar(registrarId)) { problems.push(`${registrarId || "That registrar"} isn't a registrar we cover.`); continue; }
    if (opts.isOpen && !opts.isOpen(registrarId)) { problems.push(`${pilotRegistrar(registrarId)!.name} isn't taking submissions right now.`); continue; }
    // Only names printed on the form's own list are accepted, so nothing arbitrary reaches a registrar.
    const listed = PILOT_COMPANIES.find((c) => c.registrarId === registrarId && c.company === company);
    if (!listed) { problems.push(`${company.slice(0, 80) || "That company"} isn't on that registrar's form.`); continue; }
    if (!holdings.some((x) => x.registrarId === registrarId && x.company === company)) holdings.push({ registrarId: registrarId as PilotRegistrarId, company });
  }

  const pay = (b.payment ?? {}) as Record<string, unknown>;
  const method = "pay_ahead"; // one fee model: start fee before sending, then a success fee
  const dataUrl = (v: unknown, max: number) => (typeof v === "string" && /^data:image\/(png|jpe?g);base64,/.test(v) && v.length < max ? v : null);

  const input: PilotInput = {
    profile, atPurchase, variants, holdings,
    photo: dataUrl(b.photo, 8_000_000),
    signature: dataUrl(b.signature, 3_000_000),
    payment: { method: (method ?? "debit_after") as PilotInput["payment"]["method"], acknowledged: pay.acknowledged === true },
    consent: b.consent === true,
    website: typeof b.website === "string" ? b.website : "",
  };
  if (!method) problems.push("Choose how you'd like to pay.");
  const missing = pilotProblems(input);
  if (missing.length || problems.length) {
    throw new PilotValidationError([...problems, ...(missing.length ? [`Still needed: ${missing.join(", ")}.`] : [])]);
  }
  return input;
}
