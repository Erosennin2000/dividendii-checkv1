import { NextResponse } from "next/server";
import { AdminError, requirePilotAdmin } from "@/lib/pilot/admin";
import { BANK_GROUPS } from "@/lib/pilot/banks";
import { monnifyBanks, monnifyBase, monnifyMode, monnifyOn, rawAccountLookup, suggestBanks, unmatchedBanks } from "@/lib/pilot/monnify";
import { tooMany } from "@/lib/pilot/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Staff only. Free: signs in to Monnify, downloads its bank list and reports which of our banks it can't match, with the closest names Monnify does have. Spends nothing. */
export async function GET(req: Request) {
  try {
    await requirePilotAdmin(req);
    const mode = monnifyMode();
    if (!monnifyOn()) return NextResponse.json({ mode, ok: false, message: "Monnify keys are not set (MONNIFY_API_KEY and MONNIFY_SECRET_KEY)." });
    try {
      const banks = await monnifyBanks();
      const ours = BANK_GROUPS.flatMap((g) => g.banks);
      const missing = unmatchedBanks(ours, banks);
      return NextResponse.json({
        mode, ok: true, base: monnifyBase(), monnifyBanks: banks.length, ours: ours.length, matched: ours.length - missing.length,
        unmatched: missing,
        unmatchedDetail: missing.map((name) => ({ name, near: suggestBanks(name, banks, 3) })),
      });
    } catch (e) {
      return NextResponse.json({ mode, ok: false, base: monnifyBase(), message: e instanceof Error ? e.message : "Monnify did not answer." });
    }
  } catch (e) {
    if (e instanceof AdminError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: "Something went wrong." }, { status: 500 });
  }
}

/** Staff only. "Try one account": one free lookup, showing exactly what Monnify said and what a customer would be told. */
export async function POST(req: Request) {
  try {
    await requirePilotAdmin(req);
    if (tooMany("monnify-try", 60)) return NextResponse.json({ error: "That is a lot of tries. Wait a little." }, { status: 429 });
    const b = (await req.json().catch(() => ({}))) as { bank?: string; accountNumber?: string };
    const bank = String(b.bank ?? "").slice(0, 80);
    const acct = String(b.accountNumber ?? "").replace(/\D/g, "");
    if (!bank) return NextResponse.json({ error: "Choose a bank." }, { status: 400 });
    if (acct.length !== 10) return NextResponse.json({ error: "An account number has exactly 10 digits." }, { status: 400 });
    return NextResponse.json(await rawAccountLookup(bank, acct));
  } catch (e) {
    if (e instanceof AdminError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: "Something went wrong." }, { status: 500 });
  }
}
