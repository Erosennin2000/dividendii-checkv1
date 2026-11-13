import { NextResponse } from "next/server";
import { effectiveSettings, publicConfig } from "@/lib/pilot/settings";
import { getPilotStore } from "@/lib/pilot/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Public. What the pilot form needs to know: which registrars are on, the prices, and whether submissions are paused. Nothing private. */
export async function GET() {
  try {
    const s = effectiveSettings(await (await getPilotStore()).getSettings());
    return NextResponse.json(publicConfig(s));
  } catch (e) {
    console.error("[pilot] config failed", e);
    return NextResponse.json({ error: "Couldn't load the form settings. Try again in a minute." }, { status: 500 });
  }
}
