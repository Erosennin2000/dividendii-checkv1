import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { STEP_NOTES, WHY } from "@/lib/pilot/whyCopy";

const BANNED = /\b(sec|paystack|monnify|broker|stockbroker|guarantee[sd]?|guaranteed)\b/i;

describe("why-we-ask copy", () => {
  it("every entry has a title and a reason of sensible length", () => {
    for (const [k, v] of Object.entries(WHY)) {
      expect(v.title.length, k).toBeGreaterThan(3);
      expect(v.why.length, k).toBeGreaterThan(40);
      expect(v.why.length, k).toBeLessThan(420);
    }
  });
  it("keeps to the owner's wording rules: no regulator, payment company, bank-check company, broker or guarantees", () => {
    const all = [...Object.values(WHY).flatMap((v) => [v.title, v.why, "where" in v ? (v as { where?: string }).where ?? "" : ""]), ...Object.values(STEP_NOTES).flatMap((v) => [v.time, v.level, v.why])];
    for (const t of all) expect(BANNED.test(t), t).toBe(false);
  });
  it("every step has a note", () => {
    for (const k of [1, 2, 3, 4, "code"] as const) { expect(STEP_NOTES[k].time).toBeTruthy(); expect(STEP_NOTES[k].why.length).toBeGreaterThan(30); }
  });
  it("every pop-up is actually used on the Check page", () => {
    const page = readFileSync("app/pilot/page.tsx", "utf8") + readFileSync("components/CompanySearch.tsx", "utf8");
    for (const k of Object.keys(WHY)) expect(new RegExp(`(why="${k}"|k="${k}")`).test(page), k).toBe(true);
    for (const k of [1, 2, 3, 4]) expect(page.includes(`<StepNote k={${k}} />`), String(k)).toBe(true);
    expect(page.includes('<StepNote k="code" />')).toBe(true);
  });
});
