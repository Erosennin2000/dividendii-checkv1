import { withBase } from "@/lib/base";
import { saveBlob } from "@/lib/forms/client";
import type { PilotSettings } from "./settingsShared";
import type { PilotFeedback, PilotLeadView, PilotSubmission } from "./types";

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
  const token = adminToken.get();
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

export async function actOnSubmission(id: string, body: { action: "resend" | "chase" | "markPaid" | "markUnpaid" | "note" | "sendPayLink" | "requestSuccessFee" | "markSuccessPaid" | "addProgress" | "removeProgress" | "customerMessage"; registrarId?: string; note?: string; message?: string; amount?: number | string; status?: string; index?: number }): Promise<PilotSubmission> {
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

/** Pulls one whole table from the server, a page at a time (each page is small enough for Vercel's reply limit). */
async function pullAll<T>(kind: "submissions" | "leads" | "feedback"): Promise<T[]> {
  const out: T[] = [];
  let offset: number | null = 0;
  while (offset !== null) {
    const j: { rows: T[]; next: number | null } = await (await authed(`/api/pilot/export?kind=${kind}&offset=${offset}`)).json();
    out.push(...j.rows);
    offset = j.next;
  }
  return out;
}

export interface Backup { exportedAt: string; counts: Record<string, number>; submissions: PilotSubmission[]; leads: PilotLeadView[]; feedback: PilotFeedback[]; settings: unknown; pdfs: PdfEntry[] }
export interface PdfEntry { reference: string; submissionId: string; name: string; email: string; registrar: string; kind: string; filename: string; storagePath: string }

/** Every record we hold plus the list of PDFs (the PDFs themselves stay in Supabase Storage). */
export async function buildBackup(): Promise<Backup> {
  const [submissions, leads, feedback, settings] = await Promise.all([
    pullAll<PilotSubmission>("submissions"), pullAll<PilotLeadView>("leads"), pullAll<PilotFeedback>("feedback"),
    authed("/api/pilot/export?kind=settings").then(async (r) => ((await r.json()).rows as unknown[])[0] ?? {}),
  ]);
  const pdfs: PdfEntry[] = submissions.flatMap((s) => (s.files ?? []).map((f) => ({
    reference: s.ref, submissionId: s.id, name: `${s.profile.firstName} ${s.profile.surname}`, email: s.profile.email,
    registrar: f.registrarId, kind: f.kind, filename: f.filename, storagePath: f.path,
  })));
  return { exportedAt: new Date().toISOString(), counts: { submissions: submissions.length, leads: leads.length, feedback: feedback.length, pdfs: pdfs.length }, submissions, leads, feedback, settings, pdfs };
}

const qq = (v: string | number) => `"${String(v ?? "").replace(/"/g, '""')}"`;
export function pdfListCsv(pdfs: PdfEntry[]): string {
  const head = ["Reference", "Name", "Email", "Registrar", "Form", "File name", "Storage path"];
  return [head, ...pdfs.map((p) => [p.reference, p.name, p.email, p.registrar, p.kind, p.filename, p.storagePath])].map((r) => r.map(qq).join(",")).join("\r\n");
}

/** Downloads the full backup file and a spreadsheet list of the PDFs. Returns the counts for the message. */
export async function downloadBackup(): Promise<Backup["counts"]> {
  const b = await buildBackup();
  const day = b.exportedAt.slice(0, 10);
  saveBlob(new Blob([JSON.stringify(b, null, 2)], { type: "application/json" }), `dividendii-backup-${day}.json`);
  await new Promise((r) => setTimeout(r, 700));
  saveBlob(new Blob([pdfListCsv(b.pdfs)], { type: "text/csv" }), `dividendii-pdf-list-${day}.csv`);
  return b.counts;
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

export async function listFeedback(): Promise<PilotFeedback[]> {
  return (await (await authed("/api/pilot/feedback")).json()).feedback;
}
export async function markFeedback(id: string, read: boolean): Promise<PilotFeedback> {
  return (await (await authed("/api/pilot/feedback", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, read }) })).json()).feedback;
}
export function feedbackCsv(list: PilotFeedback[]): string {
  const head = ["Received", "Name", "Email", "Where", "Rating (1-5)", "Message", "Read"];
  return [head, ...list.map((f) => [f.at, f.name, f.email, f.page, f.rating ?? "", f.message, f.readAt ?? ""])].map((r) => r.map(q).join(",")).join("\n");
}

export async function listLeads(): Promise<PilotLeadView[]> {
  return (await (await authed("/api/pilot/leads")).json()).leads;
}

/** Everyone who started, finished or not, for follow-up. */
export function leadsCsv(list: PilotLeadView[]): string {
  const head = ["Email", "First name", "Surname", "Other names", "Other spellings", "CHN or CSCS", "Started", "Last activity", "Email confirmed", "Sent forms (reference)", "Password set", "Last sign-in", "Investing waitlist"];
  const rows = list.map((l) => [l.email, l.firstName, l.surname, l.otherNames, l.variants.join("; "), l.chn, l.createdAt, l.updatedAt, l.verifiedAt ?? "", l.submittedRef ?? "", l.passwordSetAt ?? "", l.lastSignInAt ?? "", l.investWaitlistAt ?? ""]);
  return [head, ...rows].map((r) => r.map(q).join(",")).join("\n");
}

export interface SettingsView {
  settings: PilotSettings;
  smtp: { configured: boolean; host: string; user: string; hasPassword: boolean };
  paystack?: "off" | "test" | "live";
  monnify?: "off" | "sandbox" | "live";
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

export interface MonnifyCheck {
  mode: "off" | "sandbox" | "live"; ok: boolean; message?: string; base?: string; monnifyBanks?: number; ours?: number; matched?: number;
  unmatched?: string[]; unmatchedDetail?: { name: string; near: { name: string; code: string }[] }[];
}
export async function checkMonnify(): Promise<MonnifyCheck> {
  return (await (await authed("/api/pilot/monnify-check")).json()) as MonnifyCheck;
}

export interface MonnifyTry {
  verdict: "found" | "not_found" | "unavailable"; name?: string; note: string; httpStatus?: number; monnifyMessage?: string;
  bankMatch: { code: string; name: string; confidence: "exact" | "fuzzy" } | null; mode: "off" | "sandbox" | "live"; base: string;
}
export async function tryMonnifyAccount(bank: string, accountNumber: string): Promise<MonnifyTry> {
  return (await (await authed("/api/pilot/monnify-check", { method: "POST", body: JSON.stringify({ bank, accountNumber }) })).json()) as MonnifyTry;
}
