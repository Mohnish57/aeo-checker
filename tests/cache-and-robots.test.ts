import { describe, expect, it } from "vitest";

import robots from "@/app/robots";
import { auditFromSources } from "@/lib/audit";
import {
  DEGRADED_RESULT_CACHE_HEADERS,
  FULL_RESULT_CACHE_HEADERS,
  auditCacheHeaders,
} from "@/lib/cache-headers";

import { makeSources } from "./helpers/sources";

describe("auditCacheHeaders", () => {
  it("caches a complete result for a day", () => {
    expect(auditCacheHeaders(auditFromSources(makeSources()))).toBe(
      FULL_RESULT_CACHE_HEADERS,
    );
  });

  it("caches a result without PageSpeed for 5 minutes only", () => {
    const headers = auditCacheHeaders(auditFromSources(makeSources({ pageSpeed: null })));
    expect(headers).toBe(DEGRADED_RESULT_CACHE_HEADERS);
    expect(headers["Vercel-CDN-Cache-Control"]).toBe("public, s-maxage=300");
    expect(Object.values(headers).join(" ")).not.toContain("stale-while-revalidate");
  });
});

describe("robots.txt", () => {
  it("keeps every crawler off the audit pages and the API", () => {
    const rules = [robots().rules].flat();
    expect(rules.length).toBeGreaterThan(1);
    for (const rule of rules) {
      expect([rule.userAgent, [rule.disallow].flat()]).toEqual([
        rule.userAgent,
        expect.arrayContaining(["/api/", "/audit/"]),
      ]);
    }
  });
});
