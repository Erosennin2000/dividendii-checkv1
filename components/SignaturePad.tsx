"use client";

import { useEffect, useRef, useState } from "react";
import { cleanSignaturePixels } from "@/lib/signatureClean";

/** Ink is always dark navy on a light pad, whatever the page theme, because this goes on a legal document. */
const INK = "#17375A";

export function SignaturePad({ value, onChange }: { value: string | null; onChange: (dataUrl: string | null) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [hasInk, setHasInk] = useState(!!value);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  /** A photo of a signature on white paper: paper becomes clear, ink becomes navy, then it is placed on the pad like a drawn one. */
  async function fromPhoto(file: File | undefined) {
    if (!file) return;
    setUploadError(null);
    if (file.size > 10 * 1024 * 1024) { setUploadError("That file is too big. The limit is 10MB."); return; }
    setBusy(true);
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = () => reject(new Error("That file isn't an image we can read. Try a JPG or PNG."));
        i.src = url;
      });
      const scale = Math.min(1, 1000 / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale)), h = Math.max(1, Math.round(img.height * scale));
      const tmp = document.createElement("canvas");
      tmp.width = w; tmp.height = h;
      const tctx = tmp.getContext("2d", { willReadFrequently: true });
      if (!tctx) throw new Error("This browser can't process images.");
      tctx.fillStyle = "#fff"; tctx.fillRect(0, 0, w, h); // a transparent PNG counts as white paper
      tctx.drawImage(img, 0, 0, w, h);
      const cleaned = cleanSignaturePixels(tctx.getImageData(0, 0, w, h).data, w, h);
      if (!cleaned) throw new Error("We couldn't find a signature in that photo. Use a dark pen on plain white paper, in good light, and fill the frame.");
      const ink = document.createElement("canvas");
      ink.width = w; ink.height = h;
      const ictx = ink.getContext("2d");
      if (!ictx) throw new Error("This browser can't process images.");
      ictx.putImageData(new ImageData(cleaned.data as unknown as Uint8ClampedArray<ArrayBuffer>, w, h), 0, 0);
      const cv = canvasRef.current;
      const pctx = cv?.getContext("2d");
      if (!cv || !pctx) throw new Error("This browser can't process images.");
      const rect = cv.getBoundingClientRect();
      pctx.clearRect(0, 0, cv.width, cv.height);
      const { x, y, w: bw, h: bh } = cleaned.box;
      const fit = Math.min((rect.width * 0.9) / bw, (rect.height * 0.7) / bh);
      const dw = bw * fit, dh = bh * fit;
      pctx.drawImage(ink, x, y, bw, bh, (rect.width - dw) / 2, Math.max(4, (rect.height * 0.8 - dh) / 2), dw, dh);
      setHasInk(true);
      onChange(cv.toDataURL("image/png"));
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "We couldn't read that photo.");
    } finally {
      URL.revokeObjectURL(url);
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ratio = window.devicePixelRatio || 1;
    const rect = cv.getBoundingClientRect();
    cv.width = Math.max(1, Math.round(rect.width * ratio));
    cv.height = Math.max(1, Math.round(rect.height * ratio));
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = INK;
    if (value) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0, rect.width, rect.height);
      img.src = value;
    }
    // Only on mount: redrawing on every change would fight the stroke in progress.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  return (
    <div>
      <div className="sigwrap">
        <canvas
          ref={canvasRef}
          aria-label="Signature pad. Draw your signature with a mouse, trackpad or finger, or use the upload button below."
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            drawing.current = true;
            const ctx = e.currentTarget.getContext("2d");
            const p = point(e);
            ctx?.beginPath();
            ctx?.moveTo(p.x, p.y);
          }}
          onPointerMove={(e) => {
            if (!drawing.current) return;
            const ctx = e.currentTarget.getContext("2d");
            const p = point(e);
            ctx?.lineTo(p.x, p.y);
            ctx?.stroke();
          }}
          onPointerUp={(e) => {
            if (!drawing.current) return;
            drawing.current = false;
            setHasInk(true);
            onChange(e.currentTarget.toDataURL("image/png"));
          }}
        />
        <span className="sigline" />
        {!hasInk && <span className="sighint">Sign here, or upload a photo below</span>}
      </div>
      <div className="btn-row" style={{ marginTop: 10 }}>
        <button type="button" className="btn quiet sm" disabled={!hasInk} onClick={() => {
          const cv = canvasRef.current;
          cv?.getContext("2d")?.clearRect(0, 0, cv.width, cv.height);
          setHasInk(false);
          onChange(null);
        }}>Clear signature</button>
        <button type="button" className="btn quiet sm" disabled={busy} onClick={() => fileRef.current?.click()}>{busy ? "Reading photo..." : "Or upload a photo of your signature"}</button>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => void fromPhoto(e.target.files?.[0])} />
      </div>
      <p className="tiny" style={{ marginTop: 6 }}>Photo tip: sign with a dark pen on plain white paper, in good light, and keep the signature large in the frame.</p>
      {uploadError && <p className="tiny" role="alert" style={{ color: "var(--bad, #b3261e)", marginTop: 6 }}>{uploadError}</p>}
    </div>
  );
}
