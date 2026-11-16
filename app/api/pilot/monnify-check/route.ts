import { NextResponse } from "next/server";
import { AdminError, requirePilotAdmin } from "@/lib/pilot/admin";
import { BANK_GROUPS } from "@/lib/pilot/banks";
import { monnifyBanks, monnifyBase, monnifyMode, monnifyOn, unmatchedBanks } from "@/lib/pilot/monnify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Staff only. Free: signs in to Monnify, downloads its bank list and reports which of our banks it can't match. Spends nothing. */
export async function GET(req: Request) {
  try {
    await requirePilotAdmin(req);
    const mode = monnifyMode();
    if (!monnifyOn()) return NextResponse.json({ mode, ok: false, message: "Monnify keys are not set (MONNIFY_API_KEY and MONNIFY_SECRET_KEY)." });
    try {
      const banks = await monnifyBanks();
      const ours = BANK_GROUPS.flatMap((g) => g.banks);
      const missing = unmatchedBanks(ours, banks);
      return NextResponse.json({ mode, ok: true, base: monnifyBase(), monnifyBanks: banks.length, ours: ours.length, matched: ours.length - missing.length, unmatched: missing });
    } catch (e) {
      return NextResponse.json({ mode, ok: false, base: monnifyBase(), message: e instanceof Error ? e.message : "Monnify did not answer." });
    }
  } catch (e) {
    if (e instanceof AdminError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: "Something went wrong." }, { status: 500 });
  }
}
