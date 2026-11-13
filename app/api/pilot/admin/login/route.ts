import { NextResponse } from "next/server";
import { AdminError, adminLogin, usesSupabaseAuth } from "@/lib/pilot/admin";
import { tooMany } from "@/lib/pilot/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Staff sign-in. Public, but only emails on the staff list get a token, and tries are limited. */
export async function POST(req: Request) {
  try {
    const ip = (req.headers.get("x-forwarded-for") ?? "unknown").split(",")[0].trim();
    if (tooMany(`admin:${ip}`, 10, 15 * 60_000)) return NextResponse.json({ error: "Too many tries. Wait a few minutes." }, { status: 429 });
    if (!usesSupabaseAuth()) return NextResponse.json({ ok: true, open: true });
    const b = (await req.json().catch(() => ({}))) as { email?: string; password?: string };
    const r = await adminLogin(String(b.email ?? ""), String(b.password ?? ""));
    return NextResponse.json({ token: r.token, expiresIn: r.expiresIn, email: r.email });
  } catch (e) {
    if (e instanceof AdminError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("[pilot] admin login failed", e);
    return NextResponse.json({ error: "Couldn't sign in. Try again." }, { status: 500 });
  }
}
