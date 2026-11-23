/** Success fee. Capped at 10% and signed into clause 4 of the authority. */
export const FEE_RATE = 0.1;

/** Fee on sums actually received, in whole naira. Nothing recovered means nothing charged. */
export function feeFor(gross: number, rate: number = FEE_RATE): number {
  if (!Number.isFinite(gross) || gross <= 0) return 0;
  return Math.round(gross * rate);
}

export function netFor(gross: number, rate: number = FEE_RATE): number {
  if (!Number.isFinite(gross) || gross <= 0) return 0;
  return Math.round(gross) - feeFor(gross, rate);
}

/** VAT on our fees. */
export const FEE_VAT = 0.075;
const r2 = (n: number) => Math.round(n * 100) / 100;

/** The success fee on money a shareholder received: the percentage, VAT on it, and the total to pay. Naira, to the kobo. */
export function successFeeParts(received: number, ratePercent: number): { fee: number; vat: number; total: number } {
  if (!Number.isFinite(received) || received <= 0) return { fee: 0, vat: 0, total: 0 };
  const fee = r2(received * ratePercent / 100);
  const vat = r2(fee * FEE_VAT);
  return { fee, vat, total: r2(fee + vat) };
}

export function naira(n: number): string {
  return "\u20A6" + Math.round(n).toLocaleString("en-NG");
}
