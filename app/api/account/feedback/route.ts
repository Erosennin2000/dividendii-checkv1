import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { currentAccount, sameOrigin } from "@/lib/pilot/account";
import { accountFail, forbidden } from "@/lib/pilot/accountRoute";
import { tooMany } from "@/lib/pilot/rateLimit";
import { getPilotStore } from "@/lib/pilot/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Feedback from a signed-in account holder. Staff read it on the admin page. */
export async function POST(req: Request) {
  try {
    if (!sameOrigin(req)) return forbidden();
    const store = await getPilotStore();
    const me = await currentAccount(req, store);
    if (!me) return NextResponse.json({ error: "Sign in again to send feedback." }, { status: 401 });
    if (tooMany("fb:" + me.lead.id, 15)) return NextResponse.json({ error: "Thank you, that's plenty for now. Try again later." }, { status: 429 });
    const b = (await req.json().catch(() => ({}))) as { message?: string; rating?: number; page?: string };
    const message = String(b.message ?? "").replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, 3000);
    if (message.length < 3) return NextResponse.json({ error: "Write a few words first." }, { status: 400 });
    const rating = Number.isInteger(b.rating) && Number(b.rating) >= 1 && Number(b.rating) <= 5 ? Number(b.rating) : null;
    await store.saveFeedback({
      id: randomBytes(10).toString("hex"), at: new Date().toISOString(), leadId: me.lead.id, email: me.lead.email,
      name: `${me.lead.firstName} ${me.lead.surname}`.trim(), page: b.page === "demo" ? "demo" : "account", rating, message, readAt: null,
    });
    return NextResponse.json({ ok: true });
  } catch (e) { return accountFail(e, "feedback"); }
}
