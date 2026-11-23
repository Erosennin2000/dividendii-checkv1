/**
 * The registrar forms are filled with the standard PDF fonts, which only cover Latin-1.
 * Yoruba and Igbo names carry marks like ọ and ẹ, so strip the marks (keeping the letter)
 * and replace anything else the font can't draw. The submission record keeps the original.
 */
export function pdfSafe(s: string): string {
  return (s ?? "")
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g, "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/₦/g, "N")
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, "?");
}

/** Characters nobody can see (zero-width spaces, direction marks, control codes) that would print as "?" on a form. */
const INVISIBLE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g;
export const clean = (s: unknown, max = 300) => String(s ?? "").replace(INVISIBLE, "").replace(/\s+/g, " ").trim().slice(0, max);
