import { NextResponse } from "next/server";
import { alertStaff } from "@/lib/pilot/alerts";
import { getMailer } from "@/lib/pilot/mail";
import { effectiveSettings } from "@/lib/pilot/settings";
import { getPilotStore } from "@/lib/pilot/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Once a day (the cron in vercel.json) looks for things that need a person:
 * customers who paid but whose forms did not go, emails that failed, and double payments.
 * Sends ONE email to the "copy me" address, only when there is something to report.
 * Vercel's cron sends the header "Authorization: Bearer <CRON_SECRET>". With no CRON_SECRET set in Vercel, this refuses to run.
 */
export async function GET(req: Request) {
  const secret = (process.env.CRON_SECRET ?? "").trim();
  if (!secret) return NextResponse.json({ error: "Set CRON_SECRET in Vercel to turn on the daily check." }, { status: 503 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "Not allowed." }, { status: 401 });
  try {
    const store = await getPilotStore();
    const settings = effectiveSettings(await store.getSettings());
    const subs = await store.list(500);
    const who = (s: (typeof subs)[number]) => `${s.ref} (${s.profile.firstName} ${s.profile.surname})`;
    const paidNotSent = subs.filter((s) => s.payment.status === "paid" && s.sendStatus !== "sent");
    const failed = subs.filter((s) => s.payment.status !== "paid" && (s.sendStatus === "failed" || s.sendStatus === "partial"));
    const doubles = subs.filter((s) => (s.payment.duplicates?.length ?? 0) > 0);
    const lines: string[] = [];
    if (paidNotSent.length) lines.push(`PAID BUT FORMS NOT FULLY SENT (${paidNotSent.length}): ` + paidNotSent.map(who).join("; ") + ". Open each one and press Send again.");
    if (failed.length) lines.push(`SEND FAILED, NOT PAID YET (${failed.length}): ` + failed.map(who).join("; ") + ".");
    if (doubles.length) lines.push(`DOUBLE PAYMENTS (${doubles.length}): ` + doubles.map(who).join("; ") + ". Refund the second payment in Paystack.");
    if (!lines.length) return NextResponse.json({ ok: true, alerts: 0 });
    const sent = await alertStaff(getMailer(), settings, `Daily check: ${lines.length} thing${lines.length === 1 ? "" : "s"} need a look`, lines);
    return NextResponse.json({ ok: true, alerts: lines.length, emailed: sent });
  } catch (e) {
    console.error("[pilot] daily check failed", e);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
