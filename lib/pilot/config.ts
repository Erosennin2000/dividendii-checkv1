/**
 * Pilot settings that are safe to import anywhere (browser or server).
 * The pilot covers every registrar we have a form for (21). Everything else about the pilot lives in lib/pilot/.
 */
import { DIRECTORY } from "@/lib/forms/registry";

export const PILOT_BRAND = "Dividendii";

/**
 * Registrars covered by the pilot: every registrar that has a mandate-form template in lib/forms/templates.json.
 * `email` is the address printed on that registrar's own form. Override any of them without a code change by setting
 * PILOT_EMAIL_OVERRIDES to JSON, e.g. {"centurion":"customercare@centurionregistrars.com"}.
 */
export const PILOT_REGISTRARS = [
  { id: "africaprudential", name: "Africa Prudential Registrars", email: "info@africaprudentialregistrars.com" },
  { id: "apel", name: "Apel Capital Registrars", email: "registrars@apel.ng" },
  { id: "atlas", name: "Atlas Registrars", email: "registrars@atlasregistrars.com" },
  { id: "cardinalstone", name: "CardinalStone Registrars", email: "registrars@cardinalstone.com" },
  { id: "carnation", name: "Carnation Registrars", email: "info@carnationregistrars.com" },
  // The form prints "cusomercare@" (sic). Check it before going live, or set PILOT_EMAIL_OVERRIDES.
  { id: "centurion", name: "Centurion Registrars", email: "cusomercare@centurionregistrars.com" },
  { id: "cordros", name: "Cordros Registrars", email: "contactcentre@cordros.com" },
  { id: "coronation", name: "Coronation Registrars", email: "customercare@coronationregistrars.com" },
  { id: "datamax", name: "Datamax Registrars", email: "datamax@datamaxregistrars.com" },
  // The form prints a complaints mailbox. Confirm EDC will accept mandates there.
  { id: "edc", name: "EDC Registrars", email: "EdcRegComplaints@ecobank.com" },
  { id: "first", name: "First Registrars", email: "info@firstregistrarsnigeria.com" },
  { id: "flourmills", name: "Flour Mills Registrars", email: "registrars@fmnregistrar.com" },
  { id: "greenwich", name: "Greenwich Registrars", email: "info@gtlregistrars.com" },
  { id: "lancelot", name: "Lancelot Registrars", email: "info@lancelotregistrars.com" },
  { id: "lighthouse", name: "Lighthouse Registrars", email: "info@lighthousereg.com" },
  { id: "mainstreet", name: "MainstreetBank Registrars", email: "mainstreetregistrars@yahoo.com" },
  { id: "meristem", name: "Meristem Registrars", email: "info@meristemregistrars.com" },
  { id: "pac", name: "PAC Registrars", email: "info@pacregistrars.com" },
  { id: "pace", name: "Pace Registrars", email: "info@paceregistrars.com" },
  { id: "unity", name: "Unity Registrars", email: "info@unityregistrarsng.com" },
  { id: "veritas", name: "Veritas Registrars", email: "enquiry@veritasregistrars.com" },
] as const;
export type PilotRegistrarId = (typeof PILOT_REGISTRARS)[number]["id"];

export const pilotRegistrar = (id: string) => PILOT_REGISTRARS.find((r) => r.id === id) ?? null;

/** The address a registrar's email really goes to in live mode: the form's address unless PILOT_EMAIL_OVERRIDES replaces it. */
export function registrarAddress(id: string): string {
  const base = pilotRegistrar(id)?.email ?? "";
  try {
    const o = JSON.parse((typeof process !== "undefined" && process.env?.PILOT_EMAIL_OVERRIDES) || "{}") as Record<string, unknown>;
    const v = o[id];
    return typeof v === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()) ? v.trim() : base;
  } catch {
    return base;
  }
}

/** Pay-ahead price per company, in naira. */
export const PAY_AHEAD_PER_COMPANY = 150;
/** Success fee, on dividends actually received. (Start fee above is per company, plus 7.5% VAT, paid before the forms are sent.) */
export const DEBIT_RATE = 0.05;

export const MAX_COMPANIES = 60;

/** Companies we won't offer in the pilot even if a form lists something close. */
const NOT_COVERED = [/^FBN HOLDINGS/i];

export interface PilotCompany { registrarId: PilotRegistrarId; registrar: string; company: string }

/** Every company printed on the registrars' forms, sorted. Used for the dropdowns and for checking submissions. */
export const PILOT_COMPANIES: PilotCompany[] = DIRECTORY
  .filter((e) => PILOT_REGISTRARS.some((r) => r.id === e.registrarId) && !NOT_COVERED.some((re) => re.test(e.company)))
  .map((e) => ({ registrarId: e.registrarId as PilotRegistrarId, registrar: e.registrar, company: e.company }))
  .sort((a, b) => a.company.localeCompare(b.company));

export const companiesFor = (registrarId: string) => PILOT_COMPANIES.filter((c) => c.registrarId === registrarId);

export const payAheadTotal = (companyCount: number) => Math.max(0, companyCount) * PAY_AHEAD_PER_COMPANY;
