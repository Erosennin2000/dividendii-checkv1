/** Facts shown on the public pages. Same as the main site's src/site.js. */
export const SITE = {
  brand: "Dividendii",
  legal: "Dividendii Limited",
  rc: "RC 10023264",
  address: "10 Ahmadu Bello Street, Victoria Island, Lagos",
  phone: "+234 909 502 3263",
  phoneTel: "+2349095023263",
  whatsapp: "https://wa.me/2349095023263",
  email: "support@dividendii.com",
  hours: "9am to 5pm, Monday to Friday",
  home: "https://www.dividendii.com",
};
/** Start fee, per company, before VAT. Paid when the forms are sent. */
export const START_FEE = 150;
export const VAT_RATE = 0.075;
export const startFeeWithVat = (fee = START_FEE) => Math.round(fee * (1 + VAT_RATE) * 100) / 100;
/** Success fee, as a share of money actually paid to the shareholder. */
export const SUCCESS_PERCENT = 5;
/** Where people sign in to follow their claims. Used in emails. */
export const accountUrl = () => {
  const fixed = (process.env.PILOT_PUBLIC_URL ?? "").trim().replace(/\/+$/, "") || "https://www.dividendii.com";
  return (fixed.endsWith("/check") ? fixed : fixed + "/check") + "/account";
};
/** Naira with kobo where it matters (₦161.25), whole naira otherwise (₦150). */
export const nairaExact = (n: number) => "₦" + n.toLocaleString("en-NG", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });

/**
 * The version and date of each legal document as shown on the main site's Legal page (its src/site.js has the same table).
 * Saved with every submission so we can show what the customer agreed to. Change both together when a text changes.
 */
export const LEGAL_VERSIONS = {
  terms: { version: "1.1", date: "2026-11-23" },
  privacy: { version: "1.1", date: "2026-11-23" },
} as const;
export const legalStamp = (k: keyof typeof LEGAL_VERSIONS) => `${k}-v${LEGAL_VERSIONS[k].version}-${LEGAL_VERSIONS[k].date}`;
