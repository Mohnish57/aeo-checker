import { describe, expect, it } from "vitest";

import { INVALID_DOMAIN_MESSAGE, performAudit } from "@/lib/perform-audit";

describe("performAudit", () => {
  it("rejects invalid input without fetching", async () => {
    expect(await performAudit("not a url")).toEqual({
      status: "error",
      message: INVALID_DOMAIN_MESSAGE,
    });
  });

  it("returns friendly fetch errors", async () => {
    const result = await performAudit("http://169.254.169.254/latest");
    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.message).toMatch(/private or internal network/);
    }
  });
});
