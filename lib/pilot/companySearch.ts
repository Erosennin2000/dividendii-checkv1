import type { PilotCompany } from "./config";

/**
 * "Type the name of a company and we'll find its registrar." Pure functions, no network, safe in the browser.
 * It only ever searches the companies we already list, so a result always carries the registrar we have on file.
 * It never decides between two registrars: if one company name is listed under two, both rows come back.
 */

const STOP = new Set(["plc", "limited", "ltd", "nigeria", "nig", "of", "the", "and", "for"]);

/** Lower case, accents and punctuation gone, filler words ("PLC", "Nigeria", "of") dropped. */
export function tokens(s: string): string[] {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ").split(" ").filter((t) => t && !STOP.has(t));
}
const key = (s: string) => tokens(s).join(" ");
const closed = (s: string) => tokens(s).join("");

/** What people call a company in conversation, mapped to words in the name on our list. Checked against the list by a test. */
export const SHORT_NAMES: Record<string, string> = {
  gtco: "guaranty trust holding", gtbank: "guaranty trust holding", gtb: "guaranty trust holding", gt: "guaranty trust holding",
  "gt bank": "guaranty trust holding", "gt holding": "guaranty trust holding", gthc: "guaranty trust holding",
  uba: "united bank africa",
  wapco: "lafarge africa",
  ibtc: "stanbic ibtc holdings", stanbic: "stanbic ibtc holdings",
  "access holdings": "access bank", "access bank": "access bank",
  nnfm: "northern flour mills", fmn: "flour mills",
  nb: "nigerian breweries", nbl: "nigerian breweries",
  ibl: "international breweries",
  dangcem: "dangote cement", dangsugar: "dangote sugar",
  mtnn: "mtn communication",
  seplat: "seplat energy",
  total: "totalenergies marketing", totalenergies: "totalenergies marketing",
};

/** Companies we do not cover, and the words people use for them, so "first bank" gets a straight answer instead of "no match". */
export const NOT_COVERED_HINT = /^(fbn|first ?bank|first ?holdco|first ?bank ?holdings?)\b/i;

/** Roughly how alike two words are, 0 to 1 (shared letter pairs). Catches slips like "zenth" for "zenith". */
function dice(a: string, b: string): number {
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;
  const g = (s: string) => { const m = new Map<string, number>(); for (let i = 0; i < s.length - 1; i++) { const p = s.slice(i, i + 2); m.set(p, (m.get(p) ?? 0) + 1); } return m; };
  const x = g(a), y = g(b);
  let n = 0, tx = 0, ty = 0;
  for (const [p, c] of x) { tx += c; n += Math.min(c, y.get(p) ?? 0); }
  for (const c of y.values()) ty += c;
  return (2 * n) / (tx + ty);
}

const SIDE_PRODUCT = /\b(fund|bond|notes|spv|etf)\b/i;

function score(qTokens: string[], q: string, name: string): number {
  const nTokens = tokens(name);
  const nClosed = nTokens.join("");
  if (!nTokens.length || !qTokens.length) return 0;
  let s = 0;
  if (nClosed === q) s = 100;
  else if (nClosed.startsWith(q)) s = 90;
  else if (qTokens.every((t) => nTokens.some((n) => n.startsWith(t)))) s = 75;
  else if (q.length >= 4 && nClosed.includes(q)) s = 55;
  else {
    // A slip in spelling: each word must start with the same letter, be about as long, and share most letter pairs with a word in the name.
    const near = (t: string) => Math.max(0, ...nTokens.map((n) => (t.length >= 4 && n[0] === t[0] && n.length >= t.length - 1 ? dice(t, n.slice(0, t.length + 1)) : 0)));
    const best = Math.min(...qTokens.map(near));
    if (best >= 0.65) s = 40 + 10 * best;
  }
  if (!s) return 0;
  if (SIDE_PRODUCT.test(name)) s -= 5; // the company itself before its funds and bonds
  return s - Math.min(nTokens.length, 12) * 0.1; // shorter names first on a tie
}

export interface CompanyHit extends PilotCompany {
  /** The same company name is also listed under another registrar. The person must choose, we never guess. */
  alsoElsewhere: boolean;
}

export function searchCompanies(query: string, companies: PilotCompany[], limit = 8): CompanyHit[] {
  const qTokens = tokens(query);
  const q = qTokens.join("");
  if (q.length < 2) return [];
  const asked = [{ qTokens, q }];
  const short = SHORT_NAMES[qTokens.join(" ")] ?? SHORT_NAMES[q];
  if (short) asked.push({ qTokens: tokens(short), q: closed(short) });

  const perName = new Map<string, Set<string>>();
  for (const c of companies) { const k = key(c.company); (perName.get(k) ?? perName.set(k, new Set()).get(k)!).add(c.registrarId); }

  const scored = companies.map((c) => ({ c, s: Math.max(...asked.map((a) => score(a.qTokens, a.q, c.company))) })).filter((x) => x.s > 0);
  const best = Math.max(0, ...scored.map((x) => x.s));
  return scored
    .filter((x) => best < 75 || x.s >= 55) // a real match hides the "looks a bit like it" guesses
    .sort((a, b) => b.s - a.s || a.c.company.localeCompare(b.c.company) || a.c.registrar.localeCompare(b.c.registrar))
    .slice(0, limit)
    .map(({ c }) => ({ ...c, alsoElsewhere: (perName.get(key(c.company))?.size ?? 1) > 1 }));
}
