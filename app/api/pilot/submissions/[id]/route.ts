import { NextResponse } from "next/server";
import { AdminError, requirePilotAdmin } from "@/lib/pilot/admin";
import { getMailer } from "@/lib/pilot/mail";
import { getPilotStore } from "@/lib/pilot/store";
import { chasePilot, resendPilot } from "@/lib/pilot/submit";
import { clean } from "@/lib/pilot/text";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface Body { action?: string; registrarId?: string; note?: string; message?: string }

/** Staff only: send or resend, chase a registrar, mark pay-ahead as received, or leave a note. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    await requirePilotAdmin(req);
    const b = (await req.json().catch(() => ({}))) as Body;
    const store = await getPilotStore();
    const sub = await store.get(params.id);
    if (!sub) throw new AdminError(404, "Submission not found.");

    if (b.action === "resend") {
      return NextResponse.json({ submission: await resendPilot(params.id, b.registrarId ? String(b.registrarId) : null, { store, mailer: getMailer() }) });
    }
    if (b.action === "chase") {
      return NextResponse.json({ submission: await chasePilot(params.id, String(b.registrarId ?? ""), clean(b.message, 1000), { store, mailer: getMailer() }) });
    }
    if (b.action === "markPaid" || b.action === "markUnpaid") {
      if (sub.payment.method !== "pay_ahead") throw new AdminError(400, "Only pay-ahead submissions are marked paid by hand. Direct debits are collected after payment.");
      const payment = b.action === "markPaid"
        ? { ...sub.payment, status: "paid" as const, paidAt: new Date().toISOString() }
        : { ...sub.payment, status: "awaiting_payment" as const, paidAt: null };
      await store.update(sub.id, { payment });
      return NextResponse.json({ submission: { ...sub, payment } });
    }
    if (b.action === "note") {
      const note = clean(b.note, 2000);
      await store.update(sub.id, { note });
      return NextResponse.json({ submission: { ...sub, note } });
    }
    throw new AdminError(400, "Unknown action.");
  } catch (e) {
    if (e instanceof AdminError) return NextResponse.json({ error: e.message }, { status: e.status });
    if (e instanceof Error && (e as { code?: unknown }).code === undefined) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error("[pilot] action failed", e);
    return NextResponse.json({ error: "Something went wrong on our side. Try again." }, { status: 500 });
  }
}
