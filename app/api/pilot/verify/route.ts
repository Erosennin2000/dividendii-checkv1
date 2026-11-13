import { NextResponse } from "next/server";
import { verifyLead } from "@/lib/pilot/leads";
import { tooMany } from "@/lib/pilot/rateLimit";
import { getPilotStore } from "@/lib/pilot/store";
import { PilotValidationError } from "@/lib/pilot/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Checks the 6-digit code and, if right, hands back a signed token the submit route accepts. Public. */
export async function POST(req: Request) {
  try {
    const ip = (req.headers.get("x-forwarded-for") ?? "unknown").split(",")[0].trim();
    if (tooMany(`verify:${ip}`, 30)) return NextResponse.json({ error: "Too many tries from this connection. Try again in an hour." }, { status: 429 });
    const b = (await req.json().catch(() => ({}))) as { leadId?: string; code?: string };
    const out = await verifyLead(String(b.leadId ?? ""), String(b.code ?? ""), { store: await getPilotStore() });
    return NextResponse.json(out);
  } catch (e) {
    if (e instanceof PilotValidationError) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error("[pilot] verify failed", e);
    return NextResponse.json({ error: "We couldn't check that just now. Try again." }, { status: 500 });
  }
}
