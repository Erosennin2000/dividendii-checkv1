import { NextResponse } from "next/server";
import { startLead, parseStart } from "@/lib/pilot/leads";
import { getMailer } from "@/lib/pilot/mail";
import { effectiveSettings } from "@/lib/pilot/settings";
import { tooMany } from "@/lib/pilot/rateLimit";
import { getPilotStore } from "@/lib/pilot/store";
import { PilotValidationError } from "@/lib/pilot/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Step 1. Saves name, other spellings, email and CHN/CSCS as a lead the moment the person continues,
 * then issues the email code (123456 in demo mode). Public.
 */
export async function POST(req: Request) {
  try {
    const ip = (req.headers.get("x-forwarded-for") ?? "unknown").split(",")[0].trim();
    if (tooMany(`start:${ip}`, 12)) return NextResponse.json({ error: "Too many tries from this connection. Try again in an hour." }, { status: 429 });
    const raw = await req.json().catch(() => null);
    if (raw && typeof raw.website === "string" && raw.website.trim()) return NextResponse.json({ leadId: "x", demo: true }); // honeypot
    const store = await getPilotStore();
    if (!effectiveSettings(await store.getSettings()).acceptingSubmissions) return NextResponse.json({ error: "We've paused new submissions for a moment. Please try again later." }, { status: 503 });
    const out = await startLead(parseStart(raw), { store, mailer: getMailer() });
    return NextResponse.json(out);
  } catch (e) {
    if (e instanceof PilotValidationError) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error("[pilot] start failed", e);
    return NextResponse.json({ error: "We couldn't save that just now. Try again in a minute." }, { status: 500 });
  }
}
