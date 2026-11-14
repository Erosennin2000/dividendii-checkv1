import "server-only";
import { NextResponse } from "next/server";
import { AccountError, clearCookie, sessionCookie, signSession } from "./account";
import type { PilotLead } from "./types";

export const isSecure = (req: Request) => (req.headers.get("x-forwarded-proto") ?? new URL(req.url).protocol.replace(":", "")) === "https";
export const ipOf = (req: Request) => (req.headers.get("x-forwarded-for") ?? "unknown").split(",")[0].trim();

/** A JSON reply that also signs the person in. */
export function withSession(req: Request, body: unknown, lead: PilotLead, via: "code" | "password") {
  const { value, maxAge } = signSession(lead, via);
  const res = NextResponse.json(body);
  res.headers.append("set-cookie", sessionCookie(value, maxAge, isSecure(req)));
  return res;
}
export function signedOut(req: Request, body: unknown, status = 200) {
  const res = NextResponse.json(body, { status });
  res.headers.append("set-cookie", clearCookie(isSecure(req)));
  return res;
}
export function accountFail(e: unknown, what: string) {
  if (e instanceof AccountError) return NextResponse.json({ error: e.message }, { status: e.status });
  console.error(`[account] ${what} failed`, e);
  return NextResponse.json({ error: "Something went wrong on our side. Try again in a minute." }, { status: 500 });
}
export const forbidden = () => NextResponse.json({ error: "Please use the Dividendii website." }, { status: 403 });
