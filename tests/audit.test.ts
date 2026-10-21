import { describe, expect, it } from "vitest";

import { assertAuditablePage, auditFromSources } from "@/lib/audit";
import { FetchError } from "@/lib/net/safe-fetch";

import { makeSources, statusOf } from "./helpers/sources";

describe("auditFromSources", () => {
  const audit = auditFromSources(makeSources());

  it("scores a well-built article highly", () => {
    expect(audit.score).toBeGreaterThan(70);
  });

  it("category maxima sum to 100", () => {
    const total = audit.categories.reduce((s, c) => s + c.maxScore, 0);
    expect(total).toBeCloseTo(100, 0);
  });

  it("keeps existing rules working on direct-fetched HTML", () => {
    for (const id of ["A1", "A11", "A12", "B2", "B5", "B14", "C1", "C2", "C3", "C5"]) {
      expect([id, statusOf(audit, id)]).toEqual([id, "pass"]);
    }
  });

  it.each([
    ["with PageSpeed", {}],
    ["without PageSpeed", { pageSpeed: null }],
  ])("never scores a category above its maximum or the total above 100 (%s)", (_label, overrides) => {
    const result = auditFromSources(makeSources(overrides));
    for (const category of result.categories) {
      expect([category.id, category.score <= category.maxScore]).toEqual([category.id, true]);
    }
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it("reports diagnostics", () => {
    expect(audit.diagnostics).toMatchObject({
      httpStatus: 200,
      redirects: 0,
      markdownExtract: "ready",
      robotsTxt: "found",
      llmsTxt: "found",
      sitemap: "found",
      pageSpeed: "ready",
    });
  });

  it("uses the final URL for crawlability checks", () => {
    const http = auditFromSources(
      makeSources({ url: "http://acme.com/blog/what-is-a-widget/" }),
    );
    expect(statusOf(http, "A1")).toBe("fail");
  });

  it("judges HTTPS on the final URL, not the requested one", () => {
    const upgraded = auditFromSources(
      makeSources({
        url: "http://acme.com/blog/what-is-a-widget/",
        finalUrl: "https://acme.com/blog/what-is-a-widget/",
      }),
    );
    expect(statusOf(upgraded, "A1")).toBe("pass");
  });

  it("builds the PageSpeed report link from the final URL", () => {
    const upgraded = auditFromSources(
      makeSources({
        url: "http://acme.com/blog/what-is-a-widget/",
        finalUrl: "https://acme.com/blog/what-is-a-widget/",
      }),
    );
    expect(upgraded.diagnostics.pageSpeedReportUrl).toContain(
      encodeURIComponent("https://acme.com/blog/what-is-a-widget/"),
    );
  });

  it("reports an HTML llms.txt catch-all as missing in diagnostics", () => {
    const html = auditFromSources(
      makeSources({
        llmsTxt: {
          status: 200,
          contentType: "text/html",
          body: "<!doctype html><html>",
        },
      }),
    );
    expect(html.diagnostics.llmsTxt).toBe("missing");
  });
});

describe("assertAuditablePage", () => {
  const page = (status: number, contentType = "text/html", body = "<html>") => ({
    finalUrl: "https://a.com/",
    status,
    contentType,
    body,
    redirects: 0,
  });

  it.each([
    [403, "blocked"],
    [429, "blocked"],
    [404, "http-error"],
    [500, "http-error"],
  ])("HTTP %i → %s", (status, code) => {
    expect(() => assertAuditablePage(page(status))).toThrow(FetchError);
    try {
      assertAuditablePage(page(status));
    } catch (error) {
      expect((error as FetchError).code).toBe(code);
    }
  });

  it("rejects non-HTML", () => {
    expect(() =>
      assertAuditablePage(page(200, "application/pdf", "%PDF-1.7")),
    ).toThrow(/HTML/);
  });

  it("accepts HTML", () => {
    expect(() => assertAuditablePage(page(200))).not.toThrow();
  });
});
