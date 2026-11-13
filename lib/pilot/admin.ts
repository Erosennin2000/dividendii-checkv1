import "server-only";
import { DATA_SOURCE } from "@/lib/config";
import { supabaseEnv } from "./supabase";

export class AdminError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** Who may open the staff page. PILOT_ADMIN_EMAILS is a comma list; PILOT_ADMIN_EMAIL (one address) also counts. */
export function adminEmails(): string[] {
  const e = process.env;
  return `${e.PILOT_ADMIN_EMAILS ?? ""},${e.PILOT_ADMIN_EMAIL ?? ""}`.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
}

/** True when staff sign in with a Supabase Auth account (email and password). */
export function usesSupabaseAuth(): boolean {
  const want = (process.env.PILOT_STORE ?? "").trim().toLowerCase();
  return !!supabaseEnv() && want !== "firebase" && want !== "memory";
}

/** Signs a staff member in with Supabase Auth. Returns the access token the staff page sends with every request. */
export async function adminLogin(email: string, password: string): Promise<{ token: string; expiresIn: number; email: string }> {
  const sb = supabaseEnv();
  if (!sb?.anonKey) throw new AdminError(500, "SUPABASE_ANON_KEY is not set.");
  const mail = email.trim().toLowerCase();
  if (!adminEmails().includes(mail)) throw new AdminError(403, "That email isn't on the staff list.");
  const res = await fetch(`${sb.url}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: sb.anonKey, "content-type": "application/json" }, body: JSON.stringify({ email: mail, password }),
  });
  if (!res.ok) throw new AdminError(401, "Wrong email or password.");
  const j = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!j.access_token) throw new AdminError(401, "Wrong email or password.");
  return { token: j.access_token, expiresIn: j.expires_in ?? 3600, email: mail };
}

/** Every staff route starts here. Throws AdminError (401 or 403) unless the caller is staff. */
export async function requirePilotAdmin(req: Request): Promise<void> {
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";

  if (usesSupabaseAuth()) {
    const sb = supabaseEnv()!;
    if (!sb.anonKey) throw new AdminError(500, "SUPABASE_ANON_KEY is not set.");
    if (!token) throw new AdminError(401, "Sign in to continue.");
    const res = await fetch(`${sb.url}/auth/v1/user`, { headers: { apikey: sb.anonKey, authorization: `Bearer ${token}` }, cache: "no-store" });
    if (!res.ok) throw new AdminError(401, "Your session has ended. Sign in again.");
    const email = String(((await res.json()) as { email?: string }).email ?? "").toLowerCase();
    if (!adminEmails().includes(email)) throw new AdminError(403, "That account isn't on the staff list.");
    return;
  }
  if (DATA_SOURCE === "firebase") {
    const { caller, requireOps, HttpError } = await import("@/lib/server/http");
    try { requireOps(await caller(req)); } catch (e) { if (e instanceof HttpError) throw new AdminError(e.status, e.message); throw e; }
    return;
  }
  if (process.env.NODE_ENV === "production") throw new AdminError(401, "Staff sign-in isn't configured. Set the Supabase keys.");
  // Local development with nothing configured: open, so you can click around.
}
