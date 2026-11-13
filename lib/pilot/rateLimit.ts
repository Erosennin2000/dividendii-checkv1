/**
 * A light brake on the public submit route, per caller address, so a script can't make us email registrars in a loop.
 * In memory, so on serverless it limits per warm instance. It is a speed bump, not a wall.
 */
const hits = new Map<string, number[]>();

export function tooMany(key: string, max = 6, windowMs = 60 * 60_000, now = Date.now()): boolean {
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= max) { hits.set(key, recent); return true; }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k);
  return false;
}

export const resetRateLimit = () => hits.clear();
