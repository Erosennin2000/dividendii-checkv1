import { NextResponse } from "next/server";
import { getMailer } from "@/lib/pilot/mail";
import { settlePayment } from "@/lib/pilot/pay";
import { validWebhookSignature } from "@/lib/pilot/paystack";
import { getPilotStore } from "@/lib/pilot/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Paystack calls this when a payment succeeds, even if the customer closed the tab before coming back to us.
 * Set it in Paystack > Settings > API Keys & Webhooks. The signature proves it is Paystack; we then verify the payment again
 * with Paystack before marking anything paid. Always answers 200 for a genuine event so Paystack does not keep retrying.
 */
export async function POST(req: Request) {
  const raw = await req.text();
  if (!validWebhookSignature(raw, req.headers.get("x-paystack-signature"))) return NextResponse.json({ error: "Bad signature." }, { status: 401 });
  try {
    const event = JSON.parse(raw) as { event?: string; data?: { reference?: string } };
    if (event.event === "charge.success" && typeof event.data?.reference === "string") {
      const store = await getPilotStore();
      const r = await settlePayment(event.data.reference, { store, mailer: getMailer() });
      console.log("[pilot] webhook settled", r.submission.ref, r.kind, r.ok ? "ok" : r.message);
    }
  } catch (e) {
    // A payment we can't match (for example one made outside this app) is logged, not retried forever.
    console.error("[pilot] webhook could not settle", e instanceof Error ? e.message : e);
  }
  return NextResponse.json({ received: true });
}
