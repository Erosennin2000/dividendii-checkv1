/**
 * Pilot settings an admin can change without a developer. Safe to import in the browser and on the server.
 * Anything left blank falls back to the environment (see settings.ts), so an untouched install behaves as before.
 */
import { PILOT_REGISTRARS } from "./config";

export interface RegistrarSetting { enabled: boolean; email: string }

/** Everything the admin can edit. All fields optional when stored: a missing one means "use the default". */
export interface PilotSettings {
  /** The name registrars and shareholders see in emails and on the letter of authority. */
  brandName: string;
  /** "live" sends to real registrars. Anything else is test. */
  mode: "test" | "live";
  /** Off = the public form shows a "paused" message and refuses submissions. */
  acceptingSubmissions: boolean;
  senderName: string;
  senderEmail: string;
  replyTo: string;
  /** Blind-copied on every live registrar email. */
  adminCopy: string;
  /** Where registrar emails go while in test mode. */
  testInbox: string;
  /** Optional extra paragraph added to every registrar email. */
  registrarNote: string;
  registrars: Record<string, RegistrarSetting>;
  payment: { bank: string; accountName: string; accountNumber: string };
  payAheadPerCompany: number;
  debitRatePercent: number;
  updatedAt?: string;
  updatedBy?: string;
}

export type StoredSettings = Partial<Omit<PilotSettings, "registrars" | "payment">> & {
  registrars?: Record<string, Partial<RegistrarSetting>>;
  payment?: Partial<PilotSettings["payment"]>;
};

export const EMAIL_RE = /^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]+$/;
export const isEmail = (s: string) => EMAIL_RE.test(s.trim());

/** Things on a registrar's own form that an admin should double-check before sending for real. */
export const REGISTRAR_CAUTIONS: Record<string, string> = {
  centurion: "The form prints \"cusomercare@\", which looks like a typo for \"customercare@\". Confirm before going live.",
  edc: "The form gives a complaints mailbox. Confirm EDC accepts mandates there.",
  mainstreet: "The form gives a Yahoo address. Confirm it is still monitored.",
  africaprudential: "The form has 10 BVN boxes for an 11-digit BVN, so one digit runs past the last box.",
  cordros: "The address line holds about 19 characters; longer addresses are cut on the form (the email body has the full address).",
};

const line = (v: unknown, max: number) => String(v ?? "").replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const para = (v: unknown, max: number) => String(v ?? "").replace(/\r/g, "").replace(/<[^>]*>/g, "").trim().slice(0, max);

/**
 * Turns whatever the settings form posted into a clean partial update, or throws a message an admin can act on.
 * Only keys that are present are changed, so a partial post can't wipe other settings.
 */
export function parseSettingsPatch(raw: unknown): StoredSettings {
  if (!raw || typeof raw !== "object") throw new Error("Nothing to save.");
  const b = raw as Record<string, unknown>;
  const out: StoredSettings = {};
  const problems: string[] = [];
  const email = (key: keyof StoredSettings, label: string, required = false) => {
    if (!(key in b)) return;
    const v = line(b[key], 200);
    if (!v) { if (required) problems.push(`${label} can't be blank.`); (out as Record<string, unknown>)[key] = ""; return; }
    if (!isEmail(v)) { problems.push(`${label} doesn't look like an email address.`); return; }
    (out as Record<string, unknown>)[key] = v;
  };

  if ("brandName" in b) { const v = line(b.brandName, 60); if (!v) problems.push("The business name can't be blank."); else out.brandName = v; }
  if ("mode" in b) out.mode = b.mode === "live" ? "live" : "test";
  if ("acceptingSubmissions" in b) out.acceptingSubmissions = b.acceptingSubmissions === true;
  if ("senderName" in b) out.senderName = line(b.senderName, 80).replace(/["<>]/g, "");
  email("senderEmail", "The sending email");
  email("replyTo", "The reply-to email");
  email("adminCopy", "The copy-me email");
  email("testInbox", "The test inbox");
  if ("registrarNote" in b) out.registrarNote = para(b.registrarNote, 1000);

  if (b.registrars && typeof b.registrars === "object") {
    out.registrars = {};
    for (const [id, v] of Object.entries(b.registrars as Record<string, unknown>)) {
      const reg = PILOT_REGISTRARS.find((r) => r.id === id);
      if (!reg || !v || typeof v !== "object") continue;
      const r = v as Record<string, unknown>;
      const next: Partial<RegistrarSetting> = {};
      if ("enabled" in r) next.enabled = r.enabled === true;
      if ("email" in r) {
        const e = line(r.email, 200);
        if (e && !isEmail(e)) problems.push(`${reg.name}: "${e.slice(0, 60)}" doesn't look like an email address.`);
        else next.email = e; // blank = use the address printed on the form
      }
      out.registrars[id] = next;
    }
  }

  if (b.payment && typeof b.payment === "object") {
    const p = b.payment as Record<string, unknown>;
    out.payment = {};
    if ("bank" in p) out.payment.bank = line(p.bank, 80);
    if ("accountName" in p) out.payment.accountName = line(p.accountName, 100);
    if ("accountNumber" in p) {
      const n = String(p.accountNumber ?? "").replace(/\D/g, "");
      if (n && n.length !== 10) problems.push("The account number should be 10 digits.");
      else out.payment.accountNumber = n;
    }
  }
  if ("payAheadPerCompany" in b) {
    const n = Math.round(Number(b.payAheadPerCompany));
    if (!Number.isFinite(n) || n < 0 || n > 100_000) problems.push("The pay-ahead price should be between ₦0 and ₦100,000.");
    else out.payAheadPerCompany = n;
  }
  if ("debitRatePercent" in b) {
    const n = Number(b.debitRatePercent);
    if (!Number.isFinite(n) || n < 0 || n > 50) problems.push("The direct-debit percentage should be between 0 and 50.");
    else out.debitRatePercent = Math.round(n * 100) / 100;
  }
  if (problems.length) throw new Error(problems.join(" "));
  return out;
}

/** Merges a patch onto what's stored. Nested objects merge key by key. */
export function mergeStored(cur: StoredSettings | null, patch: StoredSettings): StoredSettings {
  const next: StoredSettings = { ...(cur ?? {}), ...patch };
  next.registrars = { ...(cur?.registrars ?? {}) };
  for (const [id, v] of Object.entries(patch.registrars ?? {})) next.registrars[id] = { ...(next.registrars[id] ?? {}), ...v };
  next.payment = { ...(cur?.payment ?? {}), ...(patch.payment ?? {}) };
  return next;
}
