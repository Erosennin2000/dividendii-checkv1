import { signedOut } from "@/lib/pilot/accountRoute";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) { return signedOut(req, { ok: true }); }
