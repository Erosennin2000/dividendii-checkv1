import { NextResponse } from "next/server";
import { getPilotStore } from "@/lib/pilot/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Public and harmless: reads one record so Supabase's free plan sees activity and doesn't pause the project
 * after a week of quiet. Called weekly by the cron in vercel.json (or any free pinger). Returns no data.
 */
export async function GET() {
  try {
    await (await getPilotStore()).list(1);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[pilot] keepalive failed", e);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
