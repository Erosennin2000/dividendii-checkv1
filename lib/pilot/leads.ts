import "server-only";
import { createHash, randomInt } from "node:crypto";
import { isEmail } from "@/lib/domain/validation";
import { effectiveSettings } from "./settings";
import { pilotEnv, type Mailer } from "./mail";
import type { PilotStore } from "./store";
import { clean } from "./text";
import { signToken } from "./token";
import type { PilotLead, PilotLeadView } from "./types";
import { PilotValidationError } from "./validate";

export const DEMO_CODE = "123456";
const CODE_TTL_MS = 15 * 60_000;
const MAX_ATTEMPTS = 5;

/**
 * Demo mode (the default) uses the code 123456 and sends nothing. Set PILOT_OTP=email to email a random code.
 */
export const otpMode = (): "demo" | "email" => (process.env.PILOT_OTP === "email" ? "email" : "demo");

const hash = (code: string, leadId: string) => createHash("sha256").update(`${leadId}:${code}`).digest("hex");
export const leadIdFor = (email: string) => createHash("sha256").update(email.trim().toLowerCase()).digest("hex").slice(0, 24);

export interface StartInput {
  firstName: string; surname: string; otherNames: string; variants: string[]; email: string; chn: string;
}

export function parseStart(raw: unknown): StartInput {
  const b = (raw ?? {}) as Record<string, unknown>;
  const out: StartInput = {
    firstName: clean(b.firstName, 80), surname: clean(b.surname, 80), otherNames: clean(b.otherNames, 80),
    email: clean(b.email, 160).toLowerCase(), chn: clean(b.chn, 30).toUpperCase().replace(/\s/g, ""),
    variants: (Array.isArray(b.variants) ? b.variants : []).map((v) => clean(v, 120)).filter(Boolean).slice(0, 10),
  };
  const p: string[] = [];
  if (!out.firstName) p.push("your first name");
  if (!out.surname) p.push("your surname");
  if (!isEmail(out.email)) p.push("a valid email address");
  if (p.length) throw new PilotValidationError([`Still needed: ${p.join(", ")}.`]);
  return out;
}

/** Saves what they've told us so far and sends (or fixes) the code. Returns the lead id; nothing sensitive. */
export async function startLead(input: StartInput, deps: { store: PilotStore; mailer: Mailer; now?: () => Date }) {
  const now = deps.now?.() ?? new Date();
  const id = leadIdFor(input.email);
  const prev = await deps.store.getLead(id);
  const code = otpMode() === "demo" ? DEMO_CODE : String(randomInt(100000, 1000000));
  const lead: PilotLead = {
    ...(prev ?? {}), // keeps the account: password, sessions, waitlist
    id, email: input.email, firstName: input.firstName, surname: input.surname, otherNames: input.otherNames, variants: input.variants,
    chn: input.chn, createdAt: prev?.createdAt ?? now.toISOString(), updatedAt: now.toISOString(),
    verifiedAt: prev?.verifiedAt ?? null, codeHash: hash(code, id), codeExpires: new Date(now.getTime() + CODE_TTL_MS).toISOString(), attempts: 0,
    submittedRef: prev?.submittedRef ?? null,
  };
  await deps.store.saveLead(lead);
  if (otpMode() === "email") {
    const settings = effectiveSettings(await deps.store.getSettings());
    const env = pilotEnv(settings);
    const PILOT_BRAND = settings.brandName;
    await deps.mailer.send({
      from: env.from, to: input.email, replyTo: env.replyTo || undefined,
      subject: `Your ${PILOT_BRAND} code: ${code}`,
      text: `Hello ${input.firstName},\n\nYour ${PILOT_BRAND} code is ${code}. It works for 15 minutes.\n\nIf you didn't ask for it, ignore this email.\n\n${PILOT_BRAND}`,
      html: `<div style="font-family:Arial,sans-serif;font-size:15px;color:#17375A"><p>Hello ${input.firstName.replace(/[<>&]/g, "")},</p><p>Your ${PILOT_BRAND} code is</p><p style="font-size:28px;font-weight:700;letter-spacing:4px">${code}</p><p>It works for 15 minutes. If you didn't ask for it, ignore this email.</p><p>${PILOT_BRAND}</p></div>`,
    });
  }
  return { leadId: id, demo: otpMode() === "demo" };
}

/** Checks the code. Five wrong tries and they must ask for a new one. */
export async function verifyLead(leadId: string, code: string, deps: { store: PilotStore; now?: () => Date }): Promise<{ token: string; email: string }> {
  const now = deps.now?.() ?? new Date();
  const lead = await deps.store.getLead(String(leadId));
  if (!lead || !lead.codeHash) throw new PilotValidationError(["Ask for a new code and try again."]);
  if (lead.attempts >= MAX_ATTEMPTS) throw new PilotValidationError(["Too many wrong codes. Go back and ask for a new one."]);
  if (!lead.codeExpires || new Date(lead.codeExpires) < now) throw new PilotValidationError(["That code has expired. Go back and ask for a new one."]);
  if (hash(clean(code, 12), lead.id) !== lead.codeHash) {
    await deps.store.saveLead({ ...lead, attempts: lead.attempts + 1, updatedAt: now.toISOString() });
    throw new PilotValidationError(["That isn't the right code. Check it and try again."]);
  }
  await deps.store.saveLead({ ...lead, verifiedAt: now.toISOString(), codeHash: null, codeExpires: null, attempts: 0, updatedAt: now.toISOString() });
  return { token: signToken(lead.id, lead.email, now.getTime()), email: lead.email };
}

export const leadView = ({ codeHash: _h, codeExpires: _e, attempts: _a, passwordHash, sessionVersion: _v, ...rest }: PilotLead): PilotLeadView => ({ ...rest, hasPassword: !!passwordHash }); // eslint-disable-line @typescript-eslint/no-unused-vars
