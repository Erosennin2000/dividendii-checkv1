import { NextResponse } from "next/server";
import { currentAccount, sameOrigin } from "@/lib/pilot/account";
import { accountFail, forbidden } from "@/lib/pilot/accountRoute";
import { getPilotStore } from "@/lib/pilot/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Join or leave the investing waitlist. */
export async function POST(req: Request) {
  try {
    if (!sameOrigin(req)) return forbidden();
    const store = await getPilotStore();
    const me = await currentAccount(req, store);
    if (!me) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
    const b = (await req.json().catch(() => ({}))) as { join?: boolean };
    const investWaitlistAt = b.join === false ? null : me.lead.investWaitlistAt ?? new Date().toISOString();
    await store.saveLead({ ...me.lead, investWaitlistAt });
    return NextResponse.json({ waitlist: investWaitlistAt });
  } catch (e) { return accountFail(e, "waitlist"); }
}
