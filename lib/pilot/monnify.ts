import "server-only";

/**
 * Monnify, server side only. Used for two things:
 *   1. Account name lookup (free): "the bank shows this account as ..." on step 3.
 *   2. BVN and account name match (₦10 per successful check): run once per submission, after the start fee is paid.
 * Neither ever blocks a customer. If Monnify is off, the wallet is empty or the call fails, the result is "unchecked".
 *
 * Env (set in Vercel, never in code):
 *   MONNIFY_API_KEY, MONNIFY_SECRET_KEY   both needed to switch it on
 *   MONNIFY_CONTRACT_CODE                 kept for later; these two checks do not use it
 *   MONNIFY_BASE_URL                      optional. Default is live. https://sandbox.monnify.com for sandbox keys.
 * Monnify's BVN checks work on the LIVE environment only; sandbox can do account name lookups.
 * Docs: https://developers.monnify.com/api
 */
const LIVE = "https://api.monnify.com";

export const monnifyOn = (env: NodeJS.ProcessEnv = process.env) => !!(env.MONNIFY_API_KEY ?? "").trim() && !!(env.MONNIFY_SECRET_KEY ?? "").trim();
export const monnifyBase = (env: NodeJS.ProcessEnv = process.env) => ((env.MONNIFY_BASE_URL ?? "").trim().replace(/\/+$/, "")) || LIVE;
export const monnifyMode = (env: NodeJS.ProcessEnv = process.env): "off" | "sandbox" | "live" =>
  !monnifyOn(env) ? "off" : /sandbox/i.test(monnifyBase(env)) ? "sandbox" : "live";

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
let fetchOverride: Fetch | null = null;
/** Tests swap the network out. */
export const setMonnifyFetchForTests = (f: Fetch | null) => { fetchOverride = f; token = null; banksCache = null; };

export class MonnifyError extends Error {
  constructor(message: string, readonly code?: string) { super(message); }
}

let token: { value: string; until: number } | null = null;

async function login(): Promise<string> {
  if (token && token.until > Date.now()) return token.value;
  const basic = Buffer.from(`${(process.env.MONNIFY_API_KEY ?? "").trim()}:${(process.env.MONNIFY_SECRET_KEY ?? "").trim()}`).toString("base64");
  const res = await (fetchOverride ?? fetch)(monnifyBase() + "/api/v1/auth/login", { method: "POST", headers: { authorization: `Basic ${basic}` }, cache: "no-store" });
  const body = (await res.json().catch(() => null)) as { requestSuccessful?: boolean; responseMessage?: string; responseBody?: { accessToken?: string; expiresIn?: number } } | null;
  const t = body?.responseBody?.accessToken;
  if (!res.ok || !body?.requestSuccessful || !t) throw new MonnifyError(body?.responseMessage || `Monnify sign-in replied ${res.status}.`);
  token = { value: t, until: Date.now() + Math.max(60, (body.responseBody?.expiresIn ?? 600) - 60) * 1000 };
  return t;
}

async function call<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  if (!monnifyOn()) throw new MonnifyError("Monnify is not set up.");
  const t = await login();
  const res = await (fetchOverride ?? fetch)(monnifyBase() + path, {
    ...init,
    headers: { authorization: `Bearer ${t}`, ...(init.body ? { "content-type": "application/json" } : {}) },
    cache: "no-store",
  });
  if (res.status === 401 && retry) { token = null; return call<T>(path, init, false); }
  const body = (await res.json().catch(() => null)) as { requestSuccessful?: boolean; responseMessage?: string; responseCode?: string; responseBody?: T } | null;
  if (!res.ok || !body?.requestSuccessful || body.responseBody === undefined) throw new MonnifyError(body?.responseMessage || `Monnify replied ${res.status}.`, body?.responseCode);
  return body.responseBody;
}

// ---------- bank codes
export interface MonnifyBank { name: string; code: string }
let banksCache: { at: number; list: MonnifyBank[] } | null = null;

export async function monnifyBanks(): Promise<MonnifyBank[]> {
  if (banksCache && Date.now() - banksCache.at < 12 * 3600_000) return banksCache.list;
  const list = (await call<MonnifyBank[]>("/api/v1/banks")).filter((b) => b?.name && b?.code);
  banksCache = { at: Date.now(), list };
  return list;
}

const STOP = /\b(plc|limited|ltd|nigeria|nig|of|the|for|and|bank|mfb|microfinance)\b/g;
const norm = (s: string) => s.toLowerCase().replace(/&/g, " and ").replace(STOP, " ").replace(/[^a-z0-9]+/g, " ").trim();
const ALIASES: Record<string, string[]> = {
  "guaranty trust": ["gtbank", "gtb", "guaranty trust holding", "gt"],
  "united africa": ["uba"],
  "first city monument": ["fcmb"],
  "first": ["first bank", "firstbank"],
  "stanbic ibtc": ["stanbic"],
  "polaris": ["skye"],
  "wema": ["alat"],
};

/** Match a bank name as our form writes it to Monnify's list. Returns null when not sure, so a lookup is simply skipped. */
export function bankCodeFor(name: string, banks: MonnifyBank[]): string | null {
  const paren = /\(([^)]+)\)/.exec(name)?.[1] ?? "";
  const main = norm(name.replace(/\([^)]*\)/g, " "));
  const keys = [...new Set([main, norm(paren), ...(ALIASES[main] ?? []).map(norm)].filter((k) => k.length >= 2))];
  const prepared = banks.map((b) => ({ b, n: norm(b.name) }));
  for (const k of keys) { const hit = prepared.find((p) => p.n === k); if (hit) return hit.b.code; }
  const loose = prepared.filter((p) => keys.some((k) => k.length >= 5 && (p.n.includes(k) || (p.n.length >= 5 && k.includes(p.n)))));
  return loose.length === 1 ? loose[0].b.code : null;
}

/** For the staff diagnostics: which of our listed banks could not be matched. */
export function unmatchedBanks(ours: string[], banks: MonnifyBank[]) {
  return ours.filter((n) => !bankCodeFor(n, banks));
}

// ---------- 1. account name lookup (free)
export async function lookupAccountName(bankName: string, accountNumber: string): Promise<string | null> {
  if (!/^\d{10}$/.test(accountNumber)) return null;
  const code = bankCodeFor(bankName, await monnifyBanks());
  if (!code) return null;
  const r = await call<{ accountName?: string }>(`/api/v1/disbursements/account/validate?accountNumber=${accountNumber}&bankCode=${encodeURIComponent(code)}`);
  return r.accountName?.trim() || null;
}

// ---------- 2. BVN and account name match (₦10)
export type BvnStatus = "match" | "partial" | "no_match" | "unchecked";
export interface BvnCheck { status: BvnStatus; percent?: number; checkedAt: string; note?: string }

export async function matchBvn(bvn: string, bankName: string, accountNumber: string): Promise<BvnCheck> {
  const checkedAt = new Date().toISOString();
  try {
    if (!monnifyOn()) return { status: "unchecked", checkedAt, note: "Monnify is not switched on." };
    if (!/^\d{11}$/.test(bvn) || !/^\d{10}$/.test(accountNumber)) return { status: "unchecked", checkedAt, note: "BVN or account number is not the right length." };
    const code = bankCodeFor(bankName, await monnifyBanks());
    if (!code) return { status: "unchecked", checkedAt, note: `Couldn't match the bank name "${bankName}" to Monnify's list.` };
    const r = await call<{ matchStatus?: string; matchPercentage?: number }>("/api/v1/vas/bvn-account-match", { method: "POST", body: JSON.stringify({ bankCode: code, accountNumber, bvn }) });
    const s = (r.matchStatus ?? "").toUpperCase();
    const status: BvnStatus = s === "FULL_MATCH" ? "match" : s === "PARTIAL_MATCH" ? "partial" : s === "NO_MATCH" ? "no_match" : "unchecked";
    return { status, percent: typeof r.matchPercentage === "number" ? r.matchPercentage : undefined, checkedAt, note: status === "unchecked" ? `Unexpected answer: ${s || "none"}` : undefined };
  } catch (e) {
    return { status: "unchecked", checkedAt, note: (e instanceof Error ? e.message : "Check failed").slice(0, 160) };
  }
}
