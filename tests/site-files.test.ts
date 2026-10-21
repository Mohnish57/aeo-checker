import { describe, expect, it } from "vitest";

import {
  isRealLlmsTxt,
  isSitemapXml,
  looksLikeHtml,
  parseSitemapDirectives,
} from "@/lib/site-files";

describe("parseSitemapDirectives", () => {
  it("reads Sitemap lines case-insensitively", () => {
    const robots =
      "User-agent: *\nDisallow: /admin\nSitemap: https://a.com/sitemap.xml\nsitemap:https://a.com/news.xml\n";
    expect(parseSitemapDirectives(robots)).toEqual([
      "https://a.com/sitemap.xml",
      "https://a.com/news.xml",
    ]);
  });

  it("returns [] when none declared", () => {
    expect(parseSitemapDirectives("User-agent: *\nAllow: /")).toEqual([]);
  });
});

describe("isSitemapXml", () => {
  it("accepts urlset and sitemapindex", () => {
    expect(isSitemapXml('<?xml version="1.0"?><urlset xmlns="x">')).toBe(true);
    expect(isSitemapXml("<sitemapindex>")).toBe(true);
  });

  it("rejects HTML", () => {
    expect(isSitemapXml("<!doctype html><html>")).toBe(false);
  });
});

describe("looksLikeHtml", () => {
  it("detects by content type or body", () => {
    expect(looksLikeHtml({ contentType: "text/html", body: "# hi" })).toBe(true);
    expect(looksLikeHtml({ contentType: "", body: "<!DOCTYPE html><html>" })).toBe(true);
    expect(looksLikeHtml({ contentType: "text/plain", body: "# Acme\n" })).toBe(false);
  });
});

describe("isRealLlmsTxt", () => {
  it("accepts a 200 text response", () => {
    expect(isRealLlmsTxt({ status: 200, contentType: "text/plain", body: "# A" })).toBe(true);
  });

  it("rejects null, non-200 and HTML catch-alls", () => {
    expect(isRealLlmsTxt(null)).toBe(false);
    expect(isRealLlmsTxt({ status: 404, contentType: "text/plain", body: "" })).toBe(false);
    expect(
      isRealLlmsTxt({ status: 200, contentType: "text/html", body: "<!doctype html>" }),
    ).toBe(false);
  });
});
