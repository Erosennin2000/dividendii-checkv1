import { NextResponse } from "next/server";
import { AdminError, requirePilotAdmin } from "@/lib/pilot/admin";
import { getMailer } from "@/lib/pilot/mail";
import { getPilotStore } from "@/lib/pilot/store";
import { publicBase, requestSuccessFee, sendPayLink } from "@/lib/pilot/pay";
import { chasePilot, resendPilot } from "@/lib/pilot/submit";
import { clean } from "@/lib/pilot/text";
import { PROGRESS_LABEL, type ProgressStatus } from "@/lib/pilot/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface Body { action?: string; registrarId?: string; note?: string; message?: string; amount?: number | string; status?: string; index?: number }

/** Staff only: send or resend, chase a registrar, email a pay link, ask for the success fee, mark fees received, or leave a note. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const staff = await requirePilotAdmin(req);
    const b = (await req.json().catch(() => ({}))) as Body;
    const store = await getPilotStore();
    const sub = await store.get(id);
    if (!sub) throw new AdminError(404, "Submission not found.");

    if (b.action === "resend") {
      return NextResponse.json({ submission: await resendPilot(id, b.registrarId ? String(b.registrarId) : null, { store, mailer: getMailer() }) });
    }
    if (b.action === "chase") {
      return NextResponse.json({ submission: await chasePilot(id, String(b.registrarId ?? ""), clean(b.message, 1000), { store, mailer: getMailer() }) });
    }
    if (b.action === "markPaid" || b.action === "markUnpaid") {
      if (sub.payment.method !== "pay_ahead") throw new AdminError(400, "This older submission has no start fee to mark.");
      if (b.action === "markUnpaid" && sub.payment.via === "paystack") throw new AdminError(400, "Paystack confirmed this payment, so it can't be marked unpaid here. Refund it in your Paystack dashboard instead.");
      const payment = b.action === "markPaid"
        ? { ...sub.payment, status: "paid" as const, paidAt: new Date().toISOString(), via: "manual" as const }
        : { ...sub.payment, status: "awaiting_payment" as const, paidAt: null, via: null };
      await store.update(sub.id, { payment });
      return NextResponse.json({ submission: { ...sub, payment } });
    }
    if (b.action === "sendPayLink") {
      return NextResponse.json({ submission: await sendPayLink(id, publicBase(req.headers.get("origin")), { store, mailer: getMailer() }) });
    }
    if (b.action === "requestSuccessFee") {
      return NextResponse.json({ submission: await requestSuccessFee(id, clean(b.message, 1000), publicBase(req.headers.get("origin")), { store, mailer: getMailer() }) });
    }
    if (b.action === "markSuccessPaid") {
      // For a success fee that arrived another way (bank transfer, cash). Amount in naira, optional.
      const amt = Number(String(b.amount ?? "").replace(/[,₦\s]/g, ""));
      const prev = sub.successFee;
      const successFee = { ...prev, requestedAt: prev?.requestedAt ?? null, requests: prev?.requests ?? 0, declared: prev?.declared ?? null, fee: Number.isFinite(amt) && amt > 0 ? Math.round(amt * 100) / 100 : prev?.fee ?? null, status: "paid" as const, reference: prev?.reference ?? null, paidAt: new Date().toISOString(), via: "manual" as const };
      await store.update(sub.id, { successFee });
      return NextResponse.json({ submission: { ...sub, successFee } });
    }
    if (b.action === "addProgress") {
      // A step the shareholder sees in their account, for one registrar.
      const rid = sub.holdings.find((h) => h.registrarId === b.registrarId)?.registrarId;
      if (!rid) throw new AdminError(400, "Pick one of the registrars on this submission.");
      const status = String(b.status ?? "") as ProgressStatus;
      if (!(status in PROGRESS_LABEL)) throw new AdminError(400, "Pick a status.");
      const progress = [...(sub.progress ?? []), { registrarId: rid, status, note: clean(b.note, 500), at: new Date().toISOString(), by: staff }];
      await store.update(sub.id, { progress });
      return NextResponse.json({ submission: { ...sub, progress } });
    }
    // Entries in the shareholder's history are never removed (it is the record of what we told them). A mistake is corrected by adding a new entry.
    if (b.action === "removeProgress") throw new AdminError(400, "Updates can't be removed. Add a new update that corrects it.");
    if (b.action === "delete") {
      // Privacy promise: on request we delete the record and its files. Staff must type the reference to confirm.
      if (String(b.note ?? "").trim().toUpperCase() !== sub.ref.toUpperCase()) throw new AdminError(400, "Type the reference exactly to confirm the delete.");
      await store.deleteSubmission(sub.id);
      // When that was their last submission, their account, sign-in details and feedback go too: "delete my data" means all of it.
      const email = sub.profile.email;
      const left = (await store.listByEmail(email)).length;
      if (left === 0) await store.deletePersonData(email);
      console.warn("[pilot] submission deleted", sub.ref, "by", staff, left === 0 ? "(account and feedback removed)" : "(other submissions remain, account kept)");
      return NextResponse.json({ deleted: true, accountRemoved: left === 0 });
    }
    if (b.action === "customerMessage") {
      const customerMessage = clean(b.message, 600);
      await store.update(sub.id, { customerMessage });
      return NextResponse.json({ submission: { ...sub, customerMessage } });
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
