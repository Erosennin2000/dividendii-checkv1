import "server-only";
import { matchBank, monnifyBanks, monnifyMode, monnifyOn, rawAccountLookup, suggestBanks, unmatchedBanks, monnifyBase, type AccountLookup, type BankMatch } from "./monnify";
import { PaystackReply, paystackBanks, paystackMode, paystackOn, paystackResolve } from "./paystack";
import { BANK_GROUPS } from "./banks";

/**
 * Which service looks up "the bank shows this account as ...". Paystack by default, because its key is already live.
 * Set ACCOUNT_LOOKUP=monnify in Vercel to switch back to Monnify. Monnify still does the BVN check either way.
 * With nothing set, Paystack is used if its key exists, otherwise Monnify if its keys exist, otherwise no lookup.
 *
 * Paystack can say "found" but its "could not resolve" also happens when a bank is slow, so Paystack never says "no such account".
 * Only Monnify can stop step 3 (see monnify.ts). A failed or empty Paystack answer always lets the customer carry on.
 */
export type LookupProvider = "paystack" | "monnify" | "off";

export function lookupProvider(env: NodeJS.ProcessEnv = process.env): LookupProvider {
  const want = (env.ACCOUNT_LOOKUP ?? "").trim().toLowerCase();
  if (want === "monnify") return monnifyOn(env) ? "monnify" : "off";
  if (want === "paystack") return paystackOn(env) ? "paystack" : "off";
  return paystackOn(env) ? "paystack" : monnifyOn(env) ? "monnify" : "off";
}
export const accountLookupOn = (env: NodeJS.ProcessEnv = process.env) => lookupProvider(env) !== "off";
/** "off" | "test"/"sandbox" | "live" for whichever service does the lookup. */
export function lookupMode(env: NodeJS.ProcessEnv = process.env): "off" | "test" | "live" {
  const p = lookupProvider(env);
  if (p === "paystack") return paystackMode(env) === "live" ? "live" : "test";
  if (p === "monnify") return monnifyMode(env) === "live" ? "live" : "test";
  return "off";
}

export interface LookupDetail {
  provider: LookupProvider;
  verdict: AccountLookup["status"];
  name?: string;
  bankMatch: BankMatch | null;
  httpStatus?: number;
  providerMessage?: string;
  note: string;
  mode: "off" | "test" | "live";
  base: string;
}

const PAYSTACK_BASE = "https://api.paystack.co";
const COULD_NOT_RESOLVE = /could not resolve|unable to resolve|invalid (account|nuban)|account (number )?(is )?(invalid|not found)/i;

async function viaPaystack(bankName: string, accountNumber: string): Promise<LookupDetail> {
  const mode = lookupMode();
  const base = { provider: "paystack" as const, mode, base: PAYSTACK_BASE };
  if (!/^\d{10}$/.test(accountNumber)) return { ...base, verdict: "unavailable", bankMatch: null, note: "The account number is not 10 digits." };
  let match: BankMatch | null = null;
  try {
    match = matchBank(bankName, await paystackBanks());
    if (!match) return { ...base, verdict: "unavailable", bankMatch: null, note: `"${bankName}" is not in Paystack's bank list under this name, so no lookup was made.` };
    const r = await paystackResolve(match.code, accountNumber);
    if (r.name) return { ...base, verdict: "found", name: r.name, bankMatch: match, httpStatus: r.httpStatus, providerMessage: r.message, note: "Paystack gave a name." };
    // A clear "could not resolve" on a live key for a bank we matched exactly: warn the customer to double-check, but never stop them.
    if (r.httpStatus === 422 && COULD_NOT_RESOLVE.test(r.message) && match.confidence === "exact" && mode === "live") {
      return { ...base, verdict: "unconfirmed", bankMatch: match, httpStatus: r.httpStatus, providerMessage: r.message, note: "Paystack could not resolve this account. It says that for a wrong number, but also when a bank is slow, so the customer is only warned to double-check. Nothing is blocked." };
    }
    const why =
      r.httpStatus === 422 ? "Paystack could not resolve this account. It says that for a wrong number, but also when a bank is slow, so nothing is blocked."
      : r.httpStatus === 401 ? "Paystack did not accept the key. Check PAYSTACK_SECRET_KEY in Vercel."
      : r.httpStatus === 403 ? "Paystack refused the request. If you added an IP address under Developers, API configuration, remove it: Vercel's addresses change, so a list there blocks us."
      : r.httpStatus === 429 ? "Paystack says too many lookups too fast. Nothing is blocked."
      : mode !== "live" ? "This is a Paystack test key. Test mode cannot look up real accounts. Nothing is blocked."
      : "Paystack's reply was not a name, so nothing is blocked.";
    return { ...base, verdict: "unavailable", bankMatch: match, httpStatus: r.httpStatus, providerMessage: r.message, note: why };
  } catch (e) {
    if (e instanceof PaystackReply) return { ...base, verdict: "unavailable", bankMatch: match, httpStatus: e.status, providerMessage: e.message, note: "Paystack did not answer the bank list or lookup properly. Nothing is blocked." };
    return { ...base, verdict: "unavailable", bankMatch: match, note: "Could not reach Paystack." };
  }
}

/** Staff and customers both go through this, so the "try one account" box shows exactly what a customer would get. Never throws. */
export async function lookupDetail(bankName: string, accountNumber: string): Promise<LookupDetail> {
  const provider = lookupProvider();
  if (provider === "off") return { provider, verdict: "unavailable", bankMatch: null, note: "No bank lookup is switched on. Set PAYSTACK_SECRET_KEY (or the Monnify keys) in Vercel.", mode: "off", base: "" };
  if (provider === "paystack") return viaPaystack(bankName, accountNumber);
  const r = await rawAccountLookup(bankName, accountNumber);
  return { provider, verdict: r.verdict, name: r.name, bankMatch: r.bankMatch, httpStatus: r.httpStatus, providerMessage: r.monnifyMessage, note: r.note, mode: r.mode === "live" ? "live" : r.mode === "off" ? "off" : "test", base: r.base };
}

export async function lookupAccountName(bankName: string, accountNumber: string): Promise<AccountLookup> {
  const r = await lookupDetail(bankName, accountNumber);
  if (r.verdict === "found" && r.name) return { status: "found", name: r.name };
  if (r.verdict === "not_found") return { status: "not_found" };
  if (r.verdict === "unconfirmed") return { status: "unconfirmed" };
  return { status: "unavailable" };
}

/** Staff: connect to whichever service does the lookup, download its bank list and say which of our banks it cannot match. Free. */
export async function lookupBankCheck() {
  const provider = lookupProvider();
  const mode = lookupMode();
  if (provider === "off") return { provider, mode, ok: false, message: "No bank lookup is switched on. Set PAYSTACK_SECRET_KEY in Vercel." };
  const label = provider === "paystack" ? "Paystack" : "Monnify";
  try {
    const banks = provider === "paystack" ? await paystackBanks() : await monnifyBanks();
    const ours = BANK_GROUPS.flatMap((g) => g.banks);
    const missing = unmatchedBanks(ours, banks);
    return {
      provider, mode, ok: true, label, base: provider === "paystack" ? PAYSTACK_BASE : monnifyBase(), providerBanks: banks.length, ours: ours.length, matched: ours.length - missing.length,
      unmatched: missing, unmatchedDetail: missing.map((name) => ({ name, near: suggestBanks(name, banks, 3) })),
    };
  } catch (e) {
    return { provider, mode, ok: false, label, message: e instanceof Error ? e.message : `${label} did not answer.` };
  }
}
