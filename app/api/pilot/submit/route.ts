import { NextResponse } from "next/server";
import { getMailer } from "@/lib/pilot/mail";
import { effectiveSettings } from "@/lib/pilot/settings";
import { tooMany } from "@/lib/pilot/rateLimit";
import { getPilotStore } from "@/lib/pilot/store";
import { createPilot } from "@/lib/pilot/submit";
import { verifyToken } from "@/lib/pilot/token";
import { PilotValidationError, parsePilotInput } from "@/lib/pilot/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Public, but needs the token from the email check. Validates, fills the forms and saves the record, then replies at once with the reference.
 * The emails go out in a second call (/api/pilot/dispatch), so the person never waits on the mail server.
 */
export async function POST(req: Request) {
  try {
    const ip = (req.headers.get("x-forwarded-for") ?? "unknown").split(",")[0].trim();
    if (tooMany(ip)) return NextResponse.json({ error: "Too many submissions from this connection. Try again in an hour." }, { status: 429 });

    const raw = await req.json().catch(() => null);
    // The hidden "website" box is for bots. Pretend it worked and do nothing.
    if (raw && typeof raw.website === "string" && raw.website.trim()) return NextResponse.json({ id: "", ref: "DVD-000000", sendStatus: "sent", payment: { method: "debit_after", amountDue: 0 } });

    // Step 1's email check must have passed. The token says which lead, and the email on the forms is theirs.
    const who = verifyToken(raw?.token);
    if (!who) return NextResponse.json({ error: "Please confirm your email again to continue." }, { status: 401 });
    const store = await getPilotStore();
    const settings = effectiveSettings(await store.getSettings());
    if (!settings.acceptingSubmissions) return NextResponse.json({ error: "We've paused new submissions for a moment. Please try again later." }, { status: 503 });
    const input = parsePilotInput({ ...raw, profile: { ...(raw?.profile ?? {}), email: who.email } }, { isOpen: (id) => settings.registrars[id]?.enabled === true });
    const sub = await createPilot(input, { store, mailer: getMailer(), leadId: who.leadId, settings });
    return NextResponse.json({
      id: sub.id,
      ref: sub.ref,
      sendStatus: sub.sendStatus,
      mode: sub.mode,
      registrars: [...new Set(sub.holdings.map((h) => h.registrar))],
      companyCount: sub.holdings.length,
      byHand: sub.forms.flatMap((f) => f.unlisted),
      payment: { method: sub.payment.method, amountDue: sub.payment.amountDue },
    });
  } catch (e) {
    if (e instanceof PilotValidationError) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error("[pilot] submit failed", e);
    return NextResponse.json({ error: "Something went wrong on our side. Nothing was sent. Try again in a minute." }, { status: 500 });
  }
}
