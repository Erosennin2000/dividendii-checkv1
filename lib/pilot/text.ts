/**
 * The registrar forms are filled with the standard PDF fonts, which only cover Latin-1.
 * Yoruba and Igbo names carry marks like ọ and ẹ, so strip the marks (keeping the letter)
 * and replace anything else the font can't draw. The submission record keeps the original.
 */
export function pdfSafe(s: string): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/₦/g, "N")
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, "?");
}

export const clean = (s: unknown, max = 300) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, max);
