import { describe, expect, it } from "vitest";

import { pageSpeedReportUrl, parsePageSpeed } from "@/lib/pagespeed";

describe("parsePageSpeed", () => {
  it("extracts score and core metrics", () => {
    const json = {
      lighthouseResult: {
        categories: { performance: { score: 0.87 } },
        audits: {
          "largest-contentful-paint": { numericValue: 2300.4 },
          "cumulative-layout-shift": { numericValue: 0.04 },
          "total-blocking-time": { numericValue: 180 },
        },
      },
    };
    expect(parsePageSpeed(json)).toEqual({
      performanceScore: 87,
      lcpMs: 2300.4,
      cls: 0.04,
      tbtMs: 180,
    });
  });

  it("returns null without a performance score", () => {
    expect(parsePageSpeed({ error: { code: 429 } })).toBeNull();
  });

  it("builds a report link", () => {
    expect(pageSpeedReportUrl("https://a.com/x")).toBe(
      "https://pagespeed.web.dev/analysis?url=https%3A%2F%2Fa.com%2Fx&form_factor=mobile",
    );
  });
});
