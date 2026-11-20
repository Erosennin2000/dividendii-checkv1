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
  constructor(message: string, readonly code?: string, readonly status?: number) { super(message); }
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
  if (!res.ok || !body?.requestSuccessful || body.responseBody === undefined) throw new MonnifyError(body?.responseMessage || `Monnify replied ${res.status}.`, body?.responseCode, res.status);
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
/** Extra filler words, dropped only on the looser pass. */
const FILLER = /\b(digital|services?|payment|psb|merchant|financials?|finance|holdings?|group|company|co|mortgage)\b/g;
const norm = (s: string) => s.toLowerCase().replace(/&/g, " and ").replace(STOP, " ").replace(/[^a-z0-9]+/g, " ").trim();
const closed = (s: string) => s.replace(/\s+/g, "");
const core = (s: string) => norm(s).replace(FILLER, " ").replace(/\s+/g, " ").trim();

/**
 * Other names a bank goes by. The key is our listed name after norm(); each value is another way Monnify may write it.
 * These only widen what we look for in Monnify's own list. A code is never typed in by hand.
 */
const ALIASES: Record<string, string[]> = {
  "guaranty trust": ["gtbank", "gtb", "guaranty trust holding", "gt"],
  "united africa": ["uba"],
  "first city monument": ["fcmb"],
  "first": ["first bank", "firstbank"],
  "stanbic ibtc": ["stanbic"],
  "polaris": ["skye"],
  "wema": ["alat"],
  "alat by wema": ["wema", "alat"],
  "9psb 9 payment service": ["9 payment service", "9payment service", "9mobile 9payment service", "9 psb", "9psb", "9mobile psb"],
  "opay digital services": ["opay", "opay digital", "paycom"],
  "hope psb": ["hopepsb", "hope payment service", "hope"],
  "momo psb": ["momo payment service", "mtn momo"],
  "smartcash psb": ["smartcash payment service", "smartcash"],
  "titan trust": ["titan"],
  "fsdh merchant": ["fsdh"],
};

export type BankMatch = { code: string; name: string; confidence: "exact" | "fuzzy" };

/**
 * Find our bank name in Monnify's list. "exact" means same name (spacing, case, filler words and our known aliases ignored).
 * "fuzzy" means a looser single match: good enough to ask the bank, never good enough to say an account does not exist.
 * Returns null when not sure.
 */
export function matchBank(name: string, banks: MonnifyBank[]): BankMatch | null {
  const paren = /\(([^)]+)\)/.exec(name)?.[1] ?? "";
  const main = norm(name.replace(/\([^)]*\)/g, " "));
  const aliasKeys = [...(ALIASES[main] ?? []), ...(ALIASES[norm(name)] ?? [])];
  const curated = [...new Set([main, norm(paren), ...aliasKeys.map(norm)].filter((k) => k.length >= 2))];
  const prepared = banks.map((b) => ({ b, n: norm(b.name), c: core(b.name) }));
  const hit = (p: { b: MonnifyBank }, confidence: BankMatch["confidence"]): BankMatch => ({ code: p.b.code, name: p.b.name, confidence });

  // 1. Same name, then same name ignoring spaces ("Mint Finex" and "MintFinex").
  for (const k of curated) { const h = prepared.find((p) => p.n === k); if (h) return hit(h, "exact"); }
  for (const k of curated) { const kc = closed(k); if (kc.length < 3) continue; const h = prepared.filter((p) => closed(p.n) === kc); if (h.length === 1) return hit(h[0], "exact"); }
  // 2. Same name once filler words ("digital", "services", "PSB" ...) are dropped on both sides. Only when one bank fits.
  const cores = [...new Set(curated.map(core).filter((k) => closed(k).length >= 4))];
  for (const k of cores) { const h = prepared.filter((p) => closed(p.c) === closed(k)); if (h.length === 1) return hit(h[0], "fuzzy"); }
  // 3. One name contains the other. Only when one bank fits.
  const loose = prepared.filter((p) => curated.some((k) => k.length >= 5 && (p.n.includes(k) || (p.n.length >= 5 && k.includes(p.n)))));
  return loose.length === 1 ? hit(loose[0], "fuzzy") : null;
}

/** Just the code, for callers that do not care how sure we are. */
export function bankCodeFor(name: string, banks: MonnifyBank[]): string | null {
  return matchBank(name, banks)?.code ?? null;
}

/** For the staff diagnostics: which of our listed banks could not be matched. */
export function unmatchedBanks(ours: string[], banks: MonnifyBank[]) {
  return ours.filter((n) => !matchBank(n, banks));
}

const grams = (s: string) => { const t = closed(s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()); const out = new Map<string, number>(); for (let i = 0; i < t.length - 1; i++) { const g = t.slice(i, i + 2); out.set(g, (out.get(g) ?? 0) + 1); } return out; };
function dice(a: string, b: string): number {
  const x = grams(a), y = grams(b);
  let n = 0, tx = 0, ty = 0;
  for (const [g, c] of x) { tx += c; n += Math.min(c, y.get(g) ?? 0); }
  for (const c of y.values()) ty += c;
  return tx + ty === 0 ? 0 : (2 * n) / (tx + ty);
}

/** The closest names in Monnify's list to one of ours, so staff can see whether a bank is missing or just spelled differently. */
export function suggestBanks(name: string, banks: MonnifyBank[], n = 3): { name: string; code: string }[] {
  const plain = name.replace(/\([^)]*\)/g, " ");
  return banks
    .map((b) => ({ b, score: Math.max(dice(plain, b.name), dice(core(name), core(b.name))) }))
    .filter((x) => x.score >= 0.4)
    .sort((a, b) => b.score - a.score)
    .slice(0, n)
    .map((x) => ({ name: x.b.name, code: x.b.code }));
}

// ---------- 1. account name lookup (free)
export type AccountLookup = { status: "found"; name: string } | { status: "not_found" } | { status: "unavailable" };

/** Words in a reply that mean "we could not ask", not "there is no such account". */
const NOT_ABOUT_THE_ACCOUNT = /bank ?code|invalid bank|unsupported|whitelist|\bip\b|credential|unauthori[sz]ed|authenticat|api ?key|permission|access denied|rate limit|too many|balance|wallet|contract/i;
/** Words that say the account itself does not exist. */
const NO_SUCH_ACCOUNT = /(invalid|incorrect|unknown|unable to (resolve|verify|validate)|could not (resolve|verify|validate)|no such|does ?n[o']t exist|not found).{0,40}account|account.{0,40}(invalid|incorrect|not found|unknown|does ?n[o']t exist|unable|could not|not valid)/i;

export interface LookupDetail {
  verdict: AccountLookup["status"];
  name?: string;
  bankMatch: BankMatch | null;
  httpStatus?: number;
  monnifyMessage?: string;
  /** Plain-words reason, for staff. */
  note: string;
}

/**
 * The one place that decides what a lookup means, so the staff "try one account" box shows exactly what a customer would get.
 * "found": the bank gave us a name. "not_found": Monnify says there is no such account, and we are sure we asked the right bank on a live key.
 * "unavailable": anything else (off, bank not matched, sandbox, sign-in or network trouble, rate limit): we cannot tell, so callers must not block.
 */
async function lookupCore(bankName: string, accountNumber: string): Promise<LookupDetail> {
  if (!/^\d{10}$/.test(accountNumber)) return { verdict: "unavailable", bankMatch: null, note: "The account number is not 10 digits." };
  let match: BankMatch | null = null;
  try {
    match = matchBank(bankName, await monnifyBanks());
    if (!match) return { verdict: "unavailable", bankMatch: null, note: `"${bankName}" is not in Monnify's bank list under this name, so no lookup was made.` };
    const r = await call<{ accountName?: string }>(`/api/v1/disbursements/account/validate?accountNumber=${accountNumber}&bankCode=${encodeURIComponent(match.code)}`);
    const name = r.accountName?.trim();
    if (name) return { verdict: "found", name, bankMatch: match, httpStatus: 200, monnifyMessage: "success", note: "Monnify gave a name." };
    return { verdict: "unavailable", bankMatch: match, httpStatus: 200, note: "Monnify answered without a name, so we cannot tell." };
  } catch (e) {
    if (!(e instanceof MonnifyError)) return { verdict: "unavailable", bankMatch: match, note: "Could not reach Monnify." };
    const base = { bankMatch: match, httpStatus: e.status, monnifyMessage: e.message };
    const sayNoSuchAccount = (e.status === 400 || e.status === 404 || e.status === 422) && NO_SUCH_ACCOUNT.test(e.message) && !NOT_ABOUT_THE_ACCOUNT.test(e.message);
    if (!sayNoSuchAccount) return { verdict: "unavailable", ...base, note: "Monnify's reply was not a plain \"no such account\", so nothing is blocked." };
    if (monnifyMode() === "sandbox") return { verdict: "unavailable", ...base, note: "Sandbox is a pretend bank and cannot say real accounts do not exist, so nothing is blocked." };
    if (match?.confidence !== "exact") return { verdict: "unavailable", ...base, note: "The bank name was only a close match, so we cannot be sure we asked the right bank. Nothing is blocked." };
    return { verdict: "not_found", ...base, note: "Monnify says there is no such account at this bank. This is the only answer that stops step 3." };
  }
}

export async function lookupAccountName(bankName: string, accountNumber: string): Promise<AccountLookup> {
  const r = await lookupCore(bankName, accountNumber);
  if (r.verdict === "found" && r.name) return { status: "found", name: r.name };
  if (r.verdict === "not_found") return { status: "not_found" };
  return { status: "unavailable" };
}

/** Staff only. One lookup with everything Monnify said, for diagnosing a bank that will not match. Free. Never throws. */
export async function rawAccountLookup(bankName: string, accountNumber: string): Promise<LookupDetail & { mode: "off" | "sandbox" | "live"; base: string }> {
  const mode = monnifyMode(), base = monnifyBase();
  if (!monnifyOn()) return { verdict: "unavailable", bankMatch: null, note: "Monnify keys are not set.", mode, base };
  try { return { ...(await lookupCore(bankName, accountNumber)), mode, base }; }
  catch (e) { return { verdict: "unavailable", bankMatch: null, note: e instanceof Error ? e.message.slice(0, 200) : "Failed.", mode, base }; }
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
