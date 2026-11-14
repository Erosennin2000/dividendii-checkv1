import { withBase } from "@/lib/base";
import { auth } from "@/lib/auth";
import { saveBlob } from "@/lib/forms/client";
import type { PilotSettings } from "./settingsShared";
import type { PilotLeadView, PilotSubmission } from "./types";

const KEY = "dividendii-admin-token";
export const adminToken = {
  get: () => { try { return sessionStorage.getItem(KEY); } catch { return null; } },
  set: (t: string | null) => { try { if (t) sessionStorage.setItem(KEY, t); else sessionStorage.removeItem(KEY); } catch { /* private mode */ } },
};
export class SignedOut extends Error {}

/** Staff sign-in. Returns false when the server doesn't need one (local development). */
export async function adminSignIn(email: string, password: string): Promise<boolean> {
  const res = await fetch(withBase("/api/pilot/admin/login"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? "Couldn't sign in.");
  if (data.open) return false;
  adminToken.set(data.token);
  return true;
}

async function authed(url: string, init: RequestInit = {}) {
  const token = adminToken.get() ?? (auth.idToken ? await auth.idToken() : null);
  const res = await fetch(withBase(url), { ...init, headers: { "content-type": "application/json", ...(init.headers ?? {}), ...(token ? { authorization: `Bearer ${token}` } : {}) } });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) { adminToken.set(null); throw new SignedOut(data?.error ?? "Sign in to continue."); }
    throw new Error(data?.error ?? `Request failed (${res.status}).`);
  }
  return res;
}

export async function listSubmissions(): Promise<PilotSubmission[]> {
  return (await (await authed("/api/pilot/submissions")).json()).submissions;
}

export async function actOnSubmission(id: string, body: { action: "resend" | "chase" | "markPaid" | "markUnpaid" | "note" | "sendPayLink" | "requestSuccessFee" | "markSuccessPaid"; registrarId?: string; note?: string; message?: string; amount?: number | string }): Promise<PilotSubmission> {
  const res = await authed(`/api/pilot/submissions/${id}`, { method: "POST", body: JSON.stringify(body) });
  return (await res.json()).submission;
}

export async function downloadFile(id: string, name: string, filename: string) {
  const res = await authed(`/api/pilot/submissions/${id}/file?name=${encodeURIComponent(name)}`);
  saveBlob(await res.blob(), filename);
}

/** Loads a PDF as a blob URL for the preview pane. The caller revokes it. */
export async function fileUrl(id: string, name: string): Promise<string> {
  const res = await authed(`/api/pilot/submissions/${id}/file?name=${encodeURIComponent(name)}&inline=1`);
  return URL.createObjectURL(await res.blob());
}

const q = (v: string | number) => `"${String(v ?? "").replace(/"/g, '""')}"`;

/** One row per submission, for chasing in a spreadsheet. */
export function submissionsCsv(list: PilotSubmission[]): string {
  const head = ["Reference", "Submitted", "Mode", "Name", "Email", "Phone", "BVN", "Bank", "Account", "Registrars", "Companies", "Payment", "Amount due (NGN)", "Payment status", "Email status", "Address now", "Address at purchase", "Next of kin at purchase", "Note"];
  const rows = list.map((s) => [
    s.ref, s.createdAt, s.mode, `${s.profile.firstName} ${s.profile.surname}`, s.profile.email, s.profile.phone1, s.profile.bvn, s.profile.bankName, s.profile.accountNumber,
    [...new Set(s.holdings.map((h) => h.registrar))].join("; "), s.holdings.map((h) => h.company).join("; "),
    s.payment.method === "pay_ahead" ? "Pay ahead" : "Direct debit after", s.payment.amountDue, s.payment.status, s.sendStatus,
    [s.profile.address, s.profile.city, s.profile.state].filter(Boolean).join(", "), s.atPurchase.address,
    [s.atPurchase.nextOfKinName, s.atPurchase.nextOfKinRelationship, s.atPurchase.nextOfKinPhone].filter(Boolean).join(" / "), s.note,
  ]);
  return [head, ...rows].map((r) => r.map(q).join(",")).join("\n");
}

export async function listLeads(): Promise<PilotLeadView[]> {
  return (await (await authed("/api/pilot/leads")).json()).leads;
}

/** Everyone who started, finished or not, for follow-up. */
export function leadsCsv(list: PilotLeadView[]): string {
  const head = ["Email", "First name", "Surname", "Other names", "Other spellings", "CHN or CSCS", "Started", "Last activity", "Email confirmed", "Sent forms (reference)"];
  const rows = list.map((l) => [l.email, l.firstName, l.surname, l.otherNames, l.variants.join("; "), l.chn, l.createdAt, l.updatedAt, l.verifiedAt ?? "", l.submittedRef ?? ""]);
  return [head, ...rows].map((r) => r.map(q).join(",")).join("\n");
}

export interface SettingsView {
  settings: PilotSettings;
  smtp: { configured: boolean; host: string; user: string; hasPassword: boolean };
  paystack?: "off" | "test" | "live";
  registrars: { id: string; name: string; formEmail: string; companies: number }[];
}

export async function getSettings(): Promise<SettingsView> {
  return (await (await authed("/api/pilot/settings")).json()) as SettingsView;
}

export async function saveSettings(patch: unknown): Promise<SettingsView> {
  return (await (await authed("/api/pilot/settings", { method: "PUT", body: JSON.stringify(patch) })).json()) as SettingsView;
}

export async function sendTestEmail(to: string): Promise<{ from: string; to: string }> {
  return (await (await authed("/api/pilot/settings/test-email", { method: "POST", body: JSON.stringify({ to }) })).json()) as { from: string; to: string };
}
