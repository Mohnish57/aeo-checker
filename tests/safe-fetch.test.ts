import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  FetchError,
  assertPublicHost,
  isPublicAddress,
  safeFetch,
} from "@/lib/net/safe-fetch";

describe("isPublicAddress", () => {
  it.each(["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"])(
    "allows public %s",
    (ip) => expect(isPublicAddress(ip)).toBe(true),
  );

  it.each([
    "127.0.0.1",
    "10.0.0.1",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "::1",
    "fd00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
    "not-an-ip",
  ])("blocks %s", (ip) => expect(isPublicAddress(ip)).toBe(false));
});

describe("safeFetch guards", () => {
  async function codeOf(promise: Promise<unknown>) {
    try {
      await promise;
      return "resolved";
    } catch (error) {
      return error instanceof FetchError ? error.code : "other";
    }
  }

  it("rejects non-http schemes", async () => {
    expect(await codeOf(safeFetch("ftp://example.com/"))).toBe("invalid-url");
  });

  it("rejects non-standard ports", async () => {
    expect(await codeOf(safeFetch("https://example.com:8443/"))).toBe(
      "invalid-url",
    );
  });

  it("rejects literal private IPs", async () => {
    expect(await codeOf(safeFetch("http://127.0.0.1/"))).toBe(
      "blocked-address",
    );
    expect(await codeOf(safeFetch("http://169.254.169.254/latest"))).toBe(
      "blocked-address",
    );
  });

  it("rejects hostnames resolving to private IPs", async () => {
    expect(await codeOf(assertPublicHost(new URL("http://localhost/")))).toBe(
      "blocked-address",
    );
  });
});

describe("safeFetch against a local server", () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    server = createServer((req, res) => {
      switch (req.url) {
        case "/ok":
          res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
          res.end("<html><body>héllo</body></html>");
          return;
        case "/redirect":
          res.writeHead(301, { location: "/ok" });
          res.end();
          return;
        case "/loop":
          res.writeHead(302, { location: "/loop" });
          res.end();
          return;
        case "/big":
          res.writeHead(200, { "content-type": "text/plain" });
          res.end("x".repeat(5000));
          return;
        case "/hang":
          return; // never respond
        default:
          res.writeHead(404);
          res.end();
      }
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => {
    server.closeAllConnections();
    server.close();
  });

  const local = { allowPrivateNetwork: true, allowAnyPort: true } as const;

  it("returns body, status and content type", async () => {
    const result = await safeFetch(`${base}/ok`, local);
    expect(result.status).toBe(200);
    expect(result.contentType).toContain("text/html");
    expect(result.body).toContain("héllo");
    expect(result.redirects).toBe(0);
  });

  it("follows redirects and counts them", async () => {
    const result = await safeFetch(`${base}/redirect`, local);
    expect(result.finalUrl).toBe(`${base}/ok`);
    expect(result.redirects).toBe(1);
  });

  it("stops redirect loops", async () => {
    await expect(safeFetch(`${base}/loop`, local)).rejects.toMatchObject({
      code: "too-many-redirects",
    });
  });

  it("rejects bodies over the cap", async () => {
    await expect(
      safeFetch(`${base}/big`, { ...local, maxBytes: 1000 }),
    ).rejects.toMatchObject({ code: "too-large" });
  });

  it("truncates instead of rejecting when asked", async () => {
    const result = await safeFetch(`${base}/big`, {
      ...local,
      maxBytes: 1000,
      truncate: true,
    });
    expect(result.body.length).toBeLessThanOrEqual(1000);
  });

  it("times out", async () => {
    await expect(
      safeFetch(`${base}/hang`, { ...local, timeoutMs: 300 }),
    ).rejects.toMatchObject({ code: "timeout" });
  });

  it("returns non-2xx statuses without throwing", async () => {
    const result = await safeFetch(`${base}/missing`, local);
    expect(result.status).toBe(404);
  });
});
