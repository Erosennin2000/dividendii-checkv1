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
  kind: "registrar" | "confirmation" | "chase";
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
  payment: { method: PaymentMethod; amountDue: number; status: PaymentStatus; paidAt: string | null };
  consentAt: string;
  files: StoredFile[];
  emails: EmailRecord[];
  sendStatus: SendStatus;
  note: string;
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
}

/** What staff see: the lead without its code. */
export type PilotLeadView = Omit<PilotLead, "codeHash" | "codeExpires" | "attempts">;
