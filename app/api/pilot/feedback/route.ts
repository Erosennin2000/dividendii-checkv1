import { NextResponse } from "next/server";
import { AdminError, requirePilotAdmin } from "@/lib/pilot/admin";
import { getPilotStore } from "@/lib/pilot/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Staff only: feedback from account holders, newest first. */
export async function GET(req: Request) {
  try {
    await requirePilotAdmin(req);
    return NextResponse.json({ feedback: await (await getPilotStore()).listFeedback(500) });
  } catch (e) {
    if (e instanceof AdminError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("[pilot] feedback list failed", e);
    return NextResponse.json({ error: "Couldn't load feedback." }, { status: 500 });
  }
}

/** Staff only: mark one as read or unread. { id, read } */
export async function POST(req: Request) {
  try {
    await requirePilotAdmin(req);
    const b = (await req.json().catch(() => ({}))) as { id?: string; read?: boolean };
    const store = await getPilotStore();
    const f = (await store.listFeedback(1000)).find((x) => x.id === b.id);
    if (!f) throw new AdminError(404, "That feedback isn't there any more.");
    const updated = { ...f, readAt: b.read === false ? null : f.readAt ?? new Date().toISOString() };
    await store.saveFeedback(updated);
    return NextResponse.json({ feedback: updated });
  } catch (e) {
    if (e instanceof AdminError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("[pilot] feedback update failed", e);
    return NextResponse.json({ error: "Couldn't update that." }, { status: 500 });
  }
}
