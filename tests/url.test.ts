import { describe, expect, it } from "vitest";

import {
  auditHref,
  displayHost,
  normalizeAuditUrl,
  resolveAuditTarget,
} from "@/lib/url";

describe("normalizeAuditUrl", () => {
  // The URL is fetched exactly as entered: apex and www can serve different
  // pages, or the apex may not resolve at all, and an extra apex->www hop
  // would skew the redirect check (A15).
  it("adds https, lowercases the host and keeps www", () => {
    expect(normalizeAuditUrl("www.Example.com/pricing")).toBe(
      "https://www.example.com/pricing",
    );
  });

  it("keeps the path and query but drops the hash", () => {
    expect(normalizeAuditUrl("http://Example.com/a?b=1#top")).toBe(
      "http://example.com/a?b=1",
    );
  });

  it("rejects hosts without a dot", () => {
    expect(normalizeAuditUrl("localhost")).toBeNull();
  });
});

describe("displayHost", () => {
  it("strips www for labels only", () => {
    expect(displayHost("https://www.example.com/pricing")).toBe("example.com");
  });
});

describe("auditHref", () => {
  it("uses the display host as the slug and carries the exact URL", () => {
    expect(auditHref("https://www.example.com/pricing?a=1")).toBe(
      "/audit/example.com?url=https%3A%2F%2Fwww.example.com%2Fpricing%3Fa%3D1",
    );
  });
});

describe("resolveAuditTarget", () => {
  it("uses ?url= as given, since Next has already decoded it", () => {
    expect(
      resolveAuditTarget("example.com", "https://www.example.com/a%25b?q=1"),
    ).toBe("https://www.example.com/a%25b?q=1");
  });

  it("round-trips the URL the form links to", () => {
    const target = "https://www.example.com/a%25b?q=1";
    const href = new URL(auditHref(target), "https://aeo.example");
    expect(
      resolveAuditTarget("example.com", href.searchParams.get("url") ?? undefined),
    ).toBe(target);
  });

  it("takes the first value when ?url= is repeated", () => {
    expect(resolveAuditTarget("a.com", ["https://www.b.com/", "https://c.com/"])).toBe(
      "https://www.b.com/",
    );
  });

  it("falls back to the route segment's homepage", () => {
    expect(resolveAuditTarget("example.com")).toBe("https://example.com/");
    expect(resolveAuditTarget("example.com", "")).toBe("https://example.com/");
  });
});
