import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/audit", () => ({
  runAudit: vi.fn(async (url: string) => ({ url })),
}));

import { runAudit } from "@/lib/audit";
import { performAudit } from "@/lib/perform-audit";

describe("performAudit target", () => {
  it("fetches the www host as entered and labels it without www", async () => {
    const result = await performAudit("www.Example.com/pricing");
    expect(vi.mocked(runAudit)).toHaveBeenCalledWith(
      "https://www.example.com/pricing",
      expect.anything(),
    );
    expect(result).toMatchObject({ status: "ready", domain: "example.com" });
  });
});
