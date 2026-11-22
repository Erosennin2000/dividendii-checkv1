import { NextResponse } from "next/server";
import { AdminError, requirePilotAdmin } from "@/lib/pilot/admin";
import { lookupBankCheck, lookupDetail } from "@/lib/pilot/accountLookup";
import { tooMany } from "@/lib/pilot/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Staff only. Free: connects to whichever service does the account lookup (Paystack by default), downloads its bank list and reports which of our banks it can't match, with the closest names it does have. Spends nothing. (The path keeps its old name so nothing else changes.) */
export async function GET(req: Request) {
  try {
    await requirePilotAdmin(req);
    return NextResponse.json(await lookupBankCheck());
  } catch (e) {
    if (e instanceof AdminError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: "Something went wrong." }, { status: 500 });
  }
}

/** Staff only. "Try one account": one free lookup, showing exactly what the lookup service said and what a customer would be told. */
export async function POST(req: Request) {
  try {
    await requirePilotAdmin(req);
    if (tooMany("monnify-try", 60)) return NextResponse.json({ error: "That is a lot of tries. Wait a little." }, { status: 429 });
    const b = (await req.json().catch(() => ({}))) as { bank?: string; accountNumber?: string };
    const bank = String(b.bank ?? "").slice(0, 80);
    const acct = String(b.accountNumber ?? "").replace(/\D/g, "");
    if (!bank) return NextResponse.json({ error: "Choose a bank." }, { status: 400 });
    if (acct.length !== 10) return NextResponse.json({ error: "An account number has exactly 10 digits." }, { status: 400 });
    return NextResponse.json(await lookupDetail(bank, acct));
  } catch (e) {
    if (e instanceof AdminError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: "Something went wrong." }, { status: 500 });
  }
}
