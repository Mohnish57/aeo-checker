import { beforeEach, describe, expect, it, vi } from "vitest";

import { FetchError, safeFetch, type FetchResult } from "@/lib/net/safe-fetch";
import { fetchSiteFiles } from "@/lib/site-files";

vi.mock("@/lib/net/safe-fetch", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/net/safe-fetch")>();
  return { ...actual, safeFetch: vi.fn() };
});

const mockedSafeFetch = vi.mocked(safeFetch);
const page = new URL("https://a.com/blog/post");

const URLSET = '<?xml version="1.0"?><urlset xmlns="x"></urlset>';

type Route = { status: number; contentType?: string; body: string } | Error;

/** Serve fixed responses by exact URL; unknown URLs behave as unreachable. */
function serve(routes: Record<string, Route>): void {
  mockedSafeFetch.mockImplementation(async (url: string) => {
    const route = routes[url];
    if (route instanceof Error) throw route;
    if (!route) throw new FetchError("unreachable", `no route for ${url}`);
    const result: FetchResult = {
      finalUrl: url,
      status: route.status,
      contentType: route.contentType ?? "text/plain",
      body: route.body,
      redirects: 0,
    };
    return result;
  });
}

function requestedUrls(): string[] {
  return mockedSafeFetch.mock.calls.map((call) => String(call[0]));
}

beforeEach(() => {
  mockedSafeFetch.mockReset();
});

describe("fetchSiteFiles", () => {
  it("ignores a soft-404 robots.txt (200 HTML) and tries default sitemap paths", async () => {
    serve({
      "https://a.com/robots.txt": {
        status: 200,
        contentType: "text/html",
        body: "<!doctype html><html><body>Not found</body></html>",
      },
      "https://a.com/sitemap.xml": { status: 200, contentType: "application/xml", body: URLSET },
    });

    const files = await fetchSiteFiles(page);

    expect(files.robotsTxt).toBeNull();
    expect(files.sitemap).toEqual({
      declared: false,
      url: "https://a.com/sitemap.xml",
      found: true,
    });
    expect(requestedUrls()).toContain("https://a.com/sitemap.xml");
  });

  it("returns empty site files without throwing when every fetch fails", async () => {
    mockedSafeFetch.mockRejectedValue(new FetchError("unreachable", "down"));

    await expect(fetchSiteFiles(page)).resolves.toEqual({
      robotsTxt: null,
      llmsTxt: null,
      sitemap: { declared: false, url: "https://a.com/sitemap.xml", found: false },
    });
  });

  it("reports a declared absolute sitemap that returns urlset", async () => {
    serve({
      "https://a.com/robots.txt": {
        status: 200,
        body: "User-agent: *\nSitemap: https://a.com/news.xml\n",
      },
      "https://a.com/news.xml": { status: 200, contentType: "application/xml", body: URLSET },
    });

    const files = await fetchSiteFiles(page);

    expect(files.sitemap).toEqual({
      declared: true,
      url: "https://a.com/news.xml",
      found: true,
    });
  });

  it("resolves a relative Sitemap value against the origin", async () => {
    serve({
      "https://a.com/robots.txt": { status: 200, body: "Sitemap: /sm.xml\n" },
      "https://a.com/sm.xml": { status: 200, contentType: "application/xml", body: URLSET },
    });

    const files = await fetchSiteFiles(page);

    expect(files.sitemap).toEqual({
      declared: true,
      url: "https://a.com/sm.xml",
      found: true,
    });
  });

  it("falls back to /sitemap.xml when the declared sitemap is dead", async () => {
    serve({
      "https://a.com/robots.txt": {
        status: 200,
        body: "Sitemap: https://a.com/dead.xml\n",
      },
      "https://a.com/dead.xml": { status: 404, body: "" },
      "https://a.com/sitemap.xml": { status: 200, contentType: "application/xml", body: URLSET },
    });

    const files = await fetchSiteFiles(page);

    expect(files.sitemap).toEqual({
      declared: true,
      url: "https://a.com/sitemap.xml",
      found: true,
    });
  });

  it("falls back to /sitemap_index.xml when /sitemap.xml is missing", async () => {
    serve({
      "https://a.com/sitemap.xml": { status: 404, body: "" },
      "https://a.com/sitemap_index.xml": {
        status: 200,
        contentType: "application/xml",
        body: "<sitemapindex></sitemapindex>",
      },
    });

    const files = await fetchSiteFiles(page);

    expect(files.sitemap).toEqual({
      declared: false,
      url: "https://a.com/sitemap_index.xml",
      found: true,
    });
  });

  it("reports the first declared url and found=false when nothing is found", async () => {
    serve({
      "https://a.com/robots.txt": {
        status: 200,
        body: "Sitemap: https://a.com/dead.xml\n",
      },
      "https://a.com/dead.xml": { status: 404, body: "" },
    });

    const files = await fetchSiteFiles(page);

    expect(files.sitemap).toEqual({
      declared: true,
      url: "https://a.com/dead.xml",
      found: false,
    });
  });

  it("does not count a .gz sitemap that returns HTML as found", async () => {
    serve({
      "https://a.com/robots.txt": {
        status: 200,
        body: "Sitemap: https://a.com/sitemap.xml.gz\n",
      },
      "https://a.com/sitemap.xml.gz": {
        status: 200,
        contentType: "text/html",
        body: "<!doctype html><html>Soft 404</html>",
      },
    });

    const files = await fetchSiteFiles(page);

    expect(files.sitemap).toEqual({
      declared: true,
      url: "https://a.com/sitemap.xml.gz",
      found: false,
    });
  });

  it("counts a .gz sitemap that returns a non-HTML body as found", async () => {
    serve({
      "https://a.com/robots.txt": {
        status: 200,
        body: "Sitemap: https://a.com/sitemap.xml.gz\n",
      },
      "https://a.com/sitemap.xml.gz": {
        status: 200,
        contentType: "application/gzip",
        body: "\u001f\u008b\u0008",
      },
    });

    const files = await fetchSiteFiles(page);

    expect(files.sitemap).toEqual({
      declared: true,
      url: "https://a.com/sitemap.xml.gz",
      found: true,
    });
  });

  it("skips an unparseable Sitemap value and tries the default paths", async () => {
    serve({
      "https://a.com/robots.txt": { status: 200, body: "Sitemap: http://[bad\n" },
      "https://a.com/sitemap.xml": { status: 200, contentType: "application/xml", body: URLSET },
    });

    const files = await fetchSiteFiles(page);

    expect(files.sitemap).toEqual({
      declared: true,
      url: "https://a.com/sitemap.xml",
      found: true,
    });
  });

  it("prefers the first declared sitemap in order, even if a later one resolves first", async () => {
    mockedSafeFetch.mockImplementation(async (url: string) => {
      if (url === "https://a.com/robots.txt") {
        return { finalUrl: url, status: 200, contentType: "text/plain", body: "Sitemap: /one.xml\nSitemap: /two.xml\n", redirects: 0 };
      }
      if (url === "https://a.com/one.xml") {
        await new Promise((resolve) => setTimeout(resolve, 30));
        return { finalUrl: url, status: 200, contentType: "application/xml", body: URLSET, redirects: 0 };
      }
      if (url === "https://a.com/two.xml") {
        return { finalUrl: url, status: 200, contentType: "application/xml", body: URLSET, redirects: 0 };
      }
      throw new FetchError("unreachable", `no route for ${url}`);
    });

    const files = await fetchSiteFiles(page);

    expect(files.sitemap).toEqual({
      declared: true,
      url: "https://a.com/one.xml",
      found: true,
    });
  });

  it("keeps llms.txt status and truncates its body to 20,000 characters", async () => {
    serve({
      "https://a.com/llms.txt": { status: 200, contentType: "text/markdown", body: "x".repeat(25_000) },
    });

    const files = await fetchSiteFiles(page);

    expect(files.llmsTxt).toEqual({
      status: 200,
      contentType: "text/markdown",
      body: "x".repeat(20_000),
    });
  });
});
