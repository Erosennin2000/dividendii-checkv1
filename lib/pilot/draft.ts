/**
 * The form's tab-only draft (sessionStorage): how long it may sit unused, and what it must never hold.
 * Kept free of React so the rules can be tested.
 */
export const DRAFT_TTL_MS = 30 * 60_000;

/** True when the draft was last touched more than DRAFT_TTL_MS ago. A missing time counts as fresh (nothing to judge by). */
export function draftExpired(lastActive: number | null | undefined, now: number = Date.now(), ttl: number = DRAFT_TTL_MS): boolean {
  if (typeof lastActive !== "number" || !Number.isFinite(lastActive)) return false;
  return now - lastActive > ttl;
}

/** The most sensitive typed answers are not kept in the browser. After a refresh the person types the BVN again. */
export function draftSafeProfile<T extends { bvn?: string }>(profile: T): T {
  return { ...profile, bvn: "" };
}
