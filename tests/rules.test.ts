import { describe, expect, it } from "vitest";

import { auditFromSources } from "@/lib/audit";
import { CATEGORIES, blockedAiCrawlers } from "@/lib/rules";

import { ARTICLE_HTML, evidenceOf, makeSources, statusOf } from "./helpers/sources";

const run = (overrides: Parameters<typeof makeSources>[0] = {}) =>
  auditFromSources(makeSources(overrides));

const withHead = (head: string, body = "<p>Hello</p>") =>
  `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;

describe("category weights", () => {
  it("sum to 100", () => {
    expect(CATEGORIES.reduce((s, c) => s + c.maxScore, 0)).toBe(100);
  });
});

describe("A13 AI crawler access", () => {
  const url = "https://acme.com/blog/x";

  it("detects blocked search and training bots", () => {
    const robots =
      "User-agent: GPTBot\nDisallow: /\n\nUser-agent: PerplexityBot\nDisallow: /blog/\n\nUser-agent: *\nAllow: /\n";
    expect(blockedAiCrawlers(robots, url)).toEqual({
      search: ["PerplexityBot"],
      training: ["GPTBot"],
    });
  });

  it("passes when nothing is blocked or robots.txt is missing", () => {
    expect(statusOf(run(), "A13")).toBe("pass");
    expect(statusOf(run({ robotsTxt: null }), "A13")).toBe("pass");
  });

  it("tells a missing robots.txt apart from an empty one", () => {
    expect(evidenceOf(run({ robotsTxt: null }), "A13")).toMatch(/No robots\.txt was found/);
    expect(evidenceOf(run({ robotsTxt: "" }), "A13")).toBe(
      "robots.txt is empty, so AI crawlers are not blocked.",
    );
    expect(statusOf(run({ robotsTxt: "" }), "A13")).toBe("pass");
  });

  it("is partial when only training bots are blocked", () => {
    const robots = "User-agent: GPTBot\nDisallow: /\n\nUser-agent: Google-Extended\nDisallow: /\n";
    expect(statusOf(run({ robotsTxt: robots }), "A13")).toBe("partial");
  });

  it("fails when an answer bot is blocked", () => {
    const robots = "User-agent: OAI-SearchBot\nDisallow: /\n";
    expect(statusOf(run({ robotsTxt: robots }), "A13")).toBe("fail");
  });

  // RFC 9309 and Google: a 5xx (or 429) robots.txt means "disallow all".
  it.each([500, 503, 429])("fails when robots.txt returns HTTP %i", (status) => {
    const audit = run({ robotsTxt: null, robotsTxtStatus: status });
    expect(statusOf(audit, "A13")).toBe("fail");
    expect(evidenceOf(audit, "A13")).toBe(
      `robots.txt returned HTTP ${status}. Crawlers treat a server error on robots.txt as "disallow all" (RFC 9309; Google does the same), so AI crawlers are blocked until it returns 200 or 404.`,
    );
  });

  it("still passes when robots.txt is a 404", () => {
    expect(statusOf(run({ robotsTxt: null, robotsTxtStatus: 404 }), "A13")).toBe("pass");
  });

  it("fails when everything is blocked", () => {
    expect(statusOf(run({ robotsTxt: "User-agent: *\nDisallow: /\n" }), "A13")).toBe("fail");
  });
});

describe("A14 llms.txt", () => {
  it("passes for a markdown llms.txt", () => {
    expect(statusOf(run(), "A14")).toBe("pass");
  });

  it("says the file has a heading, not that it starts with one", () => {
    expect(evidenceOf(run(), "A14")).toBe("/llms.txt exists and has a Markdown H1 heading.");
  });

  it("is partial for plain text without a heading", () => {
    const llmsTxt = { status: 200, contentType: "text/plain", body: "acme widgets" };
    expect(statusOf(run({ llmsTxt }), "A14")).toBe("partial");
  });

  it("fails for an empty file", () => {
    const llmsTxt = { status: 200, contentType: "text/plain", body: " \n " };
    const audit = run({ llmsTxt });
    expect(statusOf(audit, "A14")).toBe("fail");
    expect(evidenceOf(audit, "A14")).toBe("/llms.txt exists but is empty.");
    expect(audit.diagnostics.llmsTxt).toBe("missing");
  });

  it("fails for an HTML catch-all page", () => {
    const llmsTxt = { status: 200, contentType: "text/html", body: "<!doctype html><html>" };
    expect(statusOf(run({ llmsTxt }), "A14")).toBe("fail");
  });

  it("fails when missing", () => {
    const llmsTxt = { status: 404, contentType: "text/html", body: "" };
    expect(statusOf(run({ llmsTxt }), "A14")).toBe("fail");
    expect(statusOf(run({ llmsTxt: null }), "A14")).toBe("fail");
  });
});

describe("A15 redirects", () => {
  it("passes with at most one redirect", () => {
    expect(statusOf(run({ redirects: 1 }), "A15")).toBe("pass");
  });

  it("is partial for redirect chains", () => {
    expect(statusOf(run({ redirects: 3 }), "A15")).toBe("partial");
  });
});

describe("A1 HTTPS", () => {
  it("describes the audited page after redirects", () => {
    expect(evidenceOf(run(), "A1")).toBe("The audited page (after redirects) uses HTTPS.");
    expect(evidenceOf(run({ url: "http://acme.com/x" }), "A1")).toBe(
      "The audited page (after redirects) is not served over HTTPS.",
    );
  });
});

describe("D12 brand consistency", () => {
  it("reports whether the brand appears, not whether the tag exists", () => {
    const html = withHead(
      '<title>Widgets for everyone</title><meta name="description" content="Acme makes widgets for teams.">',
      "<p>Acme widgets.</p>",
    );
    expect(evidenceOf(run({ html }), "D12")).toBe(
      'Brand token "acme" appears in title: no, meta description: yes, body mentions: 1.',
    );
  });
});

describe("G classic SEO", () => {
  it("passes the article fixture", () => {
    const audit = run();
    for (const id of ["G1", "G2", "G3", "G4", "G5", "G6", "G7"]) {
      expect([id, statusOf(audit, id)]).toEqual([id, "pass"]);
    }
  });

  it("G1 title length", () => {
    expect(statusOf(run({ html: withHead("<title>Short title here</title>") }), "G1")).toBe("partial");
    expect(statusOf(run({ html: withHead("") }), "G1")).toBe("fail");
  });

  it("G2 meta description", () => {
    expect(
      statusOf(run({ html: withHead('<meta name="description" content="Too short.">') }), "G2"),
    ).toBe("partial");
    expect(statusOf(run({ html: withHead("") }), "G2")).toBe("fail");
  });

  it("G3 alt text", () => {
    const body = '<img src="a"><img src="b"><img src="c" alt="c">';
    expect(statusOf(run({ html: withHead("", body) }), "G3")).toBe("fail");
    expect(statusOf(run({ html: withHead("") }), "G3")).toBe("na");
  });

  it("G4 social tags", () => {
    expect(
      statusOf(run({ html: withHead('<meta property="og:title" content="x">') }), "G4"),
    ).toBe("partial");
    expect(statusOf(run({ html: withHead("") }), "G4")).toBe("fail");
  });

  it("G5 viewport and G6 lang", () => {
    const audit = run({ html: withHead('<meta name="viewport" content="initial-scale=1">') });
    expect(statusOf(audit, "G5")).toBe("partial");
    expect(statusOf(audit, "G6")).toBe("fail");
  });

  it("G7 sitemap", () => {
    expect(statusOf(run({ sitemap: { found: false, declared: true } }), "G7")).toBe("partial");
    expect(statusOf(run({ sitemap: { found: false, declared: false } }), "G7")).toBe("fail");
  });
});

describe("H performance", () => {
  it("passes good metrics", () => {
    const audit = run();
    for (const id of ["H1", "H2", "H3", "H4"]) {
      expect([id, statusOf(audit, id)]).toEqual([id, "pass"]);
    }
  });

  it("grades slow pages", () => {
    const audit = run({
      pageSpeed: { performanceScore: 42, lcpMs: 3500, cls: 0.3, tbtMs: 700 },
    });
    expect(statusOf(audit, "H1")).toBe("fail");
    expect(statusOf(audit, "H2")).toBe("partial");
    expect(statusOf(audit, "H3")).toBe("fail");
    expect(statusOf(audit, "H4")).toBe("fail");
  });

  it("shows LCP and CLS precisely enough to agree with the thresholds", () => {
    const audit = run({ pageSpeed: { performanceScore: 95, lcpMs: 2550, cls: 0.104, tbtMs: 100 } });
    expect(statusOf(audit, "H2")).toBe("partial");
    expect(evidenceOf(audit, "H2")).toContain("2.55s");
    expect(statusOf(audit, "H3")).toBe("partial");
    expect(evidenceOf(audit, "H3")).toContain("0.104");
  });

  it("names the missing metric when PageSpeed ran but did not report it", () => {
    const audit = run({ pageSpeed: { performanceScore: 95, lcpMs: null, cls: null, tbtMs: null } });
    expect(statusOf(audit, "H2")).toBe("na");
    expect(evidenceOf(audit, "H2")).toBe(
      "PageSpeed Insights did not report Largest Contentful Paint for this page.",
    );
    expect(evidenceOf(audit, "H3")).toContain("Cumulative Layout Shift");
    expect(evidenceOf(audit, "H4")).toContain("Total Blocking Time");
  });

  it("says PageSpeed was unavailable only when it produced no result", () => {
    const audit = run({ pageSpeed: null });
    for (const id of ["H1", "H2", "H3", "H4"]) {
      expect(evidenceOf(audit, id)).toMatch(/^PageSpeed Insights was unavailable/);
    }
  });

  it("is N/A without PageSpeed and redistributes its weight", () => {
    const audit = run({ pageSpeed: null });
    const h = audit.categories.find((c) => c.id === "H")!;
    expect(h.maxScore).toBe(0);
    expect(h.items.every((i) => i.status === "na")).toBe(true);
    const total = audit.categories.reduce((s, c) => s + c.maxScore, 0);
    expect(total).toBeCloseTo(100, 0);
  });
});

describe("fixture sanity", () => {
  it("fixture has images with alt", () => {
    expect(ARTICLE_HTML).toContain('alt="Widget diagram"');
  });
});

describe("threshold boundaries", () => {
  const title = (length: number) => withHead(`<title>${"a".repeat(length)}</title>`);

  it("G1 passes a 60-character title and is partial at 61", () => {
    expect(statusOf(run({ html: title(60) }), "G1")).toBe("pass");
    expect(statusOf(run({ html: title(61) }), "G1")).toBe("partial");
  });

  it("H2 passes LCP of exactly 2.5s", () => {
    const audit = run({ pageSpeed: { performanceScore: 95, lcpMs: 2500, cls: 0, tbtMs: 0 } });
    expect(statusOf(audit, "H2")).toBe("pass");
  });

  it("H3 passes CLS of exactly 0.1", () => {
    const audit = run({ pageSpeed: { performanceScore: 95, lcpMs: 1000, cls: 0.1, tbtMs: 0 } });
    expect(statusOf(audit, "H3")).toBe("pass");
  });

  it("G3 is partial when half the images have alt text", () => {
    const body = '<img src="a" alt="a"><img src="b">';
    const audit = run({ html: withHead("", body) });
    expect(statusOf(audit, "G3")).toBe("partial");
    expect(evidenceOf(audit, "G3")).toBe("1 of 2 image(s) have an alt attribute.");
  });

  it("G4 is partial with only a Twitter card", () => {
    const audit = run({ html: withHead('<meta name="twitter:card" content="summary">') });
    expect(statusOf(audit, "G4")).toBe("partial");
  });

  it("A15 is partial for a non-200 2xx response without redirects", () => {
    const audit = run({ status: 203, redirects: 0 });
    expect(statusOf(audit, "A15")).toBe("partial");
    expect(evidenceOf(audit, "A15")).toBe("HTTP 203 after 0 redirect(s).");
  });
});
