import "server-only";
import { DATA_SOURCE } from "@/lib/config";
import type { StoredSettings } from "./settingsShared";
import type { PilotLead, PilotSubmission } from "./types";

export const PILOT_COLLECTION = "pilotSubmissions";
export const LEADS_COLLECTION = "pilotLeads";
export const SETTINGS_COLLECTION = "pilotSettings";
export const SETTINGS_DOC = "main";

export interface PilotStore {
  /** Writes the record and its files together. The record is saved before any email goes out. */
  save(sub: PilotSubmission, files: { path: string; bytes: Uint8Array; contentType: string }[]): Promise<void>;
  update(id: string, patch: Partial<PilotSubmission>): Promise<void>;
  get(id: string): Promise<PilotSubmission | null>;
  /** Newest first. */
  list(limit?: number): Promise<PilotSubmission[]>;
  readFile(path: string): Promise<Uint8Array>;
  /** Insert or replace a lead (one per email). */
  saveLead(lead: PilotLead): Promise<void>;
  getLead(id: string): Promise<PilotLead | null>;
  /** Newest activity first. */
  listLeads(limit?: number): Promise<PilotLead[]>;
  /** What the admin saved on the settings page, or null if nothing yet. */
  getSettings(): Promise<StoredSettings | null>;
  saveSettings(s: StoredSettings): Promise<void>;
}

const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v)); // Firestore rejects undefined fields

/** Local dev with no Firebase: lives in the server process, gone on restart. */
export function memoryStore(): PilotStore {
  const g = globalThis as unknown as { __pilotMem?: { subs: Map<string, PilotSubmission>; files: Map<string, Uint8Array>; leads: Map<string, PilotLead> } };
  const mem = (g.__pilotMem ??= { subs: new Map(), files: new Map(), leads: new Map() });
  mem.leads ??= new Map();
  const gs = globalThis as unknown as { __pilotSettings?: StoredSettings | null };
  return {
    async save(sub, files) {
      mem.subs.set(sub.id, plain(sub));
      for (const f of files) mem.files.set(f.path, f.bytes);
    },
    async update(id, patch) {
      const cur = mem.subs.get(id);
      if (!cur) throw new Error("Submission not found.");
      mem.subs.set(id, plain({ ...cur, ...patch }));
    },
    async get(id) { const s = mem.subs.get(id); return s ? plain(s) : null; },
    async list(limit = 500) {
      return [...mem.subs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit).map(plain);
    },
    async readFile(path) {
      const f = mem.files.get(path);
      if (!f) throw new Error("File not found.");
      return f;
    },
    async getSettings() { return gs.__pilotSettings ? plain(gs.__pilotSettings) : null; },
    async saveSettings(st) { gs.__pilotSettings = plain(st); },
    async saveLead(lead) { mem.leads.set(lead.id, plain(lead)); },
    async getLead(id) { const l = mem.leads.get(id); return l ? plain(l) : null; },
    async listLeads(limit = 1000) {
      return [...mem.leads.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, limit).map(plain);
    },
  };
}

/** Firestore for the record, Storage for the PDFs. Server (service account) only. */
export async function firebaseStore(): Promise<PilotStore> {
  const { adminBucket, adminDb } = await import("@/lib/firebase/admin");
  const col = () => adminDb().collection(PILOT_COLLECTION);
  return {
    async save(sub, files) {
      // Files first: a record must never point at a PDF that isn't there.
      for (const f of files) await adminBucket().file(f.path).save(Buffer.from(f.bytes), { contentType: f.contentType, resumable: false });
      await col().doc(sub.id).set(plain(sub));
    },
    async update(id, patch) { await col().doc(id).update(plain(patch) as Record<string, unknown>); },
    async get(id) {
      const d = await col().doc(id).get();
      return d.exists ? (d.data() as PilotSubmission) : null;
    },
    async list(limit = 500) {
      const snap = await col().orderBy("createdAt", "desc").limit(limit).get();
      return snap.docs.map((d) => d.data() as PilotSubmission);
    },
    async readFile(path) {
      const [buf] = await adminBucket().file(path).download();
      return new Uint8Array(buf);
    },
    async getSettings() {
      const d = await adminDb().collection(SETTINGS_COLLECTION).doc(SETTINGS_DOC).get();
      return d.exists ? (d.data() as StoredSettings) : null;
    },
    async saveSettings(st) { await adminDb().collection(SETTINGS_COLLECTION).doc(SETTINGS_DOC).set(plain(st)); },
    async saveLead(lead) { await adminDb().collection(LEADS_COLLECTION).doc(lead.id).set(plain(lead)); },
    async getLead(id) {
      const d = await adminDb().collection(LEADS_COLLECTION).doc(id).get();
      return d.exists ? (d.data() as PilotLead) : null;
    },
    async listLeads(limit = 1000) {
      const snap = await adminDb().collection(LEADS_COLLECTION).orderBy("updatedAt", "desc").limit(limit).get();
      return snap.docs.map((d) => d.data() as PilotLead);
    },
  };
}

/**
 * Supabase Postgres for the records (one jsonb document per submission, with the searchable bits as real columns),
 * Supabase Storage for the PDFs. Tables and bucket are created by supabase/pilot.sql.
 */
export async function supabaseStore(): Promise<PilotStore> {
  const { selectRows, upsertRow, uploadObject, downloadObject } = await import("./supabase");
  const subRow = (s: PilotSubmission) => ({ id: s.id, ref: s.ref, created_at: s.createdAt, email: s.profile.email, send_status: s.sendStatus, mode: s.mode, data: plain(s) });
  const leadRow = (l: PilotLead) => ({ id: l.id, email: l.email, updated_at: l.updatedAt, data: plain(l) });
  const one = async (id: string) => (await selectRows<{ data: PilotSubmission }>("pilot_submissions", `select=data&id=eq.${encodeURIComponent(id)}&limit=1`))[0]?.data ?? null;
  return {
    async save(sub, files) {
      for (const f of files) await uploadObject(f.path, f.bytes, f.contentType); // files first: a record must never point at a missing PDF
      await upsertRow("pilot_submissions", subRow(sub));
    },
    async update(id, patch) {
      const cur = await one(id);
      if (!cur) throw new Error("Submission not found.");
      await upsertRow("pilot_submissions", subRow({ ...cur, ...patch }));
    },
    get: one,
    async list(limit = 500) {
      return (await selectRows<{ data: PilotSubmission }>("pilot_submissions", `select=data&order=created_at.desc&limit=${limit}`)).map((r) => r.data);
    },
    readFile: (path) => downloadObject(path),
    async getSettings() {
      // If the settings table hasn't been created yet, behave as "nothing saved" so the pilot keeps running on the environment defaults.
      try { return (await selectRows<{ data: StoredSettings }>("pilot_settings", "select=data&id=eq.main&limit=1"))[0]?.data ?? null; } catch (e) { console.error("[pilot] settings read failed (has supabase/pilot.sql been run again?)", e); return null; }
    },
    async saveSettings(st) {
      try { await upsertRow("pilot_settings", { id: "main", updated_at: new Date().toISOString(), data: plain(st) }); }
      catch (e) { throw new Error("Couldn't save settings. In Supabase, open SQL Editor and run supabase/pilot.sql once more to create the settings table. " + (e instanceof Error ? e.message.slice(0, 120) : "")); }
    },
    async saveLead(lead) { await upsertRow("pilot_leads", leadRow(lead)); },
    async getLead(id) { return (await selectRows<{ data: PilotLead }>("pilot_leads", `select=data&id=eq.${encodeURIComponent(id)}&limit=1`))[0]?.data ?? null; },
    async listLeads(limit = 1000) {
      return (await selectRows<{ data: PilotLead }>("pilot_leads", `select=data&order=updated_at.desc&limit=${limit}`)).map((r) => r.data);
    },
  };
}

/** PILOT_STORE picks it: supabase, firebase or memory. With nothing set: Supabase if its keys are there, else Firebase in firebase mode, else memory. */
export async function getPilotStore(): Promise<PilotStore> {
  const want = (process.env.PILOT_STORE ?? "").trim().toLowerCase();
  if (want === "supabase" || (!want && process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)) return supabaseStore();
  if (want === "firebase" || (!want && DATA_SOURCE === "firebase")) return firebaseStore();
  return memoryStore();
}
