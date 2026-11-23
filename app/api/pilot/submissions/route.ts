import { NextResponse } from "next/server";
import { AdminError, requirePilotAdmin } from "@/lib/pilot/admin";
import { getPilotStore } from "@/lib/pilot/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LIST_LIMIT = 1000;

/** Staff only: the newest 1,000 pilot submission, newest first. */
export async function GET(req: Request) {
  try {
    await requirePilotAdmin(req);
    const store = await getPilotStore();
    const [list, total] = await Promise.all([store.list(LIST_LIMIT), store.countSubmissions().catch(() => 0)]);
    return NextResponse.json({ submissions: list, total: Math.max(total, list.length), limit: LIST_LIMIT });
  } catch (e) {
    if (e instanceof AdminError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("[pilot] list failed", e);
    return NextResponse.json({ error: "Couldn't load submissions." }, { status: 500 });
  }
}
