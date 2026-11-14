import { NextResponse } from "next/server";
import { getMailer } from "@/lib/pilot/mail";
import { PayError, payLink, publicBase, settlePayment } from "@/lib/pilot/pay";
import { PaystackError } from "@/lib/pilot/paystack";
import { tooMany } from "@/lib/pilot/rateLimit";
import { getPilotStore } from "@/lib/pilot/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The page Paystack sends people back to calls this with the payment reference. We ask Paystack what really happened;
 * the browser arriving here proves nothing by itself. On a confirmed start fee, the forms are sent.
 * Replies only with what the payer already knows: reference, first name, registrars.
 */
export async function POST(req: Request) {
  try {
    const ip = (req.headers.get("x-forwarded-for") ?? "unknown").split(",")[0].trim();
    if (tooMany("verify:" + ip, 40)) return NextResponse.json({ error: "Too many tries from this connection. Wait a little and try again." }, { status: 429 });
    const raw = (await req.json().catch(() => null)) as { reference?: unknown } | null;
    const reference = typeof raw?.reference === "string" ? raw.reference.trim() : "";
    if (!/^[A-Za-z0-9.=-]{6,100}$/.test(reference)) return NextResponse.json({ error: "That payment reference isn't valid." }, { status: 400 });
    const store = await getPilotStore();
    const r = await settlePayment(reference, { store, mailer: getMailer() });
    const s = r.submission;
    return NextResponse.json({
      kind: r.kind, ok: r.ok, status: r.status, message: r.message,
      ref: s.ref, firstName: s.profile.firstName, mode: s.mode,
      sendStatus: s.sendStatus,
      registrars: [...new Set(s.holdings.map((h) => h.registrar))],
      companyCount: s.holdings.length,
      amount: r.kind === "start" ? s.payment.amountDue : s.successFee?.fee ?? null,
      // If it didn't go through, the same person can try again from here.
      retry: r.ok ? null : payLink(publicBase(req.headers.get("origin")), s, r.kind),
    });
  } catch (e) {
    if (e instanceof PayError) return NextResponse.json({ error: e.message }, { status: e.status });
    if (e instanceof PaystackError) { console.error("[pilot] verify: paystack", e.message); return NextResponse.json({ error: "We couldn't confirm that payment yet. If you were charged, it will update shortly. Reply to our email if it doesn't." }, { status: 502 }); }
    console.error("[pilot] pay verify failed", e);
    return NextResponse.json({ error: "Something went wrong on our side. If you were charged, we will see it. Reply to our email if you need help." }, { status: 500 });
  }
}
