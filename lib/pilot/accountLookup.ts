import "server-only";
import { PaystackError, paystackBanks, paystackMode, resolveAccount } from "./paystack";
import { lookupCore, matchBank, monnifyBase, monnifyMode, monnifyOn, type LookupDetail } from "./monnify";

/**
 * "The bank shows this account as ..." on step 3, from whichever provider is on a live key. Free either way.
 *   Monnify (live keys)     first. Its "no such account" answer is clear enough to stop step 3.
 *   Paystack (live key)     used when Monnify is off or sandbox, and as a back-up when Monnify can't answer.
 *                           Paystack's "could not resolve" is also what it says when a bank is slow, so it only ever
 *                           WARNS ("unconfirmed"), it never stops a customer.
 * Sandbox and test keys are never used: they answer for pretend banks.
 */
export type Provider = "monnify" | "paystack";

export function lookupProviders(): Provider[] {
  const out: Provider[] = [];
  if (monnifyOn() && monnifyMode() === "live") out.push("monnify");
  if (paystackMode() === "live") out.push("paystack");
  return out;
}
export const accountLookupOn = () => lookupProviders().length > 0;

const COULD_NOT_RESOLVE = /could not resolve|unable to resolve|invalid (account|nuban)|account (number )?(is )?(invalid|not found)/i;
const NOT_ABOUT_THE_ACCOUNT = /bank ?code|invalid bank|unsupported|rate limit|too many|unauthori[sz]ed|invalid key|api ?key|permission|suspended|not (yet )?(enabled|available|supported)|try again later|service/i;

export async function paystackLookupCore(bankName: string, accountNumber: string): Promise<LookupDetail> {
  const provider = "paystack" as const;
  if (!/^\d{10}$/.test(accountNumber)) return { verdict: "unavailable", bankMatch: null, note: "The account number is not 10 digits.", provider };
  let match: ReturnType<typeof matchBank> = null;
  try {
    match = matchBank(bankName, await paystackBanks());
    if (!match) return { verdict: "unavailable", bankMatch: null, note: `"${bankName}" is not in Paystack's bank list under this name, so no lookup was made.`, provider };
    const name = await resolveAccount(match.code, accountNumber);
    if (name) return { verdict: "found", name, bankMatch: match, httpStatus: 200, providerMessage: "Account number resolved", note: "Paystack gave a name.", provider };
    return { verdict: "unavailable", bankMatch: match, httpStatus: 200, note: "Paystack answered without a name, so we cannot tell.", provider };
  } catch (e) {
    if (!(e instanceof PaystackError)) return { verdict: "unavailable", bankMatch: match, note: "Could not reach Paystack.", provider };
    const base = { bankMatch: match, httpStatus: e.status, providerMessage: e.message, provider };
    const couldNotResolve = e.status === 422 && COULD_NOT_RESOLVE.test(e.message) && !NOT_ABOUT_THE_ACCOUNT.test(e.message);
    if (!couldNotResolve) return { verdict: "unavailable", ...base, note: "Paystack's reply was not a plain \"could not resolve\", so nothing is said to the customer." };
    if (match?.confidence !== "exact") return { verdict: "unavailable", ...base, note: "The bank name was only a close match, so we cannot be sure we asked the right bank." };
    return { verdict: "unconfirmed", ...base, note: "Paystack could not resolve this account. The customer sees a warning to check the number, but is never stopped: Paystack says the same thing when a bank is slow." };
  }
}

async function one(p: Provider, bank: string, acct: string): Promise<LookupDetail> {
  if (p === "paystack") return paystackLookupCore(bank, acct);
  const r = await lookupCore(bank, acct);
  return { ...r, provider: "monnify", providerMessage: r.monnifyMessage };
}

/** What step 3 uses. Tries each live provider in turn until one gives an answer other than "unavailable". */
export async function lookupAccount(bank: string, acct: string): Promise<LookupDetail & { tried: Provider[] }> {
  const providers = lookupProviders();
  let last: LookupDetail = { verdict: "unavailable", bankMatch: null, note: "No account lookup is switched on (needs live Paystack or live Monnify keys)." };
  const tried: Provider[] = [];
  for (const p of providers) {
    tried.push(p);
    try { last = await one(p, bank, acct); } catch { last = { verdict: "unavailable", bankMatch: null, note: `${p} failed.`, provider: p }; }
    if (last.verdict !== "unavailable") break;
  }
  return { ...last, tried };
}

/** Staff "try one account": the same decision a customer would get, plus what each provider said. Never throws. */
export async function tryAccount(bank: string, acct: string): Promise<LookupDetail & { tried: Provider[]; mode: string; base: string; paystackMode: string }> {
  const r = await lookupAccount(bank, acct);
  return { ...r, mode: monnifyMode(), base: monnifyBase(), paystackMode: paystackMode() };
}
