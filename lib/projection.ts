/**
 * "Score after fixes": what the page would score if the site-fixable issues
 * passed. Pure and client-safe, so the results page can recompute it.
 */
import type { AuditCategory, AuditItem } from "@/lib/audit-types";
import { guideFor } from "@/lib/fix-guide";

/**
 * Failing any of these keeps the page out of AI answers no matter how well
 * the rest scores, so the total is capped in the Critical band.
 */
export const BLOCKING_RULE_IDS = ["A8", "A12", "A13"] as const;
export const BLOCKED_SCORE_CAP = 40;

export function isBlocker(item: AuditItem): boolean {
  return (
    item.status === "fail" &&
    (BLOCKING_RULE_IDS as readonly string[]).includes(item.id)
  );
}

export function isActionable(item: AuditItem): boolean {
  return item.status === "fail" || item.status === "partial";
}

/** Points the page gains when this item passes. */
export function gainOf(item: AuditItem): number {
  return Math.max(0, item.maxScore - item.score);
}

/**
 * Site-fixable, failing or partial items: blockers first (they lift the
 * cap), then the biggest point gains.
 */
export function rankFixes(categories: AuditCategory[]): AuditItem[] {
  return categories
    .flatMap((category) => category.items)
    .filter((item) => isActionable(item) && guideFor(item.id).siteFix)
    .sort(
      (a, b) =>
        Number(isBlocker(b)) - Number(isBlocker(a)) ||
        gainOf(b) - gainOf(a) ||
        a.id.localeCompare(b.id),
    );
}

/**
 * Score with `fixed` items passing (default: every site-fixable issue).
 * Item scores are rounded to 0.1, so the sum is clamped to 100.
 */
export function projectedScore(
  categories: AuditCategory[],
  fixed: Set<string> = new Set(rankFixes(categories).map((item) => item.id)),
): number {
  const items = categories.flatMap((category) => category.items);
  const after = items.map((item) =>
    fixed.has(item.id) ? { ...item, status: "pass" as const, score: item.maxScore } : item,
  );
  const total = after.reduce((sum, item) => sum + item.score, 0);
  const cap = after.some(isBlocker) ? BLOCKED_SCORE_CAP : 100;
  return Math.round(Math.min(total, cap) * 10) / 10;
}
