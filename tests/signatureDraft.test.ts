import { describe, it, expect } from "vitest";
import { cleanSignaturePixels } from "@/lib/signatureClean";
import { DRAFT_TTL_MS, draftExpired, draftSafeProfile } from "@/lib/pilot/draft";

function paper(w: number, h: number, shade = 240) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { d[i * 4] = shade; d[i * 4 + 1] = shade; d[i * 4 + 2] = shade; d[i * 4 + 3] = 255; }
  return d;
}
function stroke(d: Uint8ClampedArray, w: number, x0: number, x1: number, y: number, v = 30) {
  for (let x = x0; x <= x1; x++) for (let dy = 0; dy < 3; dy++) { const o = ((y + dy) * w + x) * 4; d[o] = v; d[o + 1] = v; d[o + 2] = v; }
}

describe("signature photo cleaning", () => {
  it("turns paper clear, ink navy, and boxes the ink", () => {
    const w = 200, h = 100, d = paper(w, h);
    stroke(d, w, 40, 160, 50);
    const r = cleanSignaturePixels(d, w, h)!;
    expect(r).not.toBeNull();
    expect(r.data[3]).toBe(0); // corner: paper is transparent
    const o = (51 * w + 100) * 4; // on the stroke
    expect([r.data[o], r.data[o + 1], r.data[o + 2]]).toEqual([0x17, 0x37, 0x5a]);
    expect(r.data[o + 3]).toBe(255);
    expect(r.box.x).toBeLessThanOrEqual(40); expect(r.box.x + r.box.w).toBeGreaterThanOrEqual(161);
    expect(r.box.w).toBeLessThan(w); // margins are cropped away
  });
  it("copes with a greyer, uneven-looking sheet", () => {
    const w = 200, h = 100, d = paper(w, h, 200);
    stroke(d, w, 30, 170, 40, 40);
    expect(cleanSignaturePixels(d, w, h)).not.toBeNull();
  });
  it("says no when the photo is blank, too dark, or all dark", () => {
    expect(cleanSignaturePixels(paper(100, 100), 100, 100)).toBeNull(); // blank paper
    expect(cleanSignaturePixels(paper(100, 100, 40), 100, 100)).toBeNull(); // dark photo
    const d = paper(100, 100); for (let i = 0; i < 100 * 50; i++) { d[i * 4] = 20; d[i * 4 + 1] = 20; d[i * 4 + 2] = 20; }
    expect(cleanSignaturePixels(d, 100, 100)).toBeNull(); // half the picture dark: not a signature
  });
});

describe("form draft rules", () => {
  it("expires after 30 minutes of no activity, not before", () => {
    const t = 1_000_000;
    expect(DRAFT_TTL_MS).toBe(30 * 60_000);
    expect(draftExpired(t, t + 29 * 60_000)).toBe(false);
    expect(draftExpired(t, t + 31 * 60_000)).toBe(true);
    expect(draftExpired(null, t)).toBe(false);
    expect(draftExpired(undefined, t)).toBe(false);
  });
  it("never keeps the BVN, keeps the rest", () => {
    const p = draftSafeProfile({ bvn: "12345678901", firstName: "Ada" });
    expect(p.bvn).toBe("");
    expect(p.firstName).toBe("Ada");
  });
});
