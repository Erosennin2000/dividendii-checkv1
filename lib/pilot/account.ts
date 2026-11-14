import "server-only";
import { createHash, createHmac, randomBytes, randomInt, scryptSync, timingSafeEqual } from "node:crypto";
import { isEmail } from "@/lib/domain/validation";
import { DEMO_CODE, leadIdFor, otpMode } from "./leads";
import { pilotEnv, type Mailer } from "./mail";
import { effectiveSettings } from "./settings";
import type { PilotStore } from "./store";
import { clean } from "./text";
import type { PilotLead } from "./types";

/**
 * Shareholder accounts. There is no sign-up: confirming your email in step 1 of the form creates the account and signs
 * you in for a while. To come back later you set a password, using a 6-digit code we email (123456 in demo mode).
 * Passwords are stored as scrypt hashes. Sessions are a signed, httpOnly cookie that only the /check app reads.
 */

export class AccountError extends Error { constructor(message: string, readonly status = 400) { super(message); } }

export const SESSION_COOKIE = "dvd_acct";
const SESSION_DAYS = 7;
/** A session that came from confirming the email in the form, not from a password. Long enough to finish and pay. */
const CODE_SESSION_HOURS = 6;
const CODE_TTL_MS = 15 * 60_000;
const MAX_ATTEMPTS = 5;
export const MIN_PASSWORD = 8;

function secret(): string {
  const s = process.env.PILOT_SECRET?.trim();
  if (s) return s;
  if ((process.env.PILOT_MODE ?? "test") === "live") throw Object.assign(new Error("PILOT_SECRET must be set in live mode."), { code: "config/secret" });
  return "dividendii-check-demo-secret";
}
const b64 = (b: Buffer) => b.toString("base64url");
const mac = (payload: string) => createHmac("sha256", secret()).update("account:" + payload).digest();

export interface Session { leadId: string; version: number; via: "code" | "password"; exp: number }

export function signSession(lead: Pick<PilotLead, "id" | "sessionVersion">, via: Session["via"], now = Date.now()): { value: string; maxAge: number } {
  const maxAge = via === "code" ? CODE_SESSION_HOURS * 3600 : SESSION_DAYS * 86400;
  const payload = b64(Buffer.from(JSON.stringify({ l: lead.id, v: lead.sessionVersion ?? 0, w: via, x: now + maxAge * 1000 })));
  return { value: `${payload}.${b64(mac(payload))}`, maxAge };
}

export function readSession(value: string | undefined | null, now = Date.now()): Session | null {
  if (!value) return null;
  const [payload, sig] = value.split(".");
  if (!payload || !sig) return null;
  try {
    const want = mac(payload), got = Buffer.from(sig, "base64url");
    if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
    const d = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (typeof d.l !== "string" || typeof d.x !== "number" || d.x < now) return null;
    return { leadId: d.l, version: Number(d.v) || 0, via: d.w === "password" ? "password" : "code", exp: d.x };
  } catch { return null; }
}

/** The cookie header. Path /check, so only this app sees it; Lax, so other sites can't post with it. */
export function sessionCookie(value: string, maxAge: number, secure: boolean): string {
  return `${SESSION_COOKIE}=${value}; Path=/check; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}
export const clearCookie = (secure: boolean) => `${SESSION_COOKIE}=; Path=/check; Max-Age=0; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;

export function cookieFrom(req: Request): string | null {
  const raw = req.headers.get("cookie") ?? "";
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === SESSION_COOKIE) return v.join("=");
  }
  return null;
}

/** The signed-in account, or null. A session from before the last password change no longer counts. */
export async function currentAccount(req: Request, store: PilotStore): Promise<{ lead: PilotLead; session: Session } | null> {
  const session = readSession(cookieFrom(req));
  if (!session) return null;
  const lead = await store.getLead(session.leadId);
  if (!lead || (lead.sessionVersion ?? 0) !== session.version) return null;
  return { lead, session };
}

// ---- passwords ----

export function hashPassword(pw: string): string {
  const salt = randomBytes(16);
  const h = scryptSync(pw.normalize("NFKC"), salt, 32, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$${b64(salt)}$${b64(h)}`;
}
export function checkPassword(pw: string, stored: string | null | undefined): boolean {
  if (!stored) return false;
  const [kind, n, salt, h] = stored.split("$");
  if (kind !== "scrypt" || !salt || !h) return false;
  const want = Buffer.from(h, "base64url");
  const got = scryptSync(pw.normalize("NFKC"), Buffer.from(salt, "base64url"), want.length, { N: Number(n) || 16384, r: 8, p: 1 });
  return timingSafeEqual(want, got);
}
export function passwordProblem(pw: unknown): string | null {
  if (typeof pw !== "string" || pw.length < MIN_PASSWORD) return `Use at least ${MIN_PASSWORD} characters.`;
  if (pw.length > 200) return "That password is too long.";
  if (/^\d+$/.test(pw)) return "Use letters as well as numbers.";
  return null;
}
/** Burns roughly the same time as a real check, so a wrong email and a wrong password look the same. */
const DUMMY = hashPassword("not-a-real-password");

// ---- sign in, codes, set password ----

const codeHash = (code: string, leadId: string) => createHash("sha256").update(`${leadId}:${code}`).digest("hex");

/** Email and password. Same answer for an unknown email, a wrong password and an account with no password yet. */
export async function signInWithPassword(email: string, password: string, store: PilotStore, now = new Date()): Promise<PilotLead> {
  const e = clean(email, 160).toLowerCase();
  const lead = isEmail(e) ? await store.getLead(leadIdFor(e)) : null;
  const ok = lead?.passwordHash ? checkPassword(String(password ?? ""), lead.passwordHash) : (checkPassword(String(password ?? ""), DUMMY), false);
  if (!lead || !ok) throw new AccountError("Wrong email or password. First time signing in, or forgot it? Use “Set or reset my password”.", 401);
  const updated = { ...lead, lastSignInAt: now.toISOString() };
  await store.saveLead(updated);
  return updated;
}

/**
 * Sends a 6-digit code to set or reset the password. Only to an email that has confirmed itself in the form before,
 * but the answer is the same either way, so this can't be used to find out who has an account.
 */
export async function sendAccountCode(email: string, deps: { store: PilotStore; mailer: Mailer; now?: () => Date }): Promise<{ demo: boolean }> {
  const now = deps.now?.() ?? new Date();
  const e = clean(email, 160).toLowerCase();
  if (!isEmail(e)) throw new AccountError("Enter the email address you used on the form.");
  const lead = await deps.store.getLead(leadIdFor(e));
  const demo = otpMode() === "demo";
  if (!lead || !lead.verifiedAt) return { demo };
  const code = demo ? DEMO_CODE : String(randomInt(100000, 1000000));
  await deps.store.saveLead({ ...lead, codeHash: codeHash(code, lead.id), codeExpires: new Date(now.getTime() + CODE_TTL_MS).toISOString(), attempts: 0, updatedAt: now.toISOString() });
  if (!demo) {
    const settings = effectiveSettings(await deps.store.getSettings());
    const env = pilotEnv(settings);
    const BRAND = settings.brandName;
    await deps.mailer.send({
      from: env.from, to: lead.email, replyTo: env.replyTo || undefined,
      subject: `Your ${BRAND} code to set your password: ${code}`,
      text: `Hello ${lead.firstName},\n\nYour code to set your ${BRAND} password is ${code}. It works for 15 minutes.\n\nIf you didn't ask for it, ignore this email. Your account is unchanged.\n\n${BRAND}`,
      html: `<div style="font-family:Arial,sans-serif;font-size:15px;color:#17375A"><p>Hello ${lead.firstName.replace(/[<>&]/g, "")},</p><p>Your code to set your ${BRAND} password is</p><p style="font-size:28px;font-weight:700;letter-spacing:4px">${code}</p><p>It works for 15 minutes. If you didn't ask for it, ignore this email. Your account is unchanged.</p><p>${BRAND}</p></div>`,
    });
  }
  return { demo };
}

/**
 * Sets the password. Either with the emailed code, or (no code) straight after confirming the email in the form,
 * when the account has no password yet. Every other session is signed out.
 */
export async function setPassword(
  input: { email?: string; code?: string; password: string; session?: Session | null },
  store: PilotStore, now = new Date(),
): Promise<PilotLead> {
  const problem = passwordProblem(input.password);
  let lead: PilotLead | null = null;
  if (input.code) {
    const e = clean(input.email, 160).toLowerCase();
    lead = isEmail(e) ? await store.getLead(leadIdFor(e)) : null;
    if (!lead || !lead.codeHash) throw new AccountError("That code isn't right, or has been used. Ask for a new one.");
    if (lead.attempts >= MAX_ATTEMPTS) throw new AccountError("Too many wrong codes. Ask for a new one.");
    if (!lead.codeExpires || new Date(lead.codeExpires) < now) throw new AccountError("That code has expired. Ask for a new one.");
    if (codeHash(clean(input.code, 12), lead.id) !== lead.codeHash) {
      await store.saveLead({ ...lead, attempts: lead.attempts + 1, updatedAt: now.toISOString() });
      throw new AccountError("That code isn't right. Check it and try again.");
    }
  } else {
    if (!input.session) throw new AccountError("Enter the code we emailed you.", 401);
    lead = await store.getLead(input.session.leadId);
    if (!lead) throw new AccountError("Sign in again.", 401);
    if (lead.passwordHash) throw new AccountError("You already have a password. To change it, use “Set or reset my password” with a code.");
  }
  if (problem) throw new AccountError(problem);
  const updated: PilotLead = {
    ...lead, passwordHash: hashPassword(input.password), passwordSetAt: now.toISOString(),
    sessionVersion: (lead.sessionVersion ?? 0) + 1, lastSignInAt: now.toISOString(),
    codeHash: null, codeExpires: null, attempts: 0, verifiedAt: lead.verifiedAt ?? now.toISOString(), updatedAt: now.toISOString(),
  };
  await store.saveLead(updated);
  return updated;
}

/** Is this request from our own site? Account changes refuse other origins. */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true; // same-origin GETs and older browsers send none; the Lax cookie still protects us
  try {
    const o = new URL(origin).hostname;
    const host = (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "").split(":")[0];
    return o === host || o === "localhost" || o === "127.0.0.1" || o === "dividendii.com" || o.endsWith(".dividendii.com");
  } catch { return false; }
}
