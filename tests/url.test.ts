import { describe, expect, it } from "vitest";

import { normalizeAuditUrl } from "@/lib/url";

describe("normalizeAuditUrl", () => {
  it("adds https and strips www", () => {
    expect(normalizeAuditUrl("www.Example.com/pricing")).toBe(
      "https://example.com/pricing",
    );
  });

  it("rejects hosts without a dot", () => {
    expect(normalizeAuditUrl("localhost")).toBeNull();
  });
});
