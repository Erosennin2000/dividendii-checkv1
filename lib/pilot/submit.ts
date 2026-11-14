import "server-only";
import { randomBytes } from "node:crypto";
import { dataUrlBytes, fillForms } from "@/lib/forms/fill";
import type { FormProfile } from "@/lib/forms/types";
import { buildAuthorityLetter } from "./authority";
import { PILOT_REGISTRARS, pilotRegistrar, type PilotRegistrarId } from "./config";
import { effectiveSettings } from "./settings";
import type { PilotSettings } from "./settingsShared";
import { chaseEmail, confirmationEmail, pilotEnv, registrarEmail, type Mailer } from "./mail";
import type { PilotStore } from "./store";
import { pdfSafe } from "./text";
import type { EmailRecord, PilotInput, PilotSubmission, SendStatus, StoredFile } from "./types";

export interface Deps {
  store: PilotStore;
  mailer: Mailer;
  now?: () => Date;
  /** The verified lead this submission belongs to. Set by the route after it checks the token. */
  leadId?: string;
  /** The effective settings. Left out, they are read from the store so a change on the admin page applies to the next send. */
  settings?: PilotSettings;
}

export async function settingsFor(deps: Deps): Promise<PilotSettings> {
  return deps.settings ?? effectiveSettings(await deps.store.getSettings());
}

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
function newRef(): string {
  const b = randomBytes(6);
  return "DVD-" + [...b].map((x) => ALPHABET[x % ALPHABET.length]).join("");
}

function safeProfile(p: FormProfile): FormProfile {
  return Object.fromEntries(Object.entries(p).map(([k, v]) => [k, pdfSafe(String(v ?? ""))])) as unknown as FormProfile;
}

export function sendStatusOf(s: Pick<PilotSubmission, "holdings" | "emails">): "sent" | "partial" | "failed" {
  const ids = [...new Set(s.holdings.map((h) => h.registrarId))];
  const ok = ids.filter((id) => {
    const last = [...s.emails].reverse().find((e) => e.kind === "registrar" && e.registrarId === id);
    return last?.status === "sent";
  });
  return ok.length === ids.length ? "sent" : ok.length ? "partial" : "failed";
}

/** Sends one registrar's email with its two PDFs. Never throws: the outcome is the record. */
async function sendToRegistrar(sub: PilotSubmission, registrarId: PilotRegistrarId, deps: Deps, settings: PilotSettings, chase?: { note: string }): Promise<EmailRecord> {
  const env = pilotEnv(settings);
  const reg = pilotRegistrar(registrarId)!;
  const at = (deps.now?.() ?? new Date()).toISOString();
  const live = sub.mode === "live";
  const regEmail = settings.registrars[registrarId]?.email || reg.email;
  const to = live ? regEmail : env.testInbox;
  const base: EmailRecord = { kind: chase ? "chase" : "registrar", registrarId, to, status: "failed", at, ...(live ? {} : { wouldHaveGoneTo: regEmail }) };
  try {
    if (!to) throw new Error("No test inbox is set, so there is nowhere to send test emails. Add one under Settings.");
    const files = sub.files.filter((f) => f.registrarId === registrarId);
    const attachments = await Promise.all(files.map(async (f) => ({ filename: f.filename, content: await deps.store.readFile(f.path), contentType: "application/pdf" })));
    const body = chase ? chaseEmail(sub, registrarId, chase.note, settings) : registrarEmail(sub, registrarId, settings);
    const banner = live ? "" : `TEST MODE: this would have gone to ${regEmail}. It was sent to ${to} instead.\n\n`;
    const res = await deps.mailer.send({
      from: env.from, to,
      bcc: live && env.admin && env.admin !== to ? env.admin : undefined,
      replyTo: env.replyTo || undefined,
      subject: (live ? "" : `[TEST, would go to ${regEmail}] `) + body.subject,
      text: banner + body.text,
      html: (live ? "" : `<p style="background:#fff4d6;padding:8px 12px;border-radius:6px"><b>TEST MODE:</b> this would have gone to ${regEmail}. It was sent to ${to} instead.</p>`) + body.html,
      attachments,
    });
    return { ...base, status: "sent", messageId: res.messageId };
  } catch (e) {
    console.error("[pilot] registrar email failed", sub.ref, registrarId, e);
    return { ...base, status: "failed", error: e instanceof Error ? e.message.slice(0, 300) : "Send failed." };
  }
}

async function sendConfirmation(sub: PilotSubmission, deps: Deps, settings: PilotSettings): Promise<EmailRecord> {
  const env = pilotEnv(settings);
  const at = (deps.now?.() ?? new Date()).toISOString();
  const base: EmailRecord = { kind: "confirmation", to: sub.profile.email, status: "failed", at };
  try {
    const body = confirmationEmail(sub, settings);
    const res = await deps.mailer.send({ from: env.from, to: sub.profile.email, replyTo: env.replyTo || undefined, ...body });
    return { ...base, status: "sent", messageId: res.messageId };
  } catch (e) {
    console.error("[pilot] confirmation email failed", sub.ref, e);
    return { ...base, status: "failed", error: e instanceof Error ? e.message.slice(0, 300) : "Send failed." };
  }
}

/**
 * Step one of a submission: fill each registrar's form, write the authority letter, save the record and PDFs.
 * Nothing is emailed here, so this returns fast and the record is in the admin page straight away.
 * dispatchPilot does the sending.
 */
export async function createPilot(input: PilotInput, deps: Deps): Promise<PilotSubmission> {
  const settings = await settingsFor(deps);
  const env = pilotEnv(settings);
  const now = deps.now?.() ?? new Date();
  const id = randomBytes(12).toString("hex");
  const ref = newRef();
  const profile = safeProfile(input.profile);
  const at = {
    address: pdfSafe(input.atPurchase.address), phone: pdfSafe(input.atPurchase.phone),
    nextOfKinName: pdfSafe(input.atPurchase.nextOfKinName), nextOfKinRelationship: pdfSafe(input.atPurchase.nextOfKinRelationship),
    nextOfKinPhone: pdfSafe(input.atPurchase.nextOfKinPhone),
  };
  const photo = dataUrlBytes(input.photo);
  const signature = dataUrlBytes(input.signature);

  const registrarIds = PILOT_REGISTRARS.map((r) => r.id).filter((rid) => input.holdings.some((h) => h.registrarId === rid));
  const files: StoredFile[] = [];
  const blobs: { path: string; bytes: Uint8Array; contentType: string }[] = [];
  const forms: PilotSubmission["forms"] = [];
  for (const rid of registrarIds) {
    const reg = pilotRegistrar(rid)!;
    const companies = input.holdings.filter((h) => h.registrarId === rid).map((h) => h.company);
    const { pdf, forms: filled } = await fillForms(profile, companies.map((company) => ({ registrarId: rid, company })), { photo, signature });
    const authority = await buildAuthorityLetter({ registrar: reg.name, ref, profile, atPurchase: at, variants: input.variants.map(pdfSafe), companies, signature, replyTo: env.replyTo, brand: settings.brandName, now });
    const mandateName = `Mandate-${reg.name.split(" ")[0]}-${ref}.pdf`;
    const authorityName = `Letter-of-authority-${reg.name.split(" ")[0]}-${ref}.pdf`;
    for (const [kind, filename, bytes] of [["mandate", mandateName, pdf], ["authority", authorityName, authority]] as const) {
      const path = `pilot-submissions/${id}/${filename}`;
      files.push({ name: `${kind}-${rid}`, registrarId: rid, kind, path, filename });
      blobs.push({ path, bytes, contentType: "application/pdf" });
    }
    const f = filled[0];
    forms.push({ registrarId: rid, registrar: reg.name, ticked: f.ticked, unlisted: f.unlisted, warnings: f.warnings.map((w) => w.message) });
  }

  const n = input.holdings.length;
  const sub: PilotSubmission = {
    id, ref, createdAt: now.toISOString(), mode: env.mode, leadId: deps.leadId ?? "",
    profile: input.profile, atPurchase: input.atPurchase, variants: input.variants, // the originals, exactly as typed
    holdings: input.holdings.map((h) => ({ ...h, registrar: pilotRegistrar(h.registrarId)!.name })),
    forms,
    // One fee model: a start fee per company plus VAT, paid before the forms go out; a success fee is asked for later.
    payment: { method: "pay_ahead", amountDue: Math.round(n * settings.payAheadPerCompany * 1.075 * 100) / 100, status: "awaiting_payment", paidAt: null },
    consentAt: now.toISOString(),
    files, emails: [], sendStatus: "queued", note: "",
  };
  await deps.store.save(sub, blobs);
  if (deps.leadId) {
    const lead = await deps.store.getLead(deps.leadId);
    if (lead) await deps.store.saveLead({ ...lead, submittedRef: ref, updatedAt: now.toISOString() });
  }
  return sub;
}

/** Sends every registrar's email at once, then the confirmation. Safe to call twice: only a queued submission is sent. */
export async function dispatchPilot(id: string, deps: Deps): Promise<PilotSubmission> {
  const sub = await deps.store.get(id);
  if (!sub) throw new Error("Submission not found.");
  if (sub.sendStatus !== "queued") return sub;
  sub.sendStatus = "sending";
  await deps.store.update(id, { sendStatus: "sending" });
  const settings = await settingsFor(deps);
  const ids = [...new Set(sub.holdings.map((h) => h.registrarId))];
  // Registrar emails read their PDFs back from the store: the same path a later "resend" takes. All go out together.
  sub.emails.push(...(await Promise.all(ids.map((rid) => sendToRegistrar(sub, rid, deps, settings)))));
  sub.sendStatus = sendStatusOf(sub);
  if (sub.sendStatus !== "failed") sub.emails.push(await sendConfirmation(sub, deps, settings));
  await deps.store.update(id, { emails: sub.emails, sendStatus: sub.sendStatus });
  return sub;
}

/** Everything in one go (tests, scripts): create the record, then send. */
export async function submitPilot(input: PilotInput, deps: Deps): Promise<PilotSubmission> {
  const sub = await createPilot(input, deps);
  return dispatchPilot(sub.id, deps);
}

/** Admin retry. With no registrar named, resends every registrar whose latest email failed. */
export async function resendPilot(id: string, registrarId: string | null, deps: Deps): Promise<PilotSubmission> {
  const sub = await deps.store.get(id);
  if (!sub) throw new Error("Submission not found.");
  const settings = await settingsFor(deps);
  const ids = [...new Set(sub.holdings.map((h) => h.registrarId))];
  const targets = registrarId
    ? ids.filter((r) => r === registrarId)
    : ids.filter((r) => [...sub.emails].reverse().find((e) => e.kind === "registrar" && e.registrarId === r)?.status !== "sent");
  if (!targets.length) throw new Error(registrarId ? "That registrar isn't on this submission." : "Every email went through. Pick a registrar to send it again.");
  sub.emails.push(...(await Promise.all(targets.map((rid) => sendToRegistrar(sub, rid, deps, settings)))));
  sub.sendStatus = sendStatusOf(sub);
  const hadConfirmation = sub.emails.some((e) => e.kind === "confirmation" && e.status === "sent");
  if (sub.sendStatus !== "failed" && !hadConfirmation) sub.emails.push(await sendConfirmation(sub, deps, settings));
  await deps.store.update(id, { emails: sub.emails, sendStatus: sub.sendStatus });
  return sub;
}

/** Staff follow-up to one registrar: a short chase email with both PDFs attached again. */
export async function chasePilot(id: string, registrarId: string, note: string, deps: Deps): Promise<PilotSubmission> {
  const sub = await deps.store.get(id);
  if (!sub) throw new Error("Submission not found.");
  const rid = PILOT_REGISTRARS.map((r) => r.id).find((r) => r === registrarId && sub.holdings.some((h) => h.registrarId === r));
  if (!rid) throw new Error("That registrar isn't on this submission.");
  if (!sub.emails.some((e) => e.kind === "registrar" && e.registrarId === rid && e.status === "sent")) throw new Error("The first email to this registrar hasn't gone yet. Use Send first, then chase.");
  sub.emails.push(await sendToRegistrar(sub, rid, deps, await settingsFor(deps), { note }));
  await deps.store.update(id, { emails: sub.emails });
  return sub;
}
