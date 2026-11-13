import "server-only";
import { PILOT_BRAND, PILOT_REGISTRARS, registrarAddress, PAY_AHEAD_PER_COMPANY, DEBIT_RATE } from "./config";
import { isEmail, type PilotSettings, type StoredSettings } from "./settingsShared";

/** Defaults come from the environment, so an install that never opens the settings page works exactly as before. */
export function defaultSettings(env: NodeJS.ProcessEnv = process.env): PilotSettings {
  const admin = (env.PILOT_ADMIN_EMAIL ?? "").trim();
  // MAIL_FROM may be 'Name <a@b.com>' or a bare address. Split it so the admin page can edit each part.
  const m = (env.MAIL_FROM ?? "").trim().match(/^(?:"?([^"<]*?)"?\s*)?<([^>]+)>$/);
  const bare = (env.MAIL_FROM ?? "").trim();
  return {
    brandName: PILOT_BRAND,
    mode: env.PILOT_MODE === "live" ? "live" : "test", // anything else is test: nothing reaches a registrar by accident
    acceptingSubmissions: true,
    senderName: m ? (m[1] ?? "").trim() || PILOT_BRAND : PILOT_BRAND,
    senderEmail: m ? m[2].trim() : isEmail(bare) ? bare : "dami@dividendii.com",
    replyTo: (env.PILOT_REPLY_TO ?? admin).trim(),
    adminCopy: admin,
    testInbox: (env.PILOT_TEST_EMAIL ?? admin).trim(),
    registrarNote: "",
    registrars: Object.fromEntries(PILOT_REGISTRARS.map((r) => [r.id, { enabled: true, email: registrarAddress(r.id) }])),
    payment: {
      bank: env.PILOT_PAY_BANK?.trim() || "",
      accountName: env.PILOT_PAY_ACCOUNT_NAME?.trim() || "",
      accountNumber: env.PILOT_PAY_ACCOUNT_NUMBER?.trim() || "",
    },
    payAheadPerCompany: PAY_AHEAD_PER_COMPANY,
    debitRatePercent: DEBIT_RATE * 100,
  };
}

/** What's really used: stored values win over the defaults, blank values fall back. */
export function effectiveSettings(stored: StoredSettings | null | undefined, env: NodeJS.ProcessEnv = process.env): PilotSettings {
  const d = defaultSettings(env);
  const s = stored ?? {};
  const pick = (v: string | undefined, fallback: string) => (v && v.trim() ? v.trim() : fallback);
  const registrars: PilotSettings["registrars"] = {};
  for (const r of PILOT_REGISTRARS) {
    const st = s.registrars?.[r.id];
    registrars[r.id] = {
      enabled: st?.enabled ?? true,
      email: st?.email && isEmail(st.email) ? st.email.trim() : d.registrars[r.id].email,
    };
  }
  const brandName = pick(s.brandName, d.brandName);
  return {
    brandName,
    mode: s.mode ?? d.mode,
    acceptingSubmissions: s.acceptingSubmissions ?? true,
    // Renaming the business renames the sender too, unless a sender name was set on purpose.
    senderName: pick(s.senderName, s.brandName?.trim() ? brandName : d.senderName),
    senderEmail: pick(s.senderEmail, d.senderEmail),
    replyTo: pick(s.replyTo, d.replyTo),
    adminCopy: s.adminCopy === undefined ? d.adminCopy : s.adminCopy.trim(), // blank on purpose = no copy
    testInbox: pick(s.testInbox, d.testInbox),
    registrarNote: s.registrarNote ?? "",
    registrars,
    payment: {
      bank: pick(s.payment?.bank, d.payment.bank),
      accountName: pick(s.payment?.accountName, d.payment.accountName),
      accountNumber: pick(s.payment?.accountNumber, d.payment.accountNumber),
    },
    payAheadPerCompany: s.payAheadPerCompany ?? d.payAheadPerCompany,
    debitRatePercent: s.debitRatePercent ?? d.debitRatePercent,
    updatedAt: s.updatedAt,
    updatedBy: s.updatedBy,
  };
}

/** "Name <address>" with nothing in the name that could break the header. */
export const fromHeader = (s: Pick<PilotSettings, "senderName" | "senderEmail">) => `${s.senderName.replace(/["<>\r\n]/g, "")} <${s.senderEmail}>`;

/** Settings the public form needs. Nothing private. */
export function publicConfig(s: PilotSettings) {
  return {
    open: s.acceptingSubmissions,
    mode: s.mode,
    brandName: s.brandName,
    registrars: PILOT_REGISTRARS.filter((r) => s.registrars[r.id]?.enabled).map((r) => ({ id: r.id, name: r.name })),
    payAheadPerCompany: s.payAheadPerCompany,
    debitRatePercent: s.debitRatePercent,
  };
}

/** Is SMTP set up? Never returns the password. */
export function smtpStatus(env: NodeJS.ProcessEnv = process.env) {
  const host = env.SMTP_HOST?.trim() ?? "";
  const user = env.SMTP_USER?.trim() ?? "";
  return { configured: Boolean(host), host, user: user ? user.replace(/^(.).*(@.*)$/, "$1***$2") : "", hasPassword: Boolean(env.SMTP_PASS) };
}
