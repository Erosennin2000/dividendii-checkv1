"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { STEP_NOTES, WHY, type StepKey, type WhyKey, type WhyText } from "@/lib/pilot/whyCopy";

/**
 * A small (i) beside a question. On a computer it opens a moment after the pointer rests on it; on a phone, tap it.
 * Keyboard: Tab to it, it opens on focus, Esc closes. It floats above the page, so cards that clip their content do not cut it off.
 */
const OPEN_DELAY = 120, CLOSE_DELAY = 160, WIDTH = 320;

export function Why({ k }: { k: WhyKey }) {
  const t: WhyText = WHY[k];
  const id = useId();
  const btn = useRef<HTMLButtonElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number; width: number } | null>(null);

  const place = useCallback(() => {
    const el = btn.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const width = Math.min(WIDTH, window.innerWidth - 24);
    const left = Math.max(12, Math.min(r.left + r.width / 2 - width / 2, window.innerWidth - width - 12));
    // Open below unless the icon is in the lower part of the screen, then open above.
    setPos(r.bottom > window.innerHeight * 0.6 ? { left, bottom: window.innerHeight - r.top + 8, width } : { left, top: r.bottom + 8, width });
  }, []);

  const clear = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } };
  const show = useCallback(() => { place(); setOpen(true); }, [place]);
  const hide = useCallback(() => { clear(); setOpen(false); setPinned(false); }, []);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!btn.current?.contains(e.target as Node) && !(e.target as HTMLElement).closest?.(`[data-why="${CSS.escape(id)}"]`)) hide(); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { hide(); btn.current?.focus(); } };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", esc); window.removeEventListener("scroll", hide, true); window.removeEventListener("resize", hide); };
  }, [open, hide, id]);
  useEffect(() => clear, []);

  const hover = (e: React.PointerEvent, on: boolean) => {
    if (e.pointerType !== "mouse" || pinned) return; // taps are handled by the click below
    clear();
    timer.current = setTimeout(() => { if (on) show(); else setOpen(false); }, on ? OPEN_DELAY : CLOSE_DELAY);
  };

  return (
    <span className="why">
      <button ref={btn} type="button" className="why-btn" aria-label={`Why we ask: ${t.title}`} aria-expanded={open} aria-describedby={open ? id : undefined}
        onPointerEnter={(e) => hover(e, true)} onPointerLeave={(e) => hover(e, false)}
        onFocus={show} onBlur={() => { if (!pinned) setOpen(false); }}
        onClick={() => { if (open && pinned) hide(); else { show(); setPinned(true); } }}>
        <span aria-hidden>i</span>
      </button>
      {open && pos && (
        <span id={id} role="tooltip" data-why={id} className="why-pop" style={{ left: pos.left, top: pos.top, bottom: pos.bottom, width: pos.width }}
          onPointerEnter={(e) => { if (e.pointerType === "mouse") clear(); }} onPointerLeave={(e) => hover(e, false)}>
          <b>{t.title}</b>
          <span>{t.why}</span>
          {t.where && <span className="why-where">{t.where}</span>}
          {t.link && <a className="why-where" href={t.link.href} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "underline" }}>{t.link.text}</a>}
        </span>
      )}
    </span>
  );
}

/** "About 2 minutes · Easy (i)" under a step's heading. */
export function StepNote({ k }: { k: StepKey }) {
  const n = STEP_NOTES[k];
  const id = useId();
  const [open, setOpen] = useState(false);
  return (
    <div className="stepnote">
      <span className="chip-time">{n.time}</span>
      <span className="chip-level">{n.level}</span>
      <button type="button" className="why-more" aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)}>
        {open ? "Hide" : "Why this step?"}
      </button>
      {open && <p id={id} className="tiny" style={{ flexBasis: "100%", margin: "6px 0 0" }}>{n.why}</p>}
    </div>
  );
}

/** A label with the (i) beside it, for fields that are not built from TextField. */
export function LabelWithWhy({ htmlFor, children, k }: { htmlFor?: string; children: React.ReactNode; k: WhyKey }) {
  return <div className="label-row">{htmlFor ? <label htmlFor={htmlFor}>{children}</label> : <span className="label">{children}</span>}<Why k={k} /></div>;
}
