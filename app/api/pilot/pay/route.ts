import { NextResponse } from "next/server";
import { getMailer } from "@/lib/pilot/mail";
import { PayError, beginStartPayment, beginSuccessPayment, publicBase } from "@/lib/pilot/pay";
import { PaystackError, paystackMode, paystackOn } from "@/lib/pilot/paystack";
import { effectiveSettings } from "@/lib/pilot/settings";
import { tooMany } from "@/lib/pilot/rateLimit";
import { getPilotStore } from "@/lib/pilot/store";
import { validLink, verifyToken } from "@/lib/pilot/token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const fail = (e: unknown, what: string) => {
  if (e instanceof PayError) return NextResponse.json({ error: e.message }, { status: e.status });
  if (e instanceof PaystackError) { console.error(`[pilot] ${what}: paystack`, e.message); return NextResponse.json({ error: "We couldn't reach the payment page just now. Try again in a minute." }, { status: 502 }); }
  console.error(`[pilot] ${what} failed`, e);
  return NextResponse.json({ error: "Something went wrong on our side. You have not been charged. Try again in a minute." }, { status: 500 });
};

/** Public, by emailed link. What the pay-by-link page shows: the reference, what is due and whether it is paid. Nothing private. */
export async function GET(req: Request) {
  try {
    const q = new URL(req.url).searchParams;
    const id = q.get("s"), key = q.get("k");
    if (!validLink(id, key)) return NextResponse.json({ error: "This payment link isn't valid. Use the link in our latest email." }, { status: 404 });
    const store = await getPilotStore();
    const sub = await store.get(id!);
    if (!sub) return NextResponse.json({ error: "This payment link isn't valid. Use the link in our latest email." }, { status: 404 });
    const settings = effectiveSettings(await store.getSettings());
    return NextResponse.json({
      ref: sub.ref, firstName: sub.profile.firstName,
      companies: sub.holdings.map((h) => h.company),
      perCompany: settings.payAheadPerCompany, ratePercent: settings.debitRatePercent,
      start: { amount: sub.payment.amountDue, paid: sub.payment.status === "paid" },
      success: { paid: sub.successFee?.status === "paid", fee: sub.successFee?.status === "paid" ? sub.successFee.fee : null },
      payOnline: paystackOn(), payMode: paystackMode(),
    });
  } catch (e) { return fail(e, "pay info"); }
}

/**
 * Starts a Paystack payment and replies with the checkout address.
 *   From the form:        { token, id }                       the start fee, straight after step 4
 *   From an emailed link: { s, k, kind: "start" }             the start fee
 *                         { s, k, kind: "success", amount }   the success fee on the amount they received
 */
export async function POST(req: Request) {
  try {
    const ip = (req.headers.get("x-forwarded-for") ?? "unknown").split(",")[0].trim();
    if (tooMany("pay:" + ip, 40)) return NextResponse.json({ error: "Too many tries from this connection. Wait a little and try again." }, { status: 429 });
    const raw = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const store = await getPilotStore();
    const deps = { store, mailer: getMailer() };
    const base = publicBase(req.headers.get("origin"));

    if (typeof raw?.s === "string") {
      if (!validLink(raw.s, raw.k)) return NextResponse.json({ error: "This payment link isn't valid. Use the link in our latest email." }, { status: 404 });
      const sub = await store.get(raw.s);
      if (!sub) return NextResponse.json({ error: "This payment link isn't valid." }, { status: 404 });
      if (raw.kind === "success") {
        const amount = typeof raw.amount === "number" ? raw.amount : Number(String(raw.amount ?? "").replace(/[,₦\s]/g, ""));
        const r = await beginSuccessPayment(sub, amount, base, deps);
        return NextResponse.json({ url: r.url, fee: r.fee });
      }
      const r = await beginStartPayment(sub, base, deps);
      return NextResponse.json(r.paid ? { paid: true } : { url: r.url });
    }

    const who = verifyToken(raw?.token);
    if (!who) return NextResponse.json({ error: "Please confirm your email again to continue." }, { status: 401 });
    const found = typeof raw?.id === "string" ? await store.get(raw.id) : null;
    if (!found || found.leadId !== who.leadId) return NextResponse.json({ error: "Submission not found." }, { status: 404 });
    const r = await beginStartPayment(found, base, deps);
    return NextResponse.json(r.paid ? { paid: true } : { url: r.url });
  } catch (e) { return fail(e, "pay start"); }
}
