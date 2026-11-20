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

export class PaystackError extends Error { constructor(message: string, readonly status = 0) { super(message); } }

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const key = paystackKey();
  if (!key) throw new PaystackError("Online payment is not set up yet.", 0);
  const res = await (fetchOverride ?? fetch)(API + path, {
    ...init,
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  const body = (await res.json().catch(() => null)) as { status?: boolean; message?: string; data?: T } | null;
  if (!res.ok || !body?.status || !body.data) throw new PaystackError(body?.message || `Paystack replied ${res.status}.`, res.status);
  return body.data;
}

// ---------- bank list and free account-name lookup (Nigeria: Resolve Account Number is free on Paystack)
export interface PaystackBank { name: string; code: string }
let banksCache: { at: number; list: PaystackBank[] } | null = null;
export const clearPaystackBanksForTests = () => { banksCache = null; };

/** Paystack's Nigerian bank list (cached six hours). Pages of 100 until a short page. */
export async function paystackBanks(): Promise<PaystackBank[]> {
  if (banksCache && Date.now() - banksCache.at < 6 * 3600_000) return banksCache.list;
  const all: PaystackBank[] = [];
  for (let page = 1; page <= 6; page++) {
    const d = await call<{ name: string; code: string; active?: boolean; currency?: string }[]>(`/bank?country=nigeria&perPage=100&page=${page}`);
    all.push(...d.filter((b) => b.name && b.code && b.active !== false && (!b.currency || b.currency === "NGN")).map((b) => ({ name: b.name, code: b.code })));
    if (d.length < 100) break;
  }
  if (all.length) banksCache = { at: Date.now(), list: all };
  return all;
}

/** Throws PaystackError (with the HTTP status) when Paystack can't give a name. */
export async function resolveAccount(bankCode: string, accountNumber: string): Promise<string | null> {
  const d = await call<{ account_name?: string }>(`/bank/resolve?account_number=${encodeURIComponent(accountNumber)}&bank_code=${encodeURIComponent(bankCode)}`);
  return d.account_name?.trim() || null;
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
