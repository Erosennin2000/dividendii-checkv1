import { NextResponse } from "next/server";
import { readSession, cookieFrom, sameOrigin, setPassword } from "@/lib/pilot/account";
import { accountFail, forbidden, ipOf, withSession } from "@/lib/pilot/accountRoute";
import { tooMany } from "@/lib/pilot/rateLimit";
import { getPilotStore } from "@/lib/pilot/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Sets the password: with the emailed code, or right after the form (signed in by email, no password yet). Signs in. */
export async function POST(req: Request) {
  try {
    if (!sameOrigin(req)) return forbidden();
    if (tooMany("apw:" + ipOf(req), 20)) return NextResponse.json({ error: "Too many tries. Try again in an hour." }, { status: 429 });
    const b = (await req.json().catch(() => ({}))) as { email?: string; code?: string; password?: string };
    const lead = await setPassword({ email: b.email, code: b.code, password: String(b.password ?? ""), session: readSession(cookieFrom(req)) }, await getPilotStore());
    return withSession(req, { ok: true }, lead, "password");
  } catch (e) { return accountFail(e, "password"); }
}
