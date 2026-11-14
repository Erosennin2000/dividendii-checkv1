import "server-only";
import { randomBytes } from "node:crypto";
import { payLinkEmail, pilotEnv, successFeeEmail } from "./mail";
import { initializePayment, paystackMode, paystackOn, verifyPayment, type Verified } from "./paystack";
import type { PilotSettings } from "./settingsShared";
import { dispatchPilot, settingsFor, type Deps } from "./submit";
import { signLink } from "./token";
import type { EmailRecord, PilotSubmission, SuccessFee } from "./types";

export const VAT = 0.075;
/** Paystack will not take less than this in naira. */
export const MIN_CHARGE = 50;

const round2 = (n: number) => Math.round(n * 100) / 100;
export const toKobo = (naira: number) => Math.round(naira * 100);

/** The start fee: per company, plus VAT. Naira, to the kobo. */
export const startFee = (companies: number, perCompany: number) => round2(companies * perCompany * (1 + VAT));
/** The success fee on an amount the shareholder says they received. */
export const successFeeOn = (received: number, ratePercent: number) => round2(received * ratePercent / 100);

export class PayError extends Error { constructor(message: string, readonly status = 400) { super(message); } }

/**
 * Where Paystack sends the customer back to. PILOT_PUBLIC_URL wins; otherwise the site the request came from,
 * as long as it is one of ours. Always ends in the /check base path.
 */
export function publicBase(origin: string | null, env: NodeJS.ProcessEnv = process.env): string {
  const fixed = (env.PILOT_PUBLIC_URL ?? "").trim().replace(/\/+$/, "");
  const base = (env.NEXT_PUBLIC_BASE_PATH ?? "/check");
  if (fixed) return fixed.endsWith(base) ? fixed : fixed + base;
  try {
    const u = new URL(origin ?? "");
    const ok = u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname.endsWith("dividendii.com") || u.hostname.endsWith(".vercel.app");
    if (ok && (u.protocol === "https:" || u.hostname === "localhost" || u.hostname === "127.0.0.1")) return u.origin + base;
  } catch { /* fall through */ }
  return "https://www.dividendii.com" + base;
}

/** The emailed pay-by-link page for a submission. */
export const payLink = (base: string, sub: Pick<PilotSubmission, "id">, kind: "start" | "success") =>
  `${base}/pilot/pay?s=${encodeURIComponent(sub.id)}&k=${signLink(sub.id)}&kind=${kind}`;

const newReference = (sub: PilotSubmission, kind: "start" | "success") => `${sub.ref}-${kind === "start" ? "S" : "F"}-${randomBytes(5).toString("hex")}`;

/** Starts the start-fee payment and returns Paystack's checkout address. */
export async function beginStartPayment(sub: PilotSubmission, base: string, deps: Deps): Promise<{ paid: true } | { paid: false; url: string; reference: string }> {
  if (sub.payment.status === "paid") return { paid: true };
  if (!paystackOn()) throw new PayError("Online payment is not set up yet. We will send you how to pay.", 503);
  if (!(sub.payment.amountDue >= MIN_CHARGE)) throw new PayError("There is nothing to pay on this submission.");
  const reference = newReference(sub, "start");
  const init = await initializePayment({
    email: sub.profile.email, amountKobo: toKobo(sub.payment.amountDue), reference,
    callbackUrl: `${base}/pilot/paid`,
    metadata: { submissionId: sub.id, ref: sub.ref, kind: "start" },
  });
  await deps.store.update(sub.id, { payment: { ...sub.payment, reference } });
  return { paid: false, url: init.authorizationUrl, reference };
}

/** The shareholder tells us what they received; we work out the fee and start that payment. */
export async function beginSuccessPayment(sub: PilotSubmission, received: number, base: string, deps: Deps): Promise<{ url: string; reference: string; fee: number }> {
  if (!paystackOn()) throw new PayError("Online payment is not set up yet. Reply to our email and we will send you how to pay.", 503);
  if (!Number.isFinite(received) || received <= 0) throw new PayError("Enter the amount you received, in naira.");
  if (received > 5_000_000_000) throw new PayError("That amount looks too large. Check it and try again, or reply to our email.");
  const settings = await settingsFor(deps);
  const fee = successFeeOn(received, settings.debitRatePercent);
  if (fee < MIN_CHARGE) throw new PayError(`The fee on that amount is below ₦${MIN_CHARGE}, which is too small to collect online. Thank you. You owe nothing further on it.`);
  const reference = newReference(sub, "success");
  const init = await initializePayment({
    email: sub.profile.email, amountKobo: toKobo(fee), reference,
    callbackUrl: `${base}/pilot/paid`,
    metadata: { submissionId: sub.id, ref: sub.ref, kind: "success", received: round2(received) },
  });
  const prev = sub.successFee;
  const successFee: SuccessFee = { requestedAt: prev?.requestedAt ?? null, requests: prev?.requests ?? 0, declared: round2(received), fee, status: prev?.status === "paid" ? "paid" : "requested", reference, paidAt: prev?.paidAt ?? null, via: prev?.via ?? null };
  await deps.store.update(sub.id, { successFee });
  return { url: init.authorizationUrl, reference, fee };
}

export interface Settled {
  kind: "start" | "success";
  /** True when Paystack confirms the money for the right amount. */
  ok: boolean;
  /** Paystack's word on it: success, failed, abandoned, pending... */
  status: string;
  message: string;
  submission: PilotSubmission;
}

/**
 * The single place a payment becomes "paid". Called by the return page and by the webhook, so it must be safe to run twice.
 * It asks Paystack directly, checks the amount and currency, then (for a start fee) sends the forms.
 */
export async function settlePayment(reference: string, deps: Deps, verified?: Verified): Promise<Settled> {
  const v = verified ?? (await verifyPayment(reference));
  const id = typeof v.metadata.submissionId === "string" ? v.metadata.submissionId : "";
  const kind = v.metadata.kind === "success" ? "success" : "start";
  let sub = id ? await deps.store.get(id) : null;
  if (!sub) throw new PayError("We couldn't match that payment to a submission. Reply to our email and quote your reference.", 404);
  const out = (ok: boolean, message: string): Settled => ({ kind, ok, status: v.status, message, submission: sub! });

  if (v.status !== "success") return out(false, v.status === "abandoned" || v.status === "pending" ? "The payment was not completed." : "The payment did not go through.");
  if (v.currency !== "NGN") return out(false, "That payment was not in naira. Please contact us.");
  // A live submission must be paid with real money, never a test card.
  if (sub.mode === "live" && v.domain !== "live") return out(false, "That was a test payment, so it does not count. Please contact us.");

  const at = v.paidAt ?? (deps.now?.() ?? new Date()).toISOString();
  if (kind === "start") {
    if (v.amountKobo < toKobo(sub.payment.amountDue)) return out(false, "The amount paid is less than the fee due. Please contact us.");
    if (sub.payment.status !== "paid") {
      const payment = { ...sub.payment, status: "paid" as const, paidAt: at, reference: v.reference, channel: v.channel, gatewayId: v.id, via: "paystack" as const };
      await deps.store.update(sub.id, { payment });
      sub = { ...sub, payment };
    }
    // Paid: now the forms go to the registrars. dispatchPilot only sends a queued submission, so a second call does nothing.
    if (sub.sendStatus === "queued") sub = await dispatchPilot(sub.id, deps);
    return out(true, "Payment received.");
  }
  const sf = sub.successFee;
  if (sf?.status !== "paid" || sf.reference !== v.reference) {
    const received = typeof v.metadata.received === "number" ? v.metadata.received : Number(v.metadata.received) || sf?.declared || null;
    const successFee: SuccessFee = { requestedAt: sf?.requestedAt ?? null, requests: sf?.requests ?? 0, declared: received, fee: v.amountKobo / 100, status: "paid", reference: v.reference, paidAt: at, via: "paystack" };
    await deps.store.update(sub.id, { successFee });
    sub = { ...sub, successFee };
  }
  return out(true, "Payment received. Thank you.");
}

async function sendToShareholder(sub: PilotSubmission, kind: EmailRecord["kind"], body: { subject: string; text: string; html: string }, deps: Deps, settings: PilotSettings): Promise<EmailRecord> {
  const env = pilotEnv(settings);
  const at = (deps.now?.() ?? new Date()).toISOString();
  const base: EmailRecord = { kind, to: sub.profile.email, status: "failed", at };
  try {
    const res = await deps.mailer.send({ from: env.from, to: sub.profile.email, replyTo: env.replyTo || undefined, ...body });
    return { ...base, status: "sent", messageId: res.messageId };
  } catch (e) {
    console.error("[pilot] shareholder email failed", sub.ref, kind, e);
    return { ...base, status: "failed", error: e instanceof Error ? e.message.slice(0, 300) : "Send failed." };
  }
}

/** Staff: email the shareholder a link to pay an unpaid start fee. */
export async function sendPayLink(id: string, base: string, deps: Deps): Promise<PilotSubmission> {
  const sub = await deps.store.get(id);
  if (!sub) throw new Error("Submission not found.");
  if (sub.payment.status === "paid") throw new Error("This start fee is already paid.");
  if (!paystackOn()) throw new Error("Paystack is not set up, so there is no link to send. Add PAYSTACK_SECRET_KEY in Vercel.");
  const settings = await settingsFor(deps);
  const rec = await sendToShareholder(sub, "pay_link", payLinkEmail(sub, payLink(base, sub, "start"), settings), deps, settings);
  sub.emails.push(rec);
  await deps.store.update(id, { emails: sub.emails });
  if (rec.status === "failed") throw new Error("The email didn't send: " + (rec.error ?? "unknown error"));
  return sub;
}

/** Staff: ask the shareholder for the success fee. They tell us what they received and pay the agreed share. */
export async function requestSuccessFee(id: string, note: string, base: string, deps: Deps): Promise<PilotSubmission> {
  const sub = await deps.store.get(id);
  if (!sub) throw new Error("Submission not found.");
  if (!sub.emails.some((e) => e.kind === "registrar" && e.status === "sent")) throw new Error("These forms haven't gone to a registrar yet, so there is no success fee to ask for.");
  const settings = await settingsFor(deps);
  const link = paystackOn() ? payLink(base, sub, "success") : null;
  const rec = await sendToShareholder(sub, "success_fee", successFeeEmail(sub, link, note, settings), deps, settings);
  sub.emails.push(rec);
  if (rec.status === "failed") {
    await deps.store.update(id, { emails: sub.emails });
    throw new Error("The email didn't send: " + (rec.error ?? "unknown error"));
  }
  const prev = sub.successFee;
  sub.successFee = { requestedAt: rec.at, requests: (prev?.requests ?? 0) + 1, declared: prev?.declared ?? null, fee: prev?.fee ?? null, status: prev?.status === "paid" ? "paid" : "requested", reference: prev?.reference ?? null, paidAt: prev?.paidAt ?? null, via: prev?.via ?? null };
  await deps.store.update(id, { emails: sub.emails, successFee: sub.successFee });
  return sub;
}

export { paystackMode, paystackOn };
