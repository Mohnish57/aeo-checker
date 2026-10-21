/**
 * CDN caching for /api/audit results. A complete result is cached for a day;
 * one where PageSpeed Insights was unavailable is cached briefly, so the
 * "re-run the audit" advice in the UI can actually produce a full result.
 */
import type { AuditResult } from "@/lib/audit-types";

export const FULL_RESULT_CACHE_HEADERS = {
  "Cache-Control": "public, max-age=900",
  "CDN-Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
  "Vercel-CDN-Cache-Control":
    "public, s-maxage=86400, stale-while-revalidate=604800",
} as const;

export const DEGRADED_RESULT_CACHE_HEADERS = {
  "Cache-Control": "public, max-age=60",
  "CDN-Cache-Control": "public, s-maxage=300",
  "Vercel-CDN-Cache-Control": "public, s-maxage=300",
} as const;

export function auditCacheHeaders(audit: AuditResult): Record<string, string> {
  return audit.diagnostics.pageSpeed === "ready"
    ? FULL_RESULT_CACHE_HEADERS
    : DEGRADED_RESULT_CACHE_HEADERS;
}
