import { NextResponse } from "next/server";
import { AdminError, requirePilotAdmin } from "@/lib/pilot/admin";
import { leadView } from "@/lib/pilot/leads";
import { EXPORT_KINDS, getPilotStore, type ExportKind } from "@/lib/pilot/store";
import type { PilotLead } from "@/lib/pilot/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAGE = 500;

/**
 * Staff only: one page of everything we hold, for the "Download backup" button. The button asks page by page
 * (so no single reply gets near Vercel's 4.5 MB limit) and joins the pages into one file in the browser.
 * ?kind=submissions|leads|feedback|settings&offset=0. Lead rows lose their code and password hashes.
 */
export async function GET(req: Request) {
  try {
    await requirePilotAdmin(req);
    const url = new URL(req.url);
    const kind = url.searchParams.get("kind") ?? "";
    const store = await getPilotStore();
    if (kind === "settings") return NextResponse.json({ rows: [(await store.getSettings()) ?? {}], next: null });
    if (!EXPORT_KINDS.includes(kind as ExportKind)) throw new AdminError(400, "Unknown kind.");
    const offset = Math.max(0, Math.floor(Number(url.searchParams.get("offset")) || 0));
    let rows = await store.exportPage(kind as ExportKind, offset, PAGE);
    if (kind === "leads") rows = (rows as PilotLead[]).map(leadView);
    return NextResponse.json({ rows, next: rows.length === PAGE ? offset + PAGE : null });
  } catch (e) {
    if (e instanceof AdminError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("[pilot] export failed", e);
    return NextResponse.json({ error: "Couldn't build the backup." }, { status: 500 });
  }
}
