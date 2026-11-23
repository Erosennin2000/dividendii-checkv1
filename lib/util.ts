export function uid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/** Dates are labelled in Lagos time, so server-written events (Vercel runs in UTC) match what the shareholder sees. */
const TZ = "Africa/Lagos";

export function today(): string {
  return new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: TZ });
}

export function inDays(days: number): string {
  const d = new Date(Date.now() + days * 86_400_000);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: TZ });
}

export function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function errorMessage(e: unknown): string {
  // A dropped connection shows up as the browser's own words ("Failed to fetch", "Load failed"): say what to do instead.
  if (e instanceof Error && /^(failed to fetch|load failed|networkerror|network request failed)/i.test(e.message)) return "We could not connect. Check your internet and try again.";
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  return "Something went wrong. Try again.";
}

/** Only allow same-site relative redirects after sign-in. */
export function safeNext(next: string | null | undefined, fallback = "/dashboard"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return fallback;
  return next;
}

export function maskTail(value: string | null | undefined, visible = 4): string {
  if (!value) return "Not given";
  const v = value.replace(/\s/g, "");
  if (v.length <= visible) return v;
  return "\u2022".repeat(v.length - visible) + v.slice(-visible);
}
