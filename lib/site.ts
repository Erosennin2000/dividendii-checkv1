/** Facts shown on the public pages. Same as the main site's src/site.js. */
export const SITE = {
  brand: "Dividendii",
  legal: "Dividendii Limited",
  rc: "RC 9598309",
  address: "10 Ahmadu Bello Street, Victoria Island, Lagos",
  phone: "+234 909 502 3263",
  phoneTel: "+2349095023263",
  whatsapp: "https://wa.me/2349095023263",
  email: "support@dividendii.com",
  hours: "9am to 5pm, Monday to Friday",
  home: "https://www.dividendii.com",
  source: "https://nairametrics.com/2026/07/16/sec-launches-nationwide-campaign-to-recover-n270-billion-unclaimed-dividends/",
};
/** Start fee, per company, before VAT. Paid when the forms are sent. */
export const START_FEE = 150;
export const VAT_RATE = 0.075;
export const startFeeWithVat = (fee = START_FEE) => Math.round(fee * (1 + VAT_RATE) * 100) / 100;
/** Success fee, as a share of money actually paid to the shareholder. */
export const SUCCESS_PERCENT = 5;
/** Naira with kobo where it matters (₦161.25), whole naira otherwise (₦150). */
export const nairaExact = (n: number) => "₦" + n.toLocaleString("en-NG", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
