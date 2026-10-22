/**
 * False results found by auditing real sites (Wikipedia, HubSpot, MDN,
 * react.dev, Ahrefs, wednesday.is). Each test reproduces one of them.
 */
import { describe, expect, it } from "vitest";

import { auditFromSources } from "@/lib/audit";

import { evidenceOf, makeSources, statusOf } from "./helpers/sources";

const PARAGRAPH =
  "Widgets are small reusable components. Teams use them to ship features faster and keep interfaces consistent across products. ";

const page = ({
  head = "",
  body = "",
}: {
  head?: string;
  body?: string;
}) =>
  `<!doctype html><html lang="en"><head><title>What a widget is</title>${head}</head><body><main><article><h1>What a widget is</h1>${body}<p>${PARAGRAPH.repeat(4)}</p><p>${PARAGRAPH.repeat(3)}</p></article></main></body></html>`;

const jsonLd = (value: unknown) =>
  `<script type="application/ld+json">${JSON.stringify(value)}</script>`;

const run = (url: string, html: string) =>
  auditFromSources(makeSources({ url, html }));

describe("nested JSON-LD entities", () => {
  it("finds a Person nested as an Article author", () => {
    const html = page({
      head: jsonLd({
        "@context": "https://schema.org",
        "@type": "Article",
        headline: "What a widget is",
        author: { "@type": "Person", name: "Jane Doe" },
        datePublished: "2026-01-10",
      }),
    });
    expect(statusOf(run("https://acme.com/blog/widgets/", html), "C4")).toBe("pass");
  });

  it("finds an Organization nested as an Article publisher", () => {
    const html = page({
      head: jsonLd({
        "@context": "https://schema.org",
        "@type": "Article",
        headline: "What a widget is",
        publisher: {
          "@type": "Organization",
          name: "Acme",
          url: "https://acme.com",
          logo: { "@type": "ImageObject", url: "https://acme.com/logo.png" },
          sameAs: ["https://www.wikidata.org/wiki/Q1"],
        },
      }),
    });
    expect(statusOf(run("https://acme.com/blog/widgets/", html), "C2")).toBe("pass");
  });
});

describe("brand token", () => {
  it.each([
    ["https://en.wikipedia.org/wiki/Widget", "wikipedia"],
    ["https://blog.hubspot.com/marketing/widgets", "hubspot"],
    ["https://developer.mozilla.org/en-US/docs/Widget", "mozilla"],
    ["https://www.bbc.co.uk/news/widgets", "bbc"],
    ["https://www.wednesday.is/", "wednesday"],
  ])("uses the registrable domain for %s", (url, brand) => {
    expect(evidenceOf(run(url, page({})), "D12")).toContain(`"${brand}"`);
  });
});

describe("FAQPage schema requirement", () => {
  it("is N/A when the page only has a few question marks", () => {
    const html = page({
      body: "<p>Why do teams use widgets? Because they are fast. Are they cheap? Usually, yes, for most teams.</p>",
    });
    expect(statusOf(run("https://acme.com/blog/widgets/", html), "C5")).toBe("na");
  });

  it("is N/A when FAQ is only mentioned in passing", () => {
    const html = page({
      body: "<p>Read our FAQ for more details about widgets and how teams roll them out.</p>",
    });
    expect(statusOf(run("https://acme.com/blog/widgets/", html), "C5")).toBe("na");
  });

  it("counts one question heading once, even when it contains bold text", () => {
    const html = page({
      body: "<h2>Looking for help with <strong>design or product strategy?</strong></h2><p>Talk to our team about your roadmap.</p>",
    });
    expect(statusOf(run("https://acme.com/", html), "C5")).toBe("na");
  });

  it("counts one question heading once when its text is split across tags", () => {
    const html = page({
      body: "<h2>Who is <span>Acme</span>?</h2><p>Acme is a widget company that serves product teams.</p>",
    });
    expect(statusOf(run("https://acme.com/", html), "C5")).toBe("na");
  });

  it("still fails when a visible FAQ section has no FAQPage schema", () => {
    const html = page({
      body: "<h2>Frequently asked questions</h2><h3>What is a widget?</h3><p>A small reusable component used by product teams.</p><h3>Who uses widgets?</h3><p>Product teams that want to ship features faster.</p>",
    });
    expect(statusOf(run("https://acme.com/blog/widgets/", html), "C5")).toBe("fail");
  });
});

describe("page-type guesses", () => {
  it("does not treat an SEO article that mentions an API as a developer product", () => {
    const html = page({
      body: "<p>You can pull ranking data from the Search Console API, or use a crawler library or framework of your choice.</p>",
    });
    expect(statusOf(run("https://acme.com/blog/what-is-seo/", html), "E7")).toBe("na");
  });

  it("does not treat a docs page that mentions sign up and platform as a SaaS offering", () => {
    const html = page({
      body: "<p>HTML is the platform for web content. Sign up for the newsletter to get updates about the software.</p>",
    });
    expect(statusOf(run("https://acme.com/en-US/docs/Web/HTML", html), "E1")).toBe("na");
  });

  it("counts a Clutch profile as a review surface", () => {
    const html = page({
      body: '<p>See our reviews on <a href="https://clutch.co/profile/acme">Clutch</a>. Book a demo today.</p>',
    });
    expect(statusOf(run("https://acme.com/", html), "E1")).toBe("pass");
  });
});

describe("opening paragraph (B1)", () => {
  const intro =
    "Acme is a widget company that helps product teams ship reusable interface components faster across web and mobile apps.";

  it("skips images before the intro", () => {
    const html = `<!doctype html><html><head><title>Acme widgets</title></head><body><main><p><img src="/_next/image?url=%2Fimages%2Fuwu.png&w=640&q=75" alt="logo" title="logo by @sawaratsuki1004 drawn for the community homepage"></p><h1>Acme</h1><p>${intro}</p><p>${PARAGRAPH.repeat(4)}</p></main></body></html>`;
    expect(evidenceOf(run("https://acme.com/", html), "B1")).toContain("Acme is a widget company");
  });

  it("skips a banner that sits before the H1", () => {
    const html = `<!doctype html><html><head><title>Acme widgets</title></head><body><div><p>Once a month, what we are seeing inside businesses using widgets and AI. Get the newsletter now →</p></div><main><h1>Acme</h1><p>${intro}</p><p>${PARAGRAPH.repeat(4)}</p></main></body></html>`;
    expect(evidenceOf(run("https://acme.com/", html), "B1")).toContain("Acme is a widget company");
  });

  it("collapses text that responsive markup repeats back to back", () => {
    const line = "The product development system for teams and agents";
    const html = `<!doctype html><html><head><title>Acme widgets</title></head><body><main><h1>Acme</h1><p><span>${line}</span><span>${line}</span><span>${line}</span> built by Acme for every team.</p><p>${PARAGRAPH.repeat(4)}</p></main></body></html>`;
    const evidence = evidenceOf(run("https://acme.com/", html), "B1");
    expect(evidence.split(line).length - 1).toBe(1);
  });
});

describe("readability (B13)", () => {
  it("treats headings and list items as sentence boundaries on marketing pages", () => {
    const blocks = Array.from(
      { length: 12 },
      (_, i) =>
        `<h2>Senior product engineering teams for fast growing companies number ${i}</h2><ul><li>Design systems that scale with your product</li><li>Mobile apps your customers love to use</li></ul>`,
    ).join("");
    const html = `<!doctype html><html><head><title>Acme widgets</title></head><body><main><h1>Acme</h1>${blocks}<p>${PARAGRAPH.repeat(3)}</p></main></body></html>`;
    expect(statusOf(run("https://acme.com/", html), "B13")).toBe("pass");
  });

  it("passes plain, clear prose around grade 8", () => {
    const prose =
      "A widget is a reusable part of an interface that handles one specific job, such as a button or a search box. Product teams build each widget once and then use it across many pages of their application. This keeps the design consistent and saves a lot of engineering time every quarter. Most teams start with forms, menus, and simple cards before they move on to charts. ";
    const html = `<!doctype html><html><head><title>Acme widgets</title></head><body><main><h1>Acme</h1><p>${prose.repeat(3)}</p><p>${prose.repeat(2)}</p></main></body></html>`;
    expect(statusOf(run("https://acme.com/", html), "B13")).toBe("pass");
  });
});

describe("date signals", () => {
  it("counts a published date in schema and a visible date outside the main content", () => {
    const html = page({
      head: jsonLd({
        "@context": "https://schema.org",
        "@type": "Article",
        headline: "What a widget is",
        datePublished: "2025-07-25",
      }),
    }).replace("<main>", "<header><span>July 25, 2025</span></header><main>");
    expect(statusOf(run("https://acme.com/blog/widgets/", html), "B12")).toBe("partial");
  });
});
