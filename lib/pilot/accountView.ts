import "server-only";
import { pilotRegistrar } from "./config";
import { payLink } from "./pay";
import { paystackOn } from "./paystack";
import { PROGRESS_LABEL, type PilotLead, type PilotSubmission, type ProgressStatus } from "./types";

/** Shows only the last four characters. "••••4718". */
export const lastFour = (v: string | null | undefined) => {
  const t = String(v ?? "").replace(/\s/g, "");
  return t ? "••••" + t.slice(-4) : "";
};

export interface Step { label: string; at: string | null; done: boolean; tone?: "good" | "warn" | "bad"; note?: string }

/** One registrar's timeline: automatic steps first, then whatever staff recorded. */
function registrarSteps(s: PilotSubmission, registrarId: string): { steps: Step[]; current: string } {
  const sent = s.emails.find((e) => e.kind === "registrar" && e.registrarId === registrarId && e.status === "sent");
  const steps: Step[] = [
    { label: "Forms completed and signed", at: s.createdAt, done: true },
    { label: "Start fee paid", at: s.payment.paidAt, done: s.payment.status === "paid" || s.payment.method !== "pay_ahead" },
    { label: "Sent to the registrar", at: sent?.at ?? null, done: !!sent },
  ];
  const tone: Record<ProgressStatus, Step["tone"]> = { replied: undefined, more_info: "warn", money_found: "good", paid: "good", nothing_found: "bad", closed: undefined };
  for (const p of (s.progress ?? []).filter((x) => x.registrarId === registrarId)) {
    steps.push({ label: PROGRESS_LABEL[p.status], at: p.at, done: true, tone: tone[p.status], note: p.note || undefined });
  }
  const last = [...steps].reverse().find((x) => x.done)!;
  if (!sent) steps.push({ label: "Waiting for the registrar to reply", at: null, done: false });
  else if (!(s.progress ?? []).some((x) => x.registrarId === registrarId && ["paid", "nothing_found", "closed"].includes(x.status))) {
    steps.push({ label: "Waiting for the registrar", at: null, done: false });
  }
  return { steps, current: last.label };
}

/** Everything the account page shows. Sensitive numbers are cut to their last four. No photo, no signature, no full BVN. */
export function accountView(lead: PilotLead, subs: PilotSubmission[], base: string) {
  return {
    account: {
      firstName: lead.firstName, surname: lead.surname, email: lead.email,
      chn: lastFour(lead.chn), hasPassword: !!lead.passwordHash,
      memberSince: lead.createdAt, waitlist: lead.investWaitlistAt ?? null,
    },
    submissions: subs.map((s) => {
      const regs = [...new Set(s.holdings.map((h) => h.registrarId))];
      return {
        ref: s.ref, createdAt: s.createdAt, test: s.mode === "test",
        message: s.customerMessage?.trim() || null,
        registrars: regs.map((rid) => ({
          id: rid, name: pilotRegistrar(rid)?.name ?? rid,
          companies: s.holdings.filter((h) => h.registrarId === rid).map((h) => h.company),
          ...registrarSteps(s, rid),
        })),
        fees: {
          start: { amount: s.payment.method === "pay_ahead" ? s.payment.amountDue : 0, paid: s.payment.status === "paid", paidAt: s.payment.paidAt },
          success: s.successFee ? { status: s.successFee.status, fee: s.successFee.fee, declared: s.successFee.declared } : null,
          payStartLink: s.payment.method === "pay_ahead" && s.payment.status !== "paid" && paystackOn() ? payLink(base, s, "start") : null,
          paySuccessLink: s.successFee && s.successFee.status !== "paid" && paystackOn() ? payLink(base, s, "success") : null,
        },
        details: {
          name: [s.profile.firstName, s.profile.otherNames, s.profile.surname].filter((x) => x?.trim()).join(" "),
          otherNames: s.variants,
          email: s.profile.email,
          phone: lastFour(s.profile.phone1),
          bvn: lastFour(s.profile.bvn),
          bank: s.profile.bankName,
          account: lastFour(s.profile.accountNumber),
          address: [s.profile.address, s.profile.city, s.profile.state].filter((x) => x?.trim()).join(", "),
          chn: lastFour(s.profile.chn),
          addressThen: s.atPurchase.address,
          nextOfKin: [s.atPurchase.nextOfKinName, s.atPurchase.nextOfKinRelationship].filter(Boolean).join(", "),
        },
      };
    }),
  };
}
export type AccountView = ReturnType<typeof accountView>;
