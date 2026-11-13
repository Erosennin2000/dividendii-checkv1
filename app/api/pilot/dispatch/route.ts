import { NextResponse } from "next/server";
import { getMailer } from "@/lib/pilot/mail";
import { getPilotStore } from "@/lib/pilot/store";
import { dispatchPilot } from "@/lib/pilot/submit";
import { verifyToken } from "@/lib/pilot/token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Second half of a submission: send the emails. The form calls this the moment it has its reference.
 * It needs the same token as submit, and the submission must belong to that person. A queued submission that
 * never gets here (tab closed) shows as "Queued" in the admin page, with a Send button.
 */
export async function POST(req: Request) {
  try {
    const raw = await req.json().catch(() => null);
    const who = verifyToken(raw?.token);
    if (!who) return NextResponse.json({ error: "Please confirm your email again to continue." }, { status: 401 });
    const store = await getPilotStore();
    const found = typeof raw?.id === "string" ? await store.get(raw.id) : null;
    if (!found || found.leadId !== who.leadId) return NextResponse.json({ error: "Submission not found." }, { status: 404 });
    const sub = await dispatchPilot(found.id, { store, mailer: getMailer() });
    return NextResponse.json({ sendStatus: sub.sendStatus });
  } catch (e) {
    console.error("[pilot] dispatch failed", e);
    return NextResponse.json({ error: "We saved your forms but couldn't send them yet. We'll send them for you." }, { status: 500 });
  }
}
