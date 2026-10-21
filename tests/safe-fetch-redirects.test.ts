/**
 * Redirect and literal-address SSRF paths with the private-network guards
 * ON. undici's fetch is mocked, so nothing here touches the network.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:dns/promises", () => ({
  Resolver: class {
    async resolve4(host: string) {
      if (host === "public.test") return ["93.184.215.14"];
      throw Object.assign(new Error("not found"), { code: "ENOTFOUND" });
    }
    async resolve6() {
      throw Object.assign(new Error("no data"), { code: "ENODATA" });
    }
  },
}));

vi.mock("undici", async (importOriginal) => ({
  ...(await importOriginal<typeof import("undici")>()),
  fetch: vi.fn(),
}));

import { fetch } from "undici";

import { safeFetch } from "@/lib/net/safe-fetch";

const mockedFetch = vi.mocked(fetch);

function redirectTo(location: string) {
  mockedFetch.mockResolvedValueOnce(
    new Response(null, { status: 302, headers: { location } }) as never,
  );
}

beforeEach(() => {
  mockedFetch.mockReset();
});

describe("redirects to private addresses", () => {
  it.each([
    "http://10.0.0.1/",
    "http://127.0.0.1:80/admin",
    "http://169.254.169.254/latest/meta-data/",
    "http://[::1]/",
    "http://[::ffff:127.0.0.1]/",
    "http://localhost/",
  ])("blocks a 302 from a public host to %s", async (location) => {
    redirectTo(location);
    await expect(safeFetch("http://public.test/")).rejects.toMatchObject({
      code: "blocked-address",
    });
    // Only the first, public hop was requested.
    expect(mockedFetch).toHaveBeenCalledTimes(1);
    expect(String(mockedFetch.mock.calls[0][0])).toBe("http://public.test/");
  });

  it("blocks a private hop later in a redirect chain", async () => {
    redirectTo("http://public.test/step-2");
    redirectTo("http://192.168.1.1/");
    await expect(safeFetch("http://public.test/")).rejects.toMatchObject({
      code: "blocked-address",
    });
    expect(mockedFetch).toHaveBeenCalledTimes(2);
  });
});

describe("literal addresses", () => {
  it.each(["http://[::1]/", "http://[::7f00:1]/", "http://[fd00::1]/", "http://0x7f000001/"])(
    "blocks %s without sending a request",
    async (url) => {
      await expect(safeFetch(url)).rejects.toMatchObject({ code: "blocked-address" });
      expect(mockedFetch).not.toHaveBeenCalled();
    },
  );
});
