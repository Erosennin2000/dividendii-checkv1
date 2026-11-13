import "server-only";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import { formatNgPhone, normalizeNgPhone } from "@/lib/domain/phone";
import type { FormProfile } from "@/lib/forms/types";
import { PILOT_BRAND } from "./config";
import { pdfSafe } from "./text";
import type { PilotInput } from "./types";

export interface AuthorityInput {
  registrar: string;
  ref: string;
  profile: FormProfile;
  atPurchase: PilotInput["atPurchase"];
  variants?: string[];
  companies: string[];
  signature: Uint8Array | null;
  /** Where the registrar should reply. */
  replyTo: string;
  /** The business name on the letter. Defaults to PILOT_BRAND. */
  brand?: string;
  now?: Date;
}

const INK = rgb(0.1, 0.12, 0.16);
const MUTED = rgb(0.38, 0.42, 0.48);
const NAVY = rgb(0.16, 0.36, 0.56);
const PAGE = { w: 595.28, h: 841.89 }; // A4
const M = 50;

function wrap(font: PDFFont, text: string, size: number, width: number): string[] {
  const lines: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) > width && line) { lines.push(line); line = word; } else line = next;
    }
    lines.push(line);
  }
  return lines;
}

const lagosDate = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Lagos" });

/**
 * A one-or-two page letter that sits next to the mandate form. It tells the registrar who Dividendii is acting
 * for, on which holdings, and what Dividendii may not do. The shareholder's drawn signature is on it.
 */
export async function buildAuthorityLetter(a: AuthorityInput): Promise<Uint8Array> {
  const brand = pdfSafe(a.brand || PILOT_BRAND);
  const doc = await PDFDocument.create();
  doc.setTitle(`Letter of authority - ${a.ref}`);
  doc.setCreator(brand);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const s = pdfSafe;
  const p = a.profile;
  const full = s([p.firstName, p.otherNames, p.surname].filter((x) => x?.trim()).join(" ")).toUpperCase();
  const phone = normalizeNgPhone(p.phone1);

  let page: PDFPage = doc.addPage([PAGE.w, PAGE.h]);
  let y = PAGE.h - M;
  const room = (need: number) => {
    if (y - need < M + 16) { page = doc.addPage([PAGE.w, PAGE.h]); y = PAGE.h - M; }
  };
  const text = (t: string, o: { size?: number; font?: PDFFont; color?: ReturnType<typeof rgb>; gap?: number; indent?: number } = {}) => {
    const size = o.size ?? 9.5, f = o.font ?? font, indent = o.indent ?? 0;
    for (const line of wrap(f, s(t), size, PAGE.w - M * 2 - indent)) {
      room(size * 1.4);
      page.drawText(line, { x: M + indent, y, size, font: f, color: o.color ?? INK });
      y -= size * 1.4;
    }
    y -= o.gap ?? 3;
  };
  const heading = (t: string) => { room(30); y -= 6; text(t, { font: bold, size: 11, color: NAVY, gap: 2 }); };

  page.drawText(brand.toUpperCase(), { x: M, y, size: 11, font: bold, color: NAVY });
  y -= 24;
  text("LETTER OF AUTHORITY", { font: bold, size: 16, gap: 0 });
  text("My signed permission for Dividendii to submit my e-dividend mandate", { size: 11, color: MUTED, gap: 14 });

  text(`Date: ${lagosDate(a.now ?? new Date())}  |  Reference: ${a.ref}`, { gap: 8 });
  text(`To: The Registrar, ${a.registrar}`, { gap: 8 });

  text(`Re: Authority for ${brand} to submit the e-dividend mandate of ${full}`, { font: bold, gap: 10 });

  text(`I, ${full}, appoint ${brand} ("the Attorney") to act for me for the limited purposes below.`, { gap: 8 });

  heading(`1. Holdings covered (${a.companies.length} ${a.companies.length === 1 ? "company" : "companies"})`);
  text(`This authority covers my holdings in the following ${a.companies.length === 1 ? "company" : "companies"} on your register, and nothing else:`, { gap: 2 });
  a.companies.forEach((c, i) => text(`${i + 1}. ${c}`, { indent: 12, gap: 0 }));
  y -= 6;

  if (a.variants?.length) text(`My name may appear on your register as: ${a.variants.join("; ")}.`, { gap: 2 });

  heading("2. What the Attorney may do");
  text("Complete and submit my e-dividend mandate form for these holdings, send you the supporting documents I have supplied, correspond with you about them, and ask you for the status of any unclaimed dividends held for me.");

  heading("3. What the Attorney may not do");
  text("The Attorney may not sell, transfer, pledge or otherwise deal in my shares, change my bank details other than as shown on the attached mandate form, or receive any payment for me. Every payment must go from you straight to my bank account:");
  text(`${s(p.bankName).toUpperCase()}, account number ${p.accountNumber}`, { font: bold, indent: 12 });

  heading("4. My details when I bought the shares, to help you find my holding");
  const rows: [string, string][] = [
    ["Address then", a.atPurchase.address],
    ["Phone then", a.atPurchase.phone],
    ["Next of kin then", [a.atPurchase.nextOfKinName, a.atPurchase.nextOfKinRelationship && `(${a.atPurchase.nextOfKinRelationship})`, a.atPurchase.nextOfKinPhone].filter(Boolean).join(" ")],
  ];
  for (const [k, v] of rows) if (v) text(`${k}: ${v}`, { indent: 12, gap: 0 });
  y -= 6;

  heading("5. My details now");
  const now: [string, string][] = [
    ["Address", [p.address, p.city, p.state].filter((x, i, all) => x && all.findIndex((y) => y?.toUpperCase() === x.toUpperCase()) === i).join(", ")],
    ["Phone", phone ? formatNgPhone(phone) : p.phone1],
    ["Email", p.email],
  ];
  for (const [k, v] of now) if (v) text(`${k}: ${v}`, { indent: 12, gap: 0 });
  y -= 6;

  heading("6. Duration");
  text("This authority ends when each listed claim is paid or closed, or after 12 months, whichever comes first. I can withdraw it at any time by writing to you and to the Attorney.");

  room(130);
  y -= 8;
  text("Signed", { font: bold, gap: 4 });
  if (a.signature) {
    const png = a.signature[0] === 0x89 && a.signature[1] === 0x50;
    const img: PDFImage = png ? await doc.embedPng(a.signature) : await doc.embedJpg(a.signature);
    const scale = Math.min(170 / img.width, 50 / img.height);
    const w = img.width * scale, h = img.height * scale;
    room(h + 40);
    page.drawImage(img, { x: M, y: y - h, width: w, height: h });
    y -= h + 4;
  } else {
    y -= 40;
  }
  y -= 2;
  page.drawLine({ start: { x: M, y }, end: { x: M + 220, y }, thickness: 0.7, color: MUTED });
  y -= 14;
  text(full, { font: bold, gap: 0 });
  text(`Signed electronically by the shareholder on ${lagosDate(a.now ?? new Date())}`, { size: 9, color: MUTED, gap: 14 });

  text(`Sent on the shareholder's behalf by ${brand}. Please reply to ${a.replyTo || "the sender"} quoting ${a.ref}.`, { size: 9, color: MUTED });

  return doc.save();
}
