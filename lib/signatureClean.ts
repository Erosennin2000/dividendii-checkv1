/**
 * Turns a photo of a signature on white paper into ink-on-clear pixels, the same look as a drawn signature.
 * Pure pixel work (no browser needed) so it can be tested. The pad component calls it.
 */
export const INK = { r: 0x17, g: 0x37, b: 0x5a };

export interface CleanedSignature { data: Uint8ClampedArray; box: { x: number; y: number; w: number; h: number } }

/**
 * rgba: the photo's pixels, w x h. Returns the same size image where paper is clear and ink is navy, plus the box around the ink.
 * Returns null when it can't find a signature: a dark photo, no ink, or so much "ink" it can't be a signature.
 */
export function cleanSignaturePixels(rgba: Uint8ClampedArray, w: number, h: number): CleanedSignature | null {
  const n = w * h;
  if (n === 0 || rgba.length < n * 4) return null;
  const lum = new Uint8Array(n);
  const hist = new Uint32Array(256);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const l = Math.round(0.299 * rgba[o] + 0.587 * rgba[o + 1] + 0.114 * rgba[o + 2]);
    lum[i] = l; hist[l]++;
  }
  // The paper is most of the picture: its brightness is the 90th percentile.
  let seen = 0, bg = 255;
  for (let v = 0; v < 256; v++) { seen += hist[v]; if (seen >= n * 0.9) { bg = v; break; } }
  if (bg < 110) return null; // too dark to be white paper

  const LO = 0.18, HI = 0.4; // how much darker than the paper a pixel must be to start / fully count as ink
  const out = new Uint8ClampedArray(n * 4);
  let minX = w, minY = h, maxX = -1, maxY = -1, ink = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const d = (bg - lum[i]) / bg;
      const a = d <= LO ? 0 : d >= HI ? 1 : (d - LO) / (HI - LO);
      if (a === 0) continue;
      const o = i * 4;
      out[o] = INK.r; out[o + 1] = INK.g; out[o + 2] = INK.b; out[o + 3] = Math.round(a * 255);
      if (a >= 0.5) {
        ink++;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  if (ink < n * 0.001 || ink > n * 0.35 || maxX < 0) return null;
  const pad = 6;
  const x = Math.max(0, minX - pad), y = Math.max(0, minY - pad);
  return { data: out, box: { x, y, w: Math.min(w, maxX + pad + 1) - x, h: Math.min(h, maxY + pad + 1) - y } };
}
