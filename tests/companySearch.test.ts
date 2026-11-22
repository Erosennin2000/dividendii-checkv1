import { describe, expect, it } from "vitest";
import { PILOT_COMPANIES } from "@/lib/pilot/config";
import { NOT_COVERED_HINT, SHORT_NAMES, searchCompanies, tokens } from "@/lib/pilot/companySearch";

const top = (q: string, n = 1) => searchCompanies(q, PILOT_COMPANIES, n).map((h) => `${h.company}|${h.registrarId}`);
const names = (q: string) => searchCompanies(q, PILOT_COMPANIES).map((h) => h.company.toLowerCase());

describe("company search", () => {
  it("ignores case, punctuation, accents and filler words", () => {
    expect(tokens("FLOUR MILLS OF NIG. PLC")).toEqual(["flour", "mills"]);
    expect(tokens("Nestlé  Nigeria PLC")).toEqual(["nestle"]);
    expect(tokens("Stanbic IBTC Bank PLC & Notes")).toEqual(["stanbic", "ibtc", "bank", "notes"]);
  });

  it("finds a company from part of its name and returns the registrar we have on file", () => {
    expect(top("zenith")[0]).toBe("Zenith Bank Plc|veritas");
    expect(top("MTN")[0]).toBe("MTN Nigeria Communication PLC|coronation");
    expect(top("dangote cement")[0]).toBe("Dangote Cement PLC|coronation");
    expect(top("nestle")[0]).toBe("Nestle Nigeria PLC|greenwich");
    expect(top("  UNILEVER  ")[0]).toBe("Unilever Nigeria PLC|greenwich");
    expect(top("seplat")[0]).toBe("Seplat Energy Plc|datamax");
    expect(top("julius berger")[0]).toBe("Julius Berger Nigeria PLC|greenwich");
  });

  it("puts the company itself before its funds and bonds", () => {
    expect(top("access bank")[0]).toBe("Access Bank PLC|coronation");
    expect(top("stanbic ibtc")[0]).toBe("STANBIC IBTC HOLDINGS PLC|first");
    expect(names("zenith").slice(0, 1)).toEqual(["zenith bank plc"]);
  });

  it("knows what people call companies", () => {
    expect(top("GTCO")[0]).toBe("Guaranty Trust Holding Company Plc|datamax");
    expect(top("gtbank")[0]).toBe("Guaranty Trust Holding Company Plc|datamax");
    expect(top("UBA")[0]).toBe("UNITED BANK FOR AFRICA PLC|africaprudential");
    expect(top("access holdings")[0]).toBe("Access Bank PLC|coronation");
    expect(top("wapco")[0]).toBe("LAFARGE AFRICA PLC|cardinalstone");
    expect(top("nigerian breweries")[0]).toBe("NIGERIAN BREWERIES PLC|first");
  });

  it("every short name points at something that is really on our list", () => {
    for (const [k, v] of Object.entries(SHORT_NAMES)) {
      expect(searchCompanies(v, PILOT_COMPANIES, 1).length, `${k} -> ${v}`).toBe(1);
      expect(searchCompanies(k, PILOT_COMPANIES, 1).length, k).toBe(1);
    }
  });

  it("forgives a slip in spelling", () => {
    expect(top("zenth bank")[0]).toBe("Zenith Bank Plc|veritas");
    expect(top("dangoet cement")[0]).toBe("Dangote Cement PLC|coronation");
    expect(top("unilver")[0]).toBe("Unilever Nigeria PLC|greenwich");
  });

  it("does not turn a company we do not list into a random bank", () => {
    expect(searchCompanies("ecobank", PILOT_COMPANIES)).toEqual([]);
    expect(searchCompanies("sterling", PILOT_COMPANIES).map((h) => h.company)).not.toContain("EUNISELL INTERLINKED PLC");
  });

  it("a real match hides the guesses", () => {
    expect(searchCompanies("presco", PILOT_COMPANIES).map((h) => h.company)).toEqual(["PRESCO PLC"]);
    expect(searchCompanies("unilver", PILOT_COMPANIES).map((h) => h.company)).toEqual(["Unilever Nigeria PLC"]);
  });

  it("shows both rows when one company is listed under two registrars, and marks them", () => {
    const hits = searchCompanies("international breweries", PILOT_COMPANIES);
    const rows = hits.filter((h) => h.company === "INTERNATIONAL BREWERIES PLC");
    expect(rows.map((r) => r.registrarId).sort()).toEqual(["africaprudential", "apel"]);
    expect(rows.every((r) => r.alsoElsewhere)).toBe(true);
    expect(searchCompanies("zenith bank", PILOT_COMPANIES)[0].alsoElsewhere).toBe(false);
    const flour = searchCompanies("flour mills", PILOT_COMPANIES).filter((h) => h.company === "FLOUR MILLS OF NIG. PLC");
    expect(flour.length).toBe(2);
  });

  it("returns nothing for too little or nonsense, and respects the switched-on registrars", () => {
    expect(searchCompanies("", PILOT_COMPANIES)).toEqual([]);
    expect(searchCompanies("z", PILOT_COMPANIES)).toEqual([]);
    expect(searchCompanies("qqqqxxxx", PILOT_COMPANIES)).toEqual([]);
    expect(searchCompanies("zenith", PILOT_COMPANIES.filter((c) => c.registrarId !== "veritas", )).map((h) => h.company)).not.toContain("Zenith Bank Plc");
    expect(searchCompanies("mtn", PILOT_COMPANIES, 3).length).toBeLessThanOrEqual(3);
  });

  it("says plainly that FBN Holdings and First Bank are not covered", () => {
    expect(searchCompanies("fbn holdings", PILOT_COMPANIES).some((h) => /holdings/i.test(h.company) && /^fbn/i.test(h.company))).toBe(false);
    expect(NOT_COVERED_HINT.test("FBN Holdings")).toBe(true);
    expect(NOT_COVERED_HINT.test("first bank")).toBe(true);
    expect(NOT_COVERED_HINT.test("zenith")).toBe(false);
  });
});
