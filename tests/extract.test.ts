import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { htmlToMainMarkdown } from "@/lib/extract";

const article = readFileSync(
  new URL("./fixtures/article.html", import.meta.url),
  "utf8",
);

describe("htmlToMainMarkdown", () => {
  const md = htmlToMainMarkdown(article);

  it("keeps headings as ATX markdown", () => {
    expect(md).toMatch(/^## How widgets are priced$/m);
  });

  it("keeps the page H1", () => {
    expect(md).toMatch(/^# What a widget is$/m);
  });

  it("keeps list items", () => {
    expect(md).toMatch(/^-\s+Starter: \$20 per seat$/m);
  });

  it("keeps blockquotes", () => {
    expect(md).toMatch(/^>\s/m);
  });

  it("separates paragraphs with blank lines", () => {
    expect(md).toMatch(/worldwide in 2026\.\n\n/);
  });

  it("drops scripts", () => {
    expect(md).not.toContain("should never appear");
  });

  it("handles empty input", () => {
    expect(htmlToMainMarkdown("")).toBe("");
  });

  it("falls back to body content for tiny pages", () => {
    expect(htmlToMainMarkdown("<html><body><p>Hello world</p></body></html>")).toContain(
      "Hello world",
    );
  });
});
