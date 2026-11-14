import { NextResponse } from "next/server";
import { AdminError, requirePilotAdmin } from "@/lib/pilot/admin";
import { PILOT_REGISTRARS } from "@/lib/pilot/config";
import { paystackMode } from "@/lib/pilot/paystack";
import { defaultSettings, effectiveSettings, smtpStatus } from "@/lib/pilot/settings";
import { mergeStored, parseSettingsPatch, type PilotSettings } from "@/lib/pilot/settingsShared";
import { getPilotStore } from "@/lib/pilot/store";
import { DIRECTORY } from "@/lib/forms/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function view(settings: PilotSettings) {
  const d = defaultSettings();
  return {
    settings,
    smtp: smtpStatus(),
    paystack: paystackMode(),
    registrars: PILOT_REGISTRARS.map((r) => ({
      id: r.id, name: r.name,
      formEmail: d.registrars[r.id].email, // what the registrar's own form says (or the server override), shown so a blank box makes sense
      companies: DIRECTORY.filter((e) => e.registrarId === r.id).length,
    })),
  };
}

/** Staff only: current settings. */
export async function GET(req: Request) {
  try {
    await requirePilotAdmin(req);
    return NextResponse.json(await view(effectiveSettings(await (await getPilotStore()).getSettings())));
  } catch (e) {
    if (e instanceof AdminError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("[pilot] settings load failed", e);
    return NextResponse.json({ error: "Couldn't load the settings." }, { status: 500 });
  }
}

/** Staff only: save changes. Only the fields sent are changed. */
export async function PUT(req: Request) {
  try {
    await requirePilotAdmin(req);
    let patch;
    try { patch = parseSettingsPatch(await req.json().catch(() => null)); } catch (e) { throw new AdminError(400, (e as Error).message); }
    const store = await getPilotStore();
    const next = { ...mergeStored(await store.getSettings(), patch), updatedAt: new Date().toISOString(), updatedBy: "staff" };
    await store.saveSettings(next);
    return NextResponse.json(await view(effectiveSettings(next)));
  } catch (e) {
    if (e instanceof AdminError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("[pilot] settings save failed", e);
    return NextResponse.json({ error: e instanceof Error && e.message.startsWith("Couldn't save settings") ? e.message : "Couldn't save. Nothing was changed. Try again." }, { status: 500 });
  }
}
