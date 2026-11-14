import { NextResponse } from "next/server";
import { currentAccount } from "@/lib/pilot/account";
import { accountView } from "@/lib/pilot/accountView";
import { accountFail, signedOut } from "@/lib/pilot/accountRoute";
import { publicBase } from "@/lib/pilot/pay";
import { getPilotStore } from "@/lib/pilot/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The signed-in person's account: their dividend checks, fees and masked details. 401 when not signed in. */
export async function GET(req: Request) {
  try {
    const store = await getPilotStore();
    const me = await currentAccount(req, store);
    if (!me) return signedOut(req, { error: "Sign in to see your account." }, 401);
    const subs = await store.listByEmail(me.lead.email);
    const view = accountView(me.lead, subs, publicBase(req.headers.get("origin") ?? new URL(req.url).origin));
    return NextResponse.json({ ...view, session: { via: me.session.via, expires: new Date(me.session.exp).toISOString() } }, { headers: { "cache-control": "no-store" } });
  } catch (e) { return accountFail(e, "me"); }
}
