import "server-only";

/**
 * Supabase over plain HTTP (PostgREST for tables, the Storage API for PDFs). No client library, so there is nothing
 * extra to install. Server only: it uses the service-role key, which must never reach the browser.
 */
export interface SupabaseEnv { url: string; serviceKey: string; anonKey: string }

export function supabaseEnv(): SupabaseEnv | null {
  const e = process.env;
  const url = (e.SUPABASE_URL ?? "").trim().replace(/\/+$/, "");
  const serviceKey = (e.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  if (!url || !serviceKey) return null;
  return { url, serviceKey, anonKey: (e.SUPABASE_ANON_KEY ?? "").trim() };
}

export function needSupabase(): SupabaseEnv {
  const s = supabaseEnv();
  if (!s) throw Object.assign(new Error("Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."), { code: "config/supabase" });
  return s;
}

const seg = (p: string) => p.split("/").map(encodeURIComponent).join("/");

async function fail(res: Response, what: string): Promise<never> {
  const text = await res.text().catch(() => "");
  throw Object.assign(new Error(`Supabase ${what} failed (${res.status}) ${text.slice(0, 300)}`), { code: `supabase/${res.status}` });
}

function headers(s: SupabaseEnv, extra: Record<string, string> = {}) {
  return { apikey: s.serviceKey, authorization: `Bearer ${s.serviceKey}`, ...extra };
}

/** Insert, or replace the row with the same id. */
export async function upsertRow(table: string, row: Record<string, unknown>): Promise<void> {
  const s = needSupabase();
  const res = await fetch(`${s.url}/rest/v1/${table}`, {
    method: "POST", headers: headers(s, { "content-type": "application/json", prefer: "resolution=merge-duplicates,return=minimal" }), body: JSON.stringify(row),
  });
  if (!res.ok) await fail(res, `write to ${table}`);
}

export async function selectRows<T>(table: string, query: string): Promise<T[]> {
  const s = needSupabase();
  const res = await fetch(`${s.url}/rest/v1/${table}?${query}`, { headers: headers(s), cache: "no-store" });
  if (!res.ok) await fail(res, `read from ${table}`);
  return (await res.json()) as T[];
}

export async function uploadObject(path: string, bytes: Uint8Array, contentType: string): Promise<void> {
  const s = needSupabase();
  const res = await fetch(`${s.url}/storage/v1/object/${seg(path)}`, {
    method: "POST", headers: headers(s, { "content-type": contentType, "x-upsert": "true" }), body: Buffer.from(bytes),
  });
  if (!res.ok) await fail(res, "file upload");
}

export async function downloadObject(path: string): Promise<Uint8Array> {
  const s = needSupabase();
  const res = await fetch(`${s.url}/storage/v1/object/authenticated/${seg(path)}`, { headers: headers(s), cache: "no-store" });
  if (!res.ok) await fail(res, "file download");
  return new Uint8Array(await res.arrayBuffer());
}
