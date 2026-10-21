import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fetchPageSpeed,
  pageSpeedReportUrl,
  parsePageSpeed,
} from "@/lib/pagespeed";

describe("parsePageSpeed", () => {
  it("extracts score and core metrics", () => {
    const json = {
      lighthouseResult: {
        categories: { performance: { score: 0.87 } },
        audits: {
          "largest-contentful-paint": { numericValue: 2300.4 },
          "cumulative-layout-shift": { numericValue: 0.04 },
          "total-blocking-time": { numericValue: 180 },
        },
      },
    };
    expect(parsePageSpeed(json)).toEqual({
      performanceScore: 87,
      lcpMs: 2300.4,
      cls: 0.04,
      tbtMs: 180,
    });
  });

  it("returns null without a performance score", () => {
    expect(parsePageSpeed({ error: { code: 429 } })).toBeNull();
  });

  it("builds a report link", () => {
    expect(pageSpeedReportUrl("https://a.com/x")).toBe(
      "https://pagespeed.web.dev/analysis?url=https%3A%2F%2Fa.com%2Fx&form_factor=mobile",
    );
  });
});

describe("fetchPageSpeed", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const okJson = {
    lighthouseResult: {
      categories: { performance: { score: 0.5 } },
      audits: {},
    },
  };

  function stubFetch(factory: () => Response): ReturnType<typeof vi.fn> {
    const fetchMock = vi.fn(async () => factory());
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  function requestParams(fetchMock: ReturnType<typeof vi.fn>): URLSearchParams {
    return new URL(String(fetchMock.mock.calls[0]?.[0])).searchParams;
  }

  it("returns the parsed result for a successful response", async () => {
    stubFetch(
      () =>
        new Response(JSON.stringify(okJson), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );

    await expect(fetchPageSpeed("https://a.com/x")).resolves.toEqual({
      performanceScore: 50,
      lcpMs: null,
      cls: null,
      tbtMs: null,
    });
  });

  it("returns null on a 429 response", async () => {
    stubFetch(() => new Response("{}", { status: 429 }));

    await expect(fetchPageSpeed("https://a.com/x")).resolves.toBeNull();
  });

  it("returns null when the request throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );

    await expect(fetchPageSpeed("https://a.com/x")).resolves.toBeNull();
  });

  it("always requests the mobile strategy and the audited url", async () => {
    const fetchMock = stubFetch(
      () => new Response(JSON.stringify(okJson), { status: 200 }),
    );

    await fetchPageSpeed("https://a.com/x");

    const params = requestParams(fetchMock);
    expect(params.get("strategy")).toBe("mobile");
    expect(params.get("url")).toBe("https://a.com/x");
  });

  it("omits key when no api key is passed", async () => {
    const fetchMock = stubFetch(
      () => new Response(JSON.stringify(okJson), { status: 200 }),
    );

    await fetchPageSpeed("https://a.com/x");

    expect(requestParams(fetchMock).has("key")).toBe(false);
  });

  it("sends key when an api key is passed", async () => {
    const fetchMock = stubFetch(
      () => new Response(JSON.stringify(okJson), { status: 200 }),
    );

    await fetchPageSpeed("https://a.com/x", "test-key");

    expect(requestParams(fetchMock).get("key")).toBe("test-key");
  });
});
