import { NextResponse } from "next/server";
import { sameOrigin, sendAccountCode } from "@/lib/pilot/account";
import { accountFail, forbidden, ipOf } from "@/lib/pilot/accountRoute";
import { getMailer } from "@/lib/pilot/mail";
import { tooMany } from "@/lib/pilot/rateLimit";
import { getPilotStore } from "@/lib/pilot/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Sends a code to set or reset the password. Always the same reply, whether or not the email has an account. */
export async function POST(req: Request) {
  try {
    if (!sameOrigin(req)) return forbidden();
    if (tooMany("acode:" + ipOf(req), 10)) return NextResponse.json({ error: "Too many codes asked for. Try again in an hour." }, { status: 429 });
    const b = (await req.json().catch(() => ({}))) as { email?: string };
    const r = await sendAccountCode(String(b.email ?? ""), { store: await getPilotStore(), mailer: getMailer() });
    return NextResponse.json({ ok: true, demo: r.demo });
  } catch (e) { return accountFail(e, "code"); }
}
