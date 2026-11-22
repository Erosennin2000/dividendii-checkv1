"use client";

import { useId, useMemo, useState } from "react";
import type { PilotCompany } from "@/lib/pilot/config";
import { Why } from "@/components/Why";
import { NOT_COVERED_HINT, searchCompanies } from "@/lib/pilot/companySearch";

/** Type a company's name, tap the match: it is added and its registrar is filled in from our own list. */
export function CompanySearch({ companies, isHeld, onAdd }: {
  companies: PilotCompany[];
  isHeld: (c: PilotCompany) => boolean;
  onAdd: (c: PilotCompany) => void;
}) {
  const id = useId();
  const [q, setQ] = useState("");
  const asked = q.trim().length >= 2;
  const hits = useMemo(() => searchCompanies(q, companies), [q, companies]);
  const dup = hits.some((h) => h.alsoElsewhere);

  return (
    <div className="find">
      <div className="label-row"><label htmlFor={id} className="label" style={{ display: "block", fontSize: 13, fontWeight: 500 }}>Type the name of a company you hold shares in</label><Why k="search" /></div>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input id={id} className="input" style={{ flex: 1, minWidth: 0 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="For example: Zenith, MTN, Dangote, Nestle" autoComplete="off" autoCapitalize="none" spellCheck={false} />
        {q && <button type="button" className="btn ghost sm" onClick={() => setQ("")}>Clear</button>}
      </div>
      <p className="tiny" style={{ marginTop: 6 }}>Not sure who your registrar is? You don&apos;t need to know. Tap the company and we add it with the right registrar.</p>
      {asked && (
        <div className="find-list" role="group" aria-label="Matching companies" aria-live="polite">
          {NOT_COVERED_HINT.test(q.trim()) && (
            <p className="tiny" style={{ padding: 10 }}>FBN Holdings (First Bank) isn&apos;t covered yet, because First Registrars&apos; form doesn&apos;t list it.</p>
          )}
          {hits.length === 0 && !NOT_COVERED_HINT.test(q.trim()) && (
            <p className="tiny" style={{ padding: 10 }}>We couldn&apos;t find a company with that name on our list. Check the spelling, try a shorter part of the name, or choose the registrar yourself below.</p>
          )}
          {hits.map((h) => {
            const held = isHeld(h);
            return (
              <button key={`${h.registrarId}|${h.company}`} type="button" className="find-row" disabled={held} onClick={() => onAdd(h)}>
                <span className="find-name">{h.company}<span className="tiny"> Registrar: {h.registrar}</span></span>
                <span className="find-act">{held ? "Added ✓" : "Add"}</span>
              </button>
            );
          })}
          {dup && <p className="tiny" style={{ padding: "6px 10px 10px" }}>Some of these appear under more than one registrar. Choose the registrar named on your latest share certificate or statement.</p>}
        </div>
      )}
    </div>
  );
}
