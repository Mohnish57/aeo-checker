import { describe, expect, it } from "vitest";

import { auditFromSources } from "@/lib/audit";
import { CATEGORIES, blockedAiCrawlers } from "@/lib/rules";

import { ARTICLE_HTML, makeSources, statusOf } from "./helpers/sources";

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

  it("is partial when only training bots are blocked", () => {
    const robots = "User-agent: GPTBot\nDisallow: /\n\nUser-agent: Google-Extended\nDisallow: /\n";
    expect(statusOf(run({ robotsTxt: robots }), "A13")).toBe("partial");
  });

  it("fails when an answer bot is blocked", () => {
    const robots = "User-agent: OAI-SearchBot\nDisallow: /\n";
    expect(statusOf(run({ robotsTxt: robots }), "A13")).toBe("fail");
  });

  it("fails when everything is blocked", () => {
    expect(statusOf(run({ robotsTxt: "User-agent: *\nDisallow: /\n" }), "A13")).toBe("fail");
  });
});

describe("A14 llms.txt", () => {
  it("passes for a markdown llms.txt", () => {
    expect(statusOf(run(), "A14")).toBe("pass");
  });

  it("is partial for plain text without a heading", () => {
    const llmsTxt = { status: 200, contentType: "text/plain", body: "acme widgets" };
    expect(statusOf(run({ llmsTxt }), "A14")).toBe("partial");
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
