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
