import type { FormProfile } from "@/lib/forms/types";
import type { PilotRegistrarId } from "./config";

export type PaymentMethod = "debit_after" | "pay_ahead";

/** What the pilot form posts. */
export interface PilotInput {
  profile: FormProfile;
  /** Next of kin and contact details as they were when the shares were bought. */
  atPurchase: {
    address: string;
    phone: string;
    nextOfKinName: string;
    nextOfKinRelationship: string;
    nextOfKinPhone: string;
  };
  /** Other ways the name was written on the register. */
  variants: string[];
  holdings: { registrarId: PilotRegistrarId; company: string }[];
  photo: string | null;
  signature: string | null;
  payment: { method: PaymentMethod; acknowledged: boolean };
  consent: boolean;
  /** Honeypot. Real people leave it empty. */
  website?: string;
}

export type EmailStatus = "sent" | "failed";

export interface EmailRecord {
  kind: "registrar" | "confirmation" | "chase" | "pay_link" | "success_fee" | "receipt";
  registrarId?: PilotRegistrarId;
  /** Where it was actually delivered. */
  to: string;
  /** In test mode the registrar's real address, which we did not use. */
  wouldHaveGoneTo?: string;
  status: EmailStatus;
  error?: string;
  messageId?: string;
  at: string;
}

export interface StoredFile {
  /** "forms-coronation", "authority-first" ... */
  name: string;
  registrarId: PilotRegistrarId;
  kind: "mandate" | "authority";
  /** Storage path (Firebase) or in-memory key. */
  path: string;
  filename: string;
}

/** "queued": saved, emails not sent yet. "sending": being sent right now. */
export type SendStatus = "queued" | "sending" | "sent" | "partial" | "failed";
export type PaymentStatus = "debit_pending" | "awaiting_payment" | "paid";

export interface PilotSubmission {
  id: string;
  ref: string;
  createdAt: string;
  mode: "test" | "live";
  /** The verified lead this submission came from. */
  leadId: string;
  profile: FormProfile;
  atPurchase: PilotInput["atPurchase"];
  variants: string[];
  holdings: { registrarId: PilotRegistrarId; registrar: string; company: string }[];
  /** Per registrar: what got ticked on the form and what the registrar must add by hand. */
  forms: { registrarId: PilotRegistrarId; registrar: string; ticked: string[]; unlisted: string[]; warnings: string[] }[];
  payment: {
    method: PaymentMethod; amountDue: number; status: PaymentStatus; paidAt: string | null;
    /** Latest Paystack reference for the start fee, and how it was paid. Absent on older records. */
    reference?: string | null; channel?: string | null; gatewayId?: number | null;
    /** "paystack": confirmed by Paystack. "manual": staff marked it paid. */
    via?: "paystack" | "manual" | null;
  };
  /** The success fee: asked for by email once we believe the registrar has paid. Trust-based. */
  successFee?: SuccessFee;
  /** Staff updates per registrar, shown to the shareholder in their account. Newest last. */
  progress?: ProgressEntry[];
  /** A line from staff that the shareholder sees at the top of this submission in their account. */
  customerMessage?: string;
  consentAt: string;
  files: StoredFile[];
  emails: EmailRecord[];
  sendStatus: SendStatus;
  note: string;
}

/** Where a claim stands with one registrar, as staff record it. "sent" is automatic and never set by hand. */
export type ProgressStatus = "replied" | "more_info" | "money_found" | "paid" | "nothing_found" | "closed";
export const PROGRESS_LABEL: Record<ProgressStatus, string> = {
  replied: "Registrar replied",
  more_info: "Registrar needs more from you",
  money_found: "Registrar confirmed money in your name",
  paid: "Paid into your bank account",
  nothing_found: "No unclaimed money found",
  closed: "Closed",
};
export interface ProgressEntry {
  registrarId: PilotRegistrarId;
  status: ProgressStatus;
  /** Shown to the shareholder. */
  note: string;
  at: string;
}

/** Feedback from an account holder. Staff read it on the admin page. */
export interface PilotFeedback {
  id: string;
  at: string;
  leadId: string;
  email: string;
  name: string;
  /** Where they were: their account, or the investing demo. */
  page: "account" | "demo";
  /** 1 to 5, optional. */
  rating: number | null;
  message: string;
  readAt: string | null;
}

export interface SuccessFee {
  /** When staff last asked, and how many times. */
  requestedAt: string | null;
  requests: number;
  /** What the shareholder told us they received, and the fee worked out from it. Naira. */
  declared: number | null;
  fee: number | null;
  status: "requested" | "paid";
  reference?: string | null;
  paidAt: string | null;
  via?: "paystack" | "manual" | null;
}

/** The list view leaves out the heavy parts. */
export type PilotSummary = Omit<PilotSubmission, "files">;

/**
 * Saved the moment someone finishes step 1, before they have done anything else, so you can follow up with
 * people who start and stop. One per email address.
 */
export interface PilotLead {
  id: string;
  email: string;
  firstName: string;
  surname: string;
  otherNames: string;
  variants: string[];
  /** CHN or CSCS number, as typed. May be empty. */
  chn: string;
  createdAt: string;
  updatedAt: string;
  verifiedAt: string | null;
  /** SHA-256 of the current code. Never shown to staff. */
  codeHash: string | null;
  codeExpires: string | null;
  attempts: number;
  /** Reference of the latest submission, once they have sent their forms. */
  submittedRef: string | null;
  /** The account. It exists from the moment the email is confirmed; a password is added on the next visit. */
  passwordHash?: string | null;
  passwordSetAt?: string | null;
  /** Bumped on every password change, which signs out every other session. */
  sessionVersion?: number;
  lastSignInAt?: string | null;
  /** When they asked to hear when investing opens. */
  investWaitlistAt?: string | null;
}

/** What staff see: the lead without its code or password. */
export type PilotLeadView = Omit<PilotLead, "codeHash" | "codeExpires" | "attempts" | "passwordHash" | "sessionVersion"> & { hasPassword: boolean };
