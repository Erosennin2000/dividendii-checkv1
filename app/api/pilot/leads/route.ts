import { NextResponse } from "next/server";
import { AdminError, requirePilotAdmin } from "@/lib/pilot/admin";
import { leadView } from "@/lib/pilot/leads";
import { getPilotStore } from "@/lib/pilot/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Staff only: everyone who has started the pilot, with their email and CHN/CSCS, finished or not. */
export async function GET(req: Request) {
  try {
    await requirePilotAdmin(req);
    const leads = await (await getPilotStore()).listLeads(1000);
    return NextResponse.json({ leads: leads.map(leadView) });
  } catch (e) {
    if (e instanceof AdminError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("[pilot] leads failed", e);
    return NextResponse.json({ error: "Couldn't load leads." }, { status: 500 });
  }
}
