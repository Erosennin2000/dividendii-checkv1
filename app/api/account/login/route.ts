import { NextResponse } from "next/server";
import { sameOrigin, signInWithPassword } from "@/lib/pilot/account";
import { accountFail, forbidden, ipOf, withSession } from "@/lib/pilot/accountRoute";
import { tooMany } from "@/lib/pilot/rateLimit";
import { getPilotStore } from "@/lib/pilot/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    if (!sameOrigin(req)) return forbidden();
    if (tooMany("login:" + ipOf(req), 20)) return NextResponse.json({ error: "Too many tries. Wait an hour, or set a new password with a code." }, { status: 429 });
    const b = (await req.json().catch(() => ({}))) as { email?: string; password?: string };
    const lead = await signInWithPassword(String(b.email ?? ""), String(b.password ?? ""), await getPilotStore());
    return withSession(req, { ok: true }, lead, "password");
  } catch (e) { return accountFail(e, "login"); }
}
