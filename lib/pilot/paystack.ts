import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Paystack, server side only. One switch: PAYSTACK_SECRET_KEY.
 *   not set        payments are off (forms send as before, fees are collected by hand)
 *   sk_test_...    test payments: test cards work, no real money moves
 *   sk_live_...    real payments
 * The secret key never leaves the server. https://paystack.com/docs/api/
 */
const API = (process.env.PAYSTACK_API_URL ?? "").trim() || "https://api.paystack.co"; // the override is for local rehearsals only

export const paystackKey = (env: NodeJS.ProcessEnv = process.env) => (env.PAYSTACK_SECRET_KEY ?? "").trim();
export const paystackOn = (env: NodeJS.ProcessEnv = process.env) => paystackKey(env).length > 0;
export const paystackMode = (env: NodeJS.ProcessEnv = process.env): "off" | "test" | "live" =>
  !paystackOn(env) ? "off" : paystackKey(env).startsWith("sk_live_") ? "live" : "test";

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
let fetchOverride: Fetch | null = null;
/** Tests swap the network out. */
export const setPaystackFetchForTests = (f: Fetch | null) => { fetchOverride = f; };

export class PaystackError extends Error {}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const key = paystackKey();
  if (!key) throw new PaystackError("Online payment is not set up yet.");
  const res = await (fetchOverride ?? fetch)(API + path, {
    ...init,
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  const body = (await res.json().catch(() => null)) as { status?: boolean; message?: string; data?: T } | null;
  if (!res.ok || !body?.status || !body.data) throw new PaystackError(body?.message || `Paystack replied ${res.status}.`);
  return body.data;
}

export interface InitInput {
  email: string;
  /** In kobo. ₦161.25 is 16125. */
  amountKobo: number;
  reference: string;
  callbackUrl: string;
  metadata: Record<string, string | number>;
}

/** Starts a payment. The customer is sent to authorizationUrl to pay on Paystack's page. */
export async function initializePayment(i: InitInput): Promise<{ authorizationUrl: string; reference: string }> {
  const d = await call<{ authorization_url: string; reference: string }>("/transaction/initialize", {
    method: "POST",
    body: JSON.stringify({ email: i.email, amount: i.amountKobo, currency: "NGN", reference: i.reference, callback_url: i.callbackUrl, metadata: i.metadata }),
  });
  return { authorizationUrl: d.authorization_url, reference: d.reference };
}

export interface Verified {
  id: number;
  /** "success", "failed", "abandoned", "pending" ... */
  status: string;
  reference: string;
  amountKobo: number;
  currency: string;
  channel: string;
  paidAt: string | null;
  /** "test" or "live": which Paystack mode took the money. */
  domain: string;
  metadata: Record<string, unknown>;
}

/** Asks Paystack what really happened to a payment. This, not the browser coming back, is the proof. */
export async function verifyPayment(reference: string): Promise<Verified> {
  const d = await call<{ id: number; status: string; reference: string; amount: number; currency: string; channel: string; paid_at: string | null; domain: string; metadata: unknown }>(
    `/transaction/verify/${encodeURIComponent(reference)}`,
  );
  let meta: Record<string, unknown> = {};
  if (d.metadata && typeof d.metadata === "object") meta = d.metadata as Record<string, unknown>;
  else if (typeof d.metadata === "string") { try { meta = JSON.parse(d.metadata); } catch { /* none */ } }
  return { id: d.id, status: d.status, reference: d.reference, amountKobo: d.amount, currency: d.currency, channel: d.channel, paidAt: d.paid_at, domain: d.domain, metadata: meta };
}

/** Webhooks carry x-paystack-signature: HMAC SHA512 of the raw body, signed with the secret key. */
export function validWebhookSignature(rawBody: string, header: string | null): boolean {
  const key = paystackKey();
  if (!key || !header) return false;
  const want = Buffer.from(createHmac("sha512", key).update(rawBody).digest("hex"));
  const got = Buffer.from(header.trim().toLowerCase());
  return want.length === got.length && timingSafeEqual(want, got);
}

// ---------- bank account name lookup (free on a live key)
export class PaystackReply extends PaystackError {
  constructor(message: string, readonly status?: number) { super(message); }
}
export interface PaystackBank { name: string; code: string }

type RawReply = { status?: boolean; message?: string; data?: unknown; meta?: { next?: string | null } } | null;
async function get(path: string): Promise<{ httpStatus: number; body: RawReply }> {
  const key = paystackKey();
  if (!key) throw new PaystackError("Paystack is not set up.");
  const res = await (fetchOverride ?? fetch)(API + path, { headers: { authorization: `Bearer ${key}` }, cache: "no-store" });
  return { httpStatus: res.status, body: (await res.json().catch(() => null)) as RawReply };
}

let banksCache: { at: number; list: PaystackBank[] } | null = null;
export const clearPaystackBankCache = () => { banksCache = null; };

/** Paystack's own list of Nigerian banks and their codes. Cached for 12 hours. Codes are never typed in by hand. */
export async function paystackBanks(): Promise<PaystackBank[]> {
  if (banksCache && Date.now() - banksCache.at < 12 * 3600_000) return banksCache.list;
  const out: PaystackBank[] = [];
  const seen = new Set<string>();
  let next = "";
  for (let page = 0; page < 8; page++) {
    const { httpStatus, body } = await get(`/bank?country=nigeria&currency=NGN&use_cursor=true&perPage=100${next ? `&next=${encodeURIComponent(next)}` : ""}`);
    if (httpStatus < 200 || httpStatus >= 300 || !body?.status || !Array.isArray(body.data)) throw new PaystackReply(body?.message || `Paystack replied ${httpStatus}.`, httpStatus);
    for (const b of body.data as { name?: unknown; code?: unknown; active?: unknown }[]) {
      if (!b?.name || !b?.code || b.active === false) continue;
      const k = `${b.name}|${b.code}`;
      if (!seen.has(k)) { seen.add(k); out.push({ name: String(b.name), code: String(b.code) }); }
    }
    next = body.meta?.next ?? "";
    if (!next) break;
  }
  if (!out.length) throw new PaystackReply("Paystack sent back an empty bank list.");
  banksCache = { at: Date.now(), list: out };
  return out;
}

export interface PaystackResolve { httpStatus: number; message: string; name?: string }

/** Asks the bank, through Paystack, whose account this is. Never throws on a plain "no": the reply carries the status and Paystack's words. */
export async function paystackResolve(bankCode: string, accountNumber: string): Promise<PaystackResolve> {
  const { httpStatus, body } = await get(`/bank/resolve?account_number=${encodeURIComponent(accountNumber)}&bank_code=${encodeURIComponent(bankCode)}`);
  const d = (body?.data ?? {}) as { account_name?: unknown };
  const name = typeof d.account_name === "string" ? d.account_name.trim() : "";
  const message = (body?.message || `Paystack replied ${httpStatus}.`).slice(0, 200);
  return { httpStatus, message, name: httpStatus === 200 && body?.status && name ? name : undefined };
}
