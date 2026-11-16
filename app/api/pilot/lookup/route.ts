import { NextResponse } from "next/server";
import { lookupAccountName, monnifyOn } from "@/lib/pilot/monnify";
import { tooMany } from "@/lib/pilot/rateLimit";
import { verifyToken } from "@/lib/pilot/token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * "The bank shows this account as ..." on step 3. Free (Monnify account name lookup).
 * Needs the same email-confirmed token as submitting. Always answers 200: if the lookup is off or fails the form just
 * shows nothing, and nothing here ever stops anyone.
 */
export async function POST(req: Request) {
  try {
    const raw = await req.json().catch(() => null);
    const who = verifyToken(raw?.token);
    if (!who) return NextResponse.json({ name: null, why: "signed_out" });
    if (!monnifyOn()) return NextResponse.json({ name: null, why: "off" });
    if (tooMany("lookup:" + who.leadId, 15)) return NextResponse.json({ name: null, why: "slow_down" });
    const bank = typeof raw?.bank === "string" ? raw.bank.slice(0, 80) : "";
    const acct = typeof raw?.accountNumber === "string" ? raw.accountNumber : "";
    if (!bank || !/^\d{10}$/.test(acct)) return NextResponse.json({ name: null, why: "incomplete" });
    const name = await lookupAccountName(bank, acct);
    return NextResponse.json({ name, why: name ? "ok" : "not_found" });
  } catch (e) {
    console.error("[pilot] account name lookup failed", e instanceof Error ? e.message : e);
    return NextResponse.json({ name: null, why: "unavailable" });
  }
}
