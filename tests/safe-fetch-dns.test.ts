/**
 * DNS behavior of safeFetch with a mocked resolver and the private-network
 * guards ON (allowPrivateNetwork is never set in this file).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const dns = vi.hoisted(() => ({
  resolve4: vi.fn<(host: string) => Promise<string[]>>(),
  resolve6: vi.fn<(host: string) => Promise<string[]>>(),
}));

vi.mock("node:dns/promises", () => ({
  Resolver: class {
    resolve4(host: string) {
      return dns.resolve4(host);
    }
    resolve6(host: string) {
      return dns.resolve6(host);
    }
  },
}));

import { assertPublicHost, isPublicAddress, safeFetch } from "@/lib/net/safe-fetch";

const dnsError = (code: string) =>
  Object.assign(new Error(`query ${code}`), { code });
const never = () => new Promise<string[]>(() => {});

async function failure(promise: Promise<unknown>) {
  const start = performance.now();
  try {
    await promise;
    return { code: "resolved", ms: performance.now() - start };
  } catch (error) {
    return {
      code: (error as { code?: string }).code ?? "other",
      ms: performance.now() - start,
    };
  }
}

beforeEach(() => {
  dns.resolve4.mockReset();
  dns.resolve6.mockReset();
  dns.resolve6.mockRejectedValue(dnsError("ENODATA"));
});

describe("DNS timeouts", () => {
  it("cuts a hanging resolver off at the fetch timeout and reports timeout", async () => {
    dns.resolve4.mockImplementation(never);
    dns.resolve6.mockImplementation(never);
    const result = await failure(safeFetch("http://slow.test/", { timeoutMs: 300 }));
    expect(result.code).toBe("timeout");
    expect(result.ms).toBeLessThan(1500);
  });

  it("reports a resolver timeout as timeout, not unreachable", async () => {
    dns.resolve4.mockRejectedValue(dnsError("ETIMEOUT"));
    dns.resolve6.mockRejectedValue(dnsError("ETIMEOUT"));
    expect((await failure(safeFetch("http://slow.test/"))).code).toBe("timeout");
  });

  it("bounds the connect-time lookup by the fetch timeout", async () => {
    // Pre-check sees a public address; the lookup at connect time hangs.
    dns.resolve4
      .mockResolvedValueOnce(["93.184.215.14"])
      .mockImplementation(never);
    const result = await failure(
      safeFetch("http://slow-connect.test/", { timeoutMs: 500 }),
    );
    expect(result.code).toBe("timeout");
    expect(result.ms).toBeLessThan(2500);
    expect(dns.resolve4).toHaveBeenCalledTimes(2);
  });

  it("reports a missing domain as unreachable", async () => {
    dns.resolve4.mockRejectedValue(dnsError("ENOTFOUND"));
    dns.resolve6.mockRejectedValue(dnsError("ENOTFOUND"));
    expect((await failure(safeFetch("http://missing.test/"))).code).toBe(
      "unreachable",
    );
  });
});

describe("DNS answers", () => {
  it("blocks a hostname resolving to a private address", async () => {
    dns.resolve4.mockResolvedValue(["10.0.0.5"]);
    expect((await failure(assertPublicHost(new URL("http://internal.test/")))).code).toBe(
      "blocked-address",
    );
  });

  it("blocks a hostname when any of its addresses is private", async () => {
    dns.resolve4.mockResolvedValue(["93.184.215.14"]);
    dns.resolve6.mockResolvedValue(["::1"]);
    expect((await failure(assertPublicHost(new URL("http://mixed.test/")))).code).toBe(
      "blocked-address",
    );
  });

  it("blocks localhost names without asking DNS", async () => {
    for (const host of ["localhost", "localhost.", "app.localhost"]) {
      expect((await failure(assertPublicHost(new URL(`http://${host}/`)))).code).toBe(
        "blocked-address",
      );
    }
    expect(dns.resolve4).not.toHaveBeenCalled();
  });
});

describe("IPv4-compatible IPv6", () => {
  it.each(["::7f00:1", "::a00:1", "::8.8.8.8", "::"])("treats %s as non-public", (ip) => {
    expect(isPublicAddress(ip)).toBe(false);
  });
});
