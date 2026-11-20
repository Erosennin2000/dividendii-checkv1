import { NextResponse } from "next/server";
import { accountLookupOn, lookupAccount } from "@/lib/pilot/accountLookup";
import { tooMany } from "@/lib/pilot/rateLimit";
import { verifyToken } from "@/lib/pilot/token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * "The bank shows this account as ..." on step 3. Free (live Monnify or live Paystack account name lookup).
 * Needs the same email-confirmed token as submitting. Always answers 200 with status found | not_found | unconfirmed | unavailable.
 * Only a clear "no such account" from live Monnify (not_found) stops step 3; every other outcome lets the customer carry on.
 */
export async function POST(req: Request) {
  try {
    const raw = await req.json().catch(() => null);
    const who = verifyToken(raw?.token);
    if (!who) return NextResponse.json({ status: "unavailable", name: null, why: "signed_out" });
    if (!accountLookupOn()) return NextResponse.json({ status: "unavailable", name: null, why: "off" });
    if (tooMany("lookup:" + who.leadId, 15)) return NextResponse.json({ status: "unavailable", name: null, why: "slow_down" });
    const bank = typeof raw?.bank === "string" ? raw.bank.slice(0, 80) : "";
    const acct = typeof raw?.accountNumber === "string" ? raw.accountNumber : "";
    if (!bank || !/^\d{10}$/.test(acct)) return NextResponse.json({ status: "unavailable", name: null, why: "incomplete" });
    const r = await lookupAccount(bank, acct);
    return NextResponse.json({ status: r.verdict, name: r.verdict === "found" ? r.name ?? null : null });
  } catch (e) {
    console.error("[pilot] account name lookup failed", e instanceof Error ? e.message : e);
    return NextResponse.json({ status: "unavailable", name: null, why: "error" });
  }
}
