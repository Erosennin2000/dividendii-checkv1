"use client";

import { useMemo, useState } from "react";

/** A dropdown whose rows are tick boxes. Pick as many as you like, then add them all at once. */
export function CompanyPicker({ options, disabled, placeholder, onAdd }: {
  options: string[];
  disabled?: boolean;
  placeholder: string;
  onAdd: (companies: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [ticked, setTicked] = useState<string[]>([]);

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? options.filter((o) => o.toLowerCase().includes(t)) : options;
  }, [options, q]);
  const live = ticked.filter((t) => options.includes(t)); // options shrink as companies are added
  const allShownTicked = shown.length > 0 && shown.every((o) => live.includes(o));

  const toggle = (c: string) => setTicked((t) => (t.includes(c) ? t.filter((x) => x !== c) : [...t, c]));
  const toggleShown = () => setTicked(allShownTicked ? live.filter((t) => !shown.includes(t)) : [...new Set([...live, ...shown])]);
  const close = () => { setOpen(false); setQ(""); };
  const add = () => { if (live.length) onAdd(live); setTicked([]); close(); };

  return (
    <div className="picker">
      <label className="label" style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Companies</label>
      <button type="button" className="input picker-btn" disabled={disabled} aria-expanded={open} onClick={() => (open ? close() : setOpen(true))}>
        <span style={{ color: live.length ? "var(--ink)" : "var(--ink-3)" }}>{live.length ? `${live.length} ticked` : placeholder}</span>
        <span aria-hidden>{open ? "▴" : "▾"}</span>
      </button>
      {open && !disabled && (
        <div className="picker-panel">
          <div className="picker-tools">
            <input className="input" placeholder="Search companies" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
            <button type="button" className="btn quiet sm" onClick={toggleShown}>{allShownTicked ? "Untick" : q ? "Tick these" : "Tick all"}</button>
          </div>
          <div className="picker-list" role="group" aria-label="Companies">
            {shown.length === 0 && <p className="tiny" style={{ padding: 10 }}>{options.length ? "No match." : "You've added every company for this registrar."}</p>}
            {shown.map((c) => (
              <button key={c} type="button" role="checkbox" aria-checked={live.includes(c)} className="pick" onClick={() => toggle(c)}>
                <span className="box"><svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden><path d="M3.2 8.4l3 3 6.6-7" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg></span>
                <span>{c}</span>
              </button>
            ))}
          </div>
          <div className="picker-foot">
            <span className="tiny">{live.length} ticked</span>
            <span style={{ display: "flex", gap: 8 }}>
              <button type="button" className="btn ghost sm" onClick={close}>Close</button>
              <button type="button" className="btn sm" disabled={!live.length} onClick={add}>{live.length ? `Add ${live.length} ${live.length === 1 ? "company" : "companies"}` : "Add"}</button>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
