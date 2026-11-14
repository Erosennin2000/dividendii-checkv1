import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { pilotEnv } from "./mail";

/**
 * A short-lived proof that someone confirmed their email. Signed with PILOT_SECRET, so the submit route
 * can trust it without a sign-in system. Format: base64url(payload) + "." + base64url(hmac).
 */
const TTL_MS = 3 * 60 * 60_000;

function secret(): string {
  const s = process.env.PILOT_SECRET?.trim();
  if (s) return s;
  if (pilotEnv().mode === "live") throw Object.assign(new Error("PILOT_SECRET must be set in live mode."), { code: "config/secret" });
  return "dividendii-check-demo-secret"; // test mode only
}

const b64 = (b: Buffer) => b.toString("base64url");
const mac = (payload: string) => createHmac("sha256", secret()).update(payload).digest();

export function signToken(leadId: string, email: string, now = Date.now()): string {
  const payload = b64(Buffer.from(JSON.stringify({ l: leadId, e: email, x: now + TTL_MS })));
  return `${payload}.${b64(mac(payload))}`;
}

/** Returns the lead id and email if the token is genuine and fresh, otherwise null. */
export function verifyToken(token: unknown, now = Date.now()): { leadId: string; email: string } | null {
  if (typeof token !== "string") return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  try {
    const want = mac(payload), got = Buffer.from(sig, "base64url");
    if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
    const d = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (typeof d.x !== "number" || d.x < now || typeof d.l !== "string" || typeof d.e !== "string") return null;
    return { leadId: d.l, email: d.e };
  } catch {
    return null;
  }
}

/**
 * A link key for one submission, for the pay-by-link pages we email out. It proves the link came from us.
 * No expiry: a payment reminder should still open weeks later. It only lets the holder pay, nothing else.
 */
export function signLink(submissionId: string): string {
  return b64(createHmac("sha256", secret()).update("pay-link:" + submissionId).digest()).slice(0, 32);
}
export function validLink(submissionId: unknown, key: unknown): boolean {
  if (typeof submissionId !== "string" || typeof key !== "string" || !submissionId || !key) return false;
  const want = Buffer.from(signLink(submissionId)), got = Buffer.from(key);
  return want.length === got.length && timingSafeEqual(want, got);
}
