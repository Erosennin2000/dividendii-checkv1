import { NextResponse } from "next/server";
import { AdminError, requirePilotAdmin } from "@/lib/pilot/admin";
import { getPilotStore } from "@/lib/pilot/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Staff only: every pilot submission, newest first. */
export async function GET(req: Request) {
  try {
    await requirePilotAdmin(req);
    const list = await (await getPilotStore()).list(500);
    return NextResponse.json({ submissions: list });
  } catch (e) {
    if (e instanceof AdminError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("[pilot] list failed", e);
    return NextResponse.json({ error: "Couldn't load submissions." }, { status: 500 });
  }
}
