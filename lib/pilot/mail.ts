import { accountUrl, nairaExact } from "./../site";
import "server-only";
import { naira } from "@/lib/domain/fees";
import { pilotRegistrar } from "./config";
import { defaultSettings, fromHeader } from "./settings";
import type { PilotSettings } from "./settingsShared";
import type { PilotSubmission } from "./types";

export interface MailAttachment { filename: string; content: Uint8Array; contentType: string }
export interface MailMessage {
  from: string;
  to: string;
  bcc?: string;
  replyTo?: string;
  subject: string;
  text: string;
  html: string;
  attachments?: MailAttachment[];
}
export interface Mailer { send(m: MailMessage): Promise<{ messageId?: string }> }

/**
 * The sending-side settings in one shape. With no argument it reads the environment (the defaults);
 * the real send path passes the effective settings, which include whatever the admin saved.
 */
export function pilotEnv(settings: PilotSettings = defaultSettings()) {
  return {
    mode: settings.mode,
    from: fromHeader(settings),
    admin: settings.adminCopy,
    /** In test mode every registrar email lands here instead. */
    testInbox: settings.testInbox || settings.adminCopy,
    replyTo: settings.replyTo || settings.adminCopy,
    pay: settings.payment,
  };
}

let override: Mailer | null = null;
/** Tests hand in a fake mailer. */
export const setMailerForTests = (m: Mailer | null) => { override = m; };

/** SMTP through nodemailer. With no SMTP_HOST, local dev just logs the message; a production deployment fails loudly. */
export function getMailer(): Mailer {
  if (override) return override;
  const host = process.env.SMTP_HOST?.trim();
  if (!host) {
    if (process.env.NODE_ENV !== "production") {
      return {
        async send(m) {
          console.log(`[pilot mail, not delivered: SMTP_HOST is not set] to=${m.to} subject="${m.subject}" attachments=${(m.attachments ?? []).map((a) => a.filename).join(", ")}`);
          return { messageId: "dev-not-delivered" };
        },
      };
    }
    throw Object.assign(new Error("SMTP is not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER and SMTP_PASS."), { code: "config/smtp" });
  }
  return {
    async send(m) {
      const nodemailer = await import("nodemailer");
      const port = Number(process.env.SMTP_PORT ?? 587);
      const transport = nodemailer.createTransport({
        host, port, secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === "true" : port === 465,
        auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
      });
      const info = await transport.sendMail({
        from: m.from, to: m.to, bcc: m.bcc, replyTo: m.replyTo, subject: m.subject, text: m.text, html: m.html,
        attachments: (m.attachments ?? []).map((a) => ({ filename: a.filename, content: Buffer.from(a.content), contentType: a.contentType })),
      });
      return { messageId: info.messageId };
    },
  };
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const fullName = (s: PilotSubmission) => [s.profile.firstName, s.profile.otherNames, s.profile.surname].filter((x) => x.trim()).join(" ");

function shell(body: string) {
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.55;color:#1c2330;max-width:620px">${body}</div>`;
}

/** The email a registrar receives: the shareholder's details and holdings in the body, mandate form and authority letter attached. */
export function registrarEmail(s: PilotSubmission, registrarId: string, settings: PilotSettings = defaultSettings()): Pick<MailMessage, "subject" | "text" | "html"> {
  const BRAND = settings.brandName;
  const note = settings.registrarNote.trim();
  const reg = pilotRegistrar(registrarId)!;
  const form = s.forms.find((f) => f.registrarId === registrarId);
  const companies = s.holdings.filter((h) => h.registrarId === registrarId).map((h) => h.company);
  const name = fullName(s);
  const a = s.atPurchase;
  const kin = [a.nextOfKinName, a.nextOfKinRelationship && `(${a.nextOfKinRelationship})`, a.nextOfKinPhone].filter(Boolean).join(" ");
  const byHand = form?.unlisted ?? [];

  const subject = `E-dividend mandate and letter of authority: ${s.profile.surname.toUpperCase()} ${s.profile.firstName} (${companies.length} ${companies.length === 1 ? "holding" : "holdings"}) [${s.ref}]`;

  const lines = [
    `Dear ${reg.name},`,
    ``,
    `${BRAND} is sending this on behalf of ${name.toUpperCase()}, who holds shares in the companies below on your register.`,
    ``,
    `Attached:`,
    `1. The completed e-dividend mandate form, with passport photograph and signature.`,
    `2. A letter of authority signed by the shareholder, authorising ${BRAND} to submit the mandate and correspond with you for these holdings only. Payment is to go directly to the shareholder's bank account.`,
    ``,
    `Holdings:`,
    ...companies.map((c, i) => `${i + 1}. ${c}`),
    ...((s.variants ?? []).length ? [``, `The name may appear on your register as: ${(s.variants ?? []).join("; ")}.`] : []),
    ...(byHand.length ? [``, `Not printed on your form, please note by hand: ${byHand.join("; ")}.`] : []),
    ``,
    `Details when the shares were bought, to help you find the holding:`,
    `Address: ${a.address}`,
    ...(a.phone ? [`Phone: ${a.phone}`] : []),
    `Next of kin: ${kin}`,
    ``,
    `Current contact: ${s.profile.phone1}, ${s.profile.email}`,
    ``,
    ...(note ? [note, ``] : []),
    `Please reply to this email quoting ${s.ref}, or confirm which further documents you need.`,
    ``,
    BRAND,
  ];
  const html = shell(
    `<p>Dear ${esc(reg.name)},</p>` +
    `<p>${esc(BRAND)} is sending this on behalf of <b>${esc(name.toUpperCase())}</b>, who holds shares in the companies below on your register.</p>` +
    `<p><b>Attached</b></p><ol><li>The completed e-dividend mandate form, with passport photograph and signature.</li>` +
    `<li>A letter of authority signed by the shareholder, authorising ${esc(BRAND)} to submit the mandate and correspond with you for these holdings only. Payment is to go directly to the shareholder's bank account.</li></ol>` +
    `<p><b>Holdings</b></p><ol>${companies.map((c) => `<li>${esc(c)}</li>`).join("")}</ol>` +
    ((s.variants ?? []).length ? `<p><b>The name may appear on your register as:</b> ${esc((s.variants ?? []).join("; "))}.</p>` : "") +
    (byHand.length ? `<p><b>Not printed on your form, please note by hand:</b> ${esc(byHand.join("; "))}.</p>` : "") +
    `<p><b>Details when the shares were bought</b>, to help you find the holding:<br>Address: ${esc(a.address)}<br>` +
    (a.phone ? `Phone: ${esc(a.phone)}<br>` : "") + `Next of kin: ${esc(kin)}</p>` +
    `<p>Current contact: ${esc(s.profile.phone1)}, ${esc(s.profile.email)}</p>` +
    (note ? `<p>${esc(note).replace(/\n/g, "<br>")}</p>` : "") +
    `<p>Please reply to this email quoting <b>${esc(s.ref)}</b>, or tell us which further documents you need.</p><p>${esc(BRAND)}</p>`,
  );
  return { subject, text: lines.join("\n"), html };
}

function paymentLines(s: PilotSubmission, settings: PilotSettings = defaultSettings()) {
  const env = pilotEnv(settings);
  const BRAND = settings.brandName;
  const n = s.holdings.length;
  const each = `${naira(settings.payAheadPerCompany)} plus 7.5% VAT for each of ${n} ${n === 1 ? "company" : "companies"}`;
  const success = `Success fee: only when a dividend reaches your account, ${settings.debitRatePercent}% of that payment. We will write to you then. If nothing is paid to you, you owe no success fee.`;
  if (s.payment.status === "paid") return [`Start fee paid: ${nairaExact(s.payment.amountDue)} (${each}). Thank you.`, success];
  const bits = [`Start fee due: ${nairaExact(s.payment.amountDue)} (${each}).`];
  if (env.pay.accountNumber) bits.push(`Transfer to ${env.pay.accountName || BRAND}, ${env.pay.bank}, account ${env.pay.accountNumber}. Use ${s.ref} as the reference.`);
  else bits.push(`We will send you a payment link. Use ${s.ref} as the reference.`);
  return [...bits, success];
}

/** Sent when a start fee is still unpaid: a link to pay it online. */
export function payLinkEmail(s: PilotSubmission, link: string, settings: PilotSettings = defaultSettings()): Pick<MailMessage, "subject" | "text" | "html"> {
  const BRAND = settings.brandName;
  const n = s.holdings.length;
  const subject = `Pay your start fee to send your dividend forms (${s.ref})`;
  const amount = nairaExact(s.payment.amountDue);
  const text = [
    `Hello ${s.profile.firstName},`, ``,
    `Your dividend forms are ready, reference ${s.ref}. We send them to the registrars as soon as your start fee is paid.`, ``,
    `Amount: ${amount} (${naira(settings.payAheadPerCompany)} plus 7.5% VAT for each of ${n} ${n === 1 ? "company" : "companies"}).`, ``,
    `Pay securely with Paystack here:`, link, ``,
    `${BRAND} staff will never ask for your PIN, OTP or card details by phone, WhatsApp or email.`, ``,
    `Questions? Reply to this email and quote ${s.ref}.`, ``, BRAND,
  ].join("\n");
  const html = shell(
    `<p>Hello ${esc(s.profile.firstName)},</p>` +
    `<p>Your dividend forms are ready, reference <b>${esc(s.ref)}</b>. We send them to the registrars as soon as your start fee is paid.</p>` +
    `<p><b>Amount: ${esc(amount)}</b> (${esc(naira(settings.payAheadPerCompany))} plus 7.5% VAT for each of ${n} ${n === 1 ? "company" : "companies"}).</p>` +
    `<p><a href="${esc(link)}" style="background:#C59F56;color:#17375A;font-weight:bold;padding:10px 18px;border-radius:8px;text-decoration:none;display:inline-block">Pay ${esc(amount)} with Paystack</a></p>` +
    `<p style="color:#5b6472">${esc(BRAND)} staff will never ask for your PIN, OTP or card details by phone, WhatsApp or email.</p>` +
    `<p>Questions? Reply to this email and quote ${esc(s.ref)}.</p><p>${esc(BRAND)}</p>`,
  );
  return { subject, text, html };
}

/** The success-fee request. Trust-based: the shareholder tells us what they received and pays the agreed share. */
export function successFeeEmail(s: PilotSubmission, link: string | null, note = "", settings: PilotSettings = defaultSettings()): Pick<MailMessage, "subject" | "text" | "html"> {
  const BRAND = settings.brandName;
  const rate = settings.debitRatePercent;
  const companies = s.holdings.map((h) => h.company);
  const extra = note.trim();
  const subject = `Has your dividend arrived? Your ${rate}% success fee (${s.ref})`;
  const how = link
    ? `Tell us how much you received and pay the ${rate}% securely with Paystack here:`
    : `Please reply to this email with the amount you received, and we will send you how to pay the ${rate}%.`;
  const text = [
    `Hello ${s.profile.firstName},`, ``,
    `We believe a registrar has now paid dividends into your account for the holdings we sent forms for, reference ${s.ref}:`,
    ...companies.map((c) => `  - ${c}`), ``,
    `When you signed up, you agreed to a success fee of ${rate}% of what is actually paid to you. The registrar pays you directly, so we do not see the amount. We are relying on you to tell us.`, ``,
    how, ...(link ? [link] : []), ``,
    ...(extra ? [extra, ``] : []),
    `If you have not been paid yet, reply and tell us, and we will keep chasing the registrar.`, ``,
    `Thank you for trusting us with this.`, ``, BRAND,
  ].join("\n");
  const html = shell(
    `<p>Hello ${esc(s.profile.firstName)},</p>` +
    `<p>We believe a registrar has now paid dividends into your account for the holdings we sent forms for, reference <b>${esc(s.ref)}</b>:</p>` +
    `<ul>${companies.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>` +
    `<p>When you signed up, you agreed to a success fee of <b>${rate}%</b> of what is actually paid to you. The registrar pays you directly, so we do not see the amount. We are relying on you to tell us.</p>` +
    (link
      ? `<p>${esc(how)}</p><p><a href="${esc(link)}" style="background:#C59F56;color:#17375A;font-weight:bold;padding:10px 18px;border-radius:8px;text-decoration:none;display:inline-block">Tell us the amount and pay ${rate}%</a></p>`
      : `<p>${esc(how)}</p>`) +
    (extra ? `<p>${esc(extra).replace(/\n/g, "<br>")}</p>` : "") +
    `<p>If you have not been paid yet, reply and tell us, and we will keep chasing the registrar.</p>` +
    `<p>Thank you for trusting us with this.</p><p>${esc(BRAND)}</p>`,
  );
  return { subject, text, html };
}

/** What the shareholder gets: a receipt of what was sent, where, and what happens next. No BVN, no attachments. */
export function confirmationEmail(s: PilotSubmission, settings: PilotSettings = defaultSettings()): Pick<MailMessage, "subject" | "text" | "html"> {
  const BRAND = settings.brandName;
  const byReg = [...new Set(s.holdings.map((h) => h.registrar))].map((r) => ({ r, items: s.holdings.filter((h) => h.registrar === r).map((h) => h.company) }));
  const pay = paymentLines(s, settings);
  const subject = `We've sent your dividend forms (${s.ref})`;
  const text = [
    `Hello ${s.profile.firstName},`,
    ``,
    `We've sent your e-dividend mandate form and a signed letter of authority to the registrars below. Your reference is ${s.ref}.`,
    ``,
    ...byReg.flatMap(({ r, items }) => [r, ...items.map((c) => `  - ${c}`), ``]),
    `What happens next: the registrar checks its records and replies to us. We chase them and tell you when anything changes. Any dividend is paid by the registrar straight into your account ending ${s.profile.accountNumber.slice(-4)}.`,
    ``,
    ...pay,
    ``,
    `Follow your progress in your account: ${accountUrl()}`,
    `The first time, choose "Set or reset my password" and use this email address.`,
    ``,
    `Questions? Reply to this email and quote ${s.ref}.`,
    ``,
    BRAND,
  ].join("\n");
  const html = shell(
    `<p>Hello ${esc(s.profile.firstName)},</p>` +
    `<p>We've sent your e-dividend mandate form and a signed letter of authority to the registrars below. Your reference is <b>${esc(s.ref)}</b>.</p>` +
    byReg.map(({ r, items }) => `<p><b>${esc(r)}</b></p><ul>${items.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>`).join("") +
    `<p><b>What happens next:</b> the registrar checks its records and replies to us. We chase them and tell you when anything changes. Any dividend is paid by the registrar straight into your account ending ${esc(s.profile.accountNumber.slice(-4))}.</p>` +
    pay.map((l) => `<p>${esc(l)}</p>`).join("") +
    `<p><b>Follow your progress</b> in <a href="${esc(accountUrl())}">your account</a>. The first time, choose "Set or reset my password" and use this email address.</p>` +
    `<p>Questions? Reply to this email and quote ${esc(s.ref)}.</p><p>${esc(BRAND)}</p>`,
  );
  return { subject, text, html };
}

export { paymentLines };


/** A follow-up to a registrar about a submission already sent. Staff can add a line of their own. */
export function chaseEmail(s: PilotSubmission, registrarId: string, extra = "", settings: PilotSettings = defaultSettings()): Pick<MailMessage, "subject" | "text" | "html"> {
  const BRAND = settings.brandName;
  const reg = pilotRegistrar(registrarId)!;
  const companies = s.holdings.filter((h) => h.registrarId === registrarId).map((h) => h.company);
  const sentAt = [...s.emails].reverse().find((e) => e.kind === "registrar" && e.registrarId === registrarId && e.status === "sent")?.at ?? s.createdAt;
  const day = new Date(sentAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Lagos" });
  const name = fullName(s).toUpperCase();
  const subject = `Follow-up: e-dividend mandate for ${s.profile.surname.toUpperCase()} ${s.profile.firstName} (${companies.length} ${companies.length === 1 ? "holding" : "holdings"}) [${s.ref}]`;
  const note = extra.trim();
  const text = [
    `Dear ${reg.name},`, ``,
    `We wrote on ${day} on behalf of ${name}, reference ${s.ref}, enclosing the e-dividend mandate form and a signed letter of authority. We have not yet had a reply, so we are following up. The documents are attached again.`,
    ``, `Holdings (${companies.length}):`, ...companies.map((c, i) => `${i + 1}. ${c}`),
    ...(note ? [``, note] : []),
    ``, `Please confirm that the mandate has been received and updated, or tell us what else you need.`, ``, BRAND,
  ].join("\n");
  const html = shell(
    `<p>Dear ${esc(reg.name)},</p>` +
    `<p>We wrote on ${esc(day)} on behalf of <b>${esc(name)}</b>, reference <b>${esc(s.ref)}</b>, enclosing the e-dividend mandate form and a signed letter of authority. We have not yet had a reply, so we are following up. The documents are attached again.</p>` +
    `<p><b>Holdings (${companies.length})</b></p><ol>${companies.map((c) => `<li>${esc(c)}</li>`).join("")}</ol>` +
    (note ? `<p>${esc(note)}</p>` : "") +
    `<p>Please confirm that the mandate has been received and updated, or tell us what else you need.</p><p>${esc(BRAND)}</p>`,
  );
  return { subject, text, html };
}
