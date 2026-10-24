import { describe, expect, it } from "vitest";

import { buildFixPrompts } from "@/lib/agent-fix-prompt";
import { auditFromSources } from "@/lib/audit";
import type { AuditCategory, AuditItem, AuditStatus } from "@/lib/audit-types";
import { FIX_GUIDE, guideFor } from "@/lib/fix-guide";
import { PLATFORMS, detectPlatform } from "@/lib/platform";
import { BLOCKED_SCORE_CAP, projectedScore, rankFixes } from "@/lib/projection";
import { RULES } from "@/lib/rules";

import { makeSources } from "./helpers/sources";

describe("detectPlatform", () => {
  const page = (head: string, body = "") =>
    `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;

  it.each([
    ["webflow", page("", '<div data-wf-site="abc"></div>'), null],
    ["webflow", page(""), "Webflow"],
    ["framer", page('<link href="https://framerusercontent.com/a.css">'), "Framer b422c98"],
    ["wix", page('<img src="https://static.wixstatic.com/a.png">'), "Wix.com Website Builder"],
    ["squarespace", page('<link href="https://static1.squarespace.com/a.css">'), null],
    ["shopify", page('<script src="https://cdn.shopify.com/s/files/a.js"></script>'), null],
    ["wordpress", page('<link href="/wp-content/themes/a.css">'), null],
    ["wordpress", page(""), "WordPress 6.6"],
    ["hubspot", page(""), "HubSpot"],
    ["ghost", page(""), "Ghost 5.8"],
    ["lovable", page('<script src="https://cdn.gpteng.co/gptengineer.js"></script>'), null],
    ["custom", page('<script src="/_next/static/chunks/a.js"></script>'), null],
  ])("detects %s", (expected, html, generator) => {
    expect(detectPlatform({ html, host: "acme.com", generator })).toBe(expected);
  });

  it("prefers Framer over a stray Shopify asset", () => {
    const html = page(
      '<link href="https://framerusercontent.com/a.css"><script src="https://cdn.shopify.com/s/files/x.js"></script>',
    );
    expect(detectPlatform({ html, host: "acme.com", generator: null })).toBe("framer");
  });

  it.each([
    ["lovable", "my-app.lovable.app"],
    ["bolt", "demo.bolt.new"],
    ["v0", "x.vusercontent.net"],
    ["replit", "tool.replit.app"],
  ])("detects %s from the host", (expected, host) => {
    expect(detectPlatform({ html: page(""), host, generator: null })).toBe(expected);
  });

  it("gives every no-code platform a where-things-live hint", () => {
    for (const platform of Object.values(PLATFORMS)) {
      if (platform.style === "no-code") {
        expect([platform.id, platform.whereThingsLive.length > 40]).toEqual([platform.id, true]);
      }
    }
  });
});

describe("fix guide", () => {
  it("covers every rule with plain-English copy", () => {
    for (const rule of RULES) {
      const guide = FIX_GUIDE[rule.id];
      expect([rule.id, !!guide]).toEqual([rule.id, true]);
      expect(guide.title.length).toBeGreaterThan(10);
      expect(guide.problem.length).toBeGreaterThan(10);
      expect(guide.why.length).toBeGreaterThan(20);
    }
  });

  it("marks off-site work as not a site fix", () => {
    for (const id of ["E1", "D10", "H1", "H2", "H3", "H4"]) {
      expect([id, guideFor(id).siteFix]).toEqual([id, false]);
    }
    expect(guideFor("G1").siteFix).toBe(true);
  });

  it("falls back for unknown rule IDs", () => {
    expect(guideFor("Z9").title).toBe("Z9");
  });
});

function item(id: string, status: AuditStatus, maxScore: number): AuditItem {
  const value = { pass: 1, partial: 0.5, fail: 0, na: 0 }[status];
  return {
    id,
    label: id,
    status,
    evidence: "",
    recommendation: "",
    maxScore,
    score: maxScore * value,
  };
}

function categoriesOf(items: AuditItem[]): AuditCategory[] {
  return [
    {
      id: "X",
      name: "X",
      description: "",
      score: items.reduce((sum, i) => sum + i.score, 0),
      maxScore: items.reduce((sum, i) => sum + i.maxScore, 0),
      naExcluded: 0,
      items,
    },
  ];
}

describe("projectedScore", () => {
  const categories = categoriesOf([
    item("G1", "fail", 10),
    item("B6", "partial", 20),
    item("E1", "fail", 10), // not a site fix
    item("C1", "pass", 60),
  ]);

  it("counts every site-fixable issue as passing", () => {
    expect(projectedScore(categories)).toBe(90);
  });

  it("projects only the given fixes", () => {
    expect(projectedScore(categories, new Set(["G1"]))).toBe(80);
  });

  it("keeps the blocked cap while a blocker still fails", () => {
    const blocked = categoriesOf([item("A13", "fail", 10), item("G1", "fail", 10), item("C1", "pass", 80)]);
    expect(projectedScore(blocked, new Set(["G1"]))).toBe(BLOCKED_SCORE_CAP);
    expect(projectedScore(blocked)).toBe(100);
  });

  it("never exceeds 100", () => {
    const rounded = categoriesOf([item("G1", "fail", 50.1), item("C1", "pass", 50.1)]);
    expect(projectedScore(rounded)).toBe(100);
  });
});

describe("rankFixes", () => {
  it("puts blockers first, then the biggest gains, and skips off-site work", () => {
    const categories = categoriesOf([
      item("G1", "fail", 5),
      item("B6", "partial", 20),
      item("A12", "fail", 2),
      item("E1", "fail", 30),
      item("C1", "pass", 43),
    ]);
    expect(rankFixes(categories).map((i) => i.id)).toEqual(["A12", "B6", "G1"]);
  });
});

describe("buildFixPrompts", () => {
  const audit = auditFromSources(
    makeSources({
      html: `<!doctype html><html lang="en"><head><title>Acme</title></head><body><div data-wf-site="1"><h1>Acme widgets</h1><p>Acme builds widgets for small teams that need them fast and cheap.</p></div></body></html>`,
    }),
  );

  it("detects the platform and keeps an excerpt of the page", () => {
    expect(audit.platform).toBe("webflow");
    expect(audit.pageExcerpt).toContain("Acme builds widgets");
  });

  it("writes no-code prompts for the founder's builder", () => {
    const { full, topIssues } = buildFixPrompts(audit, "webflow");
    expect(full).toContain("I run my website on Webflow");
    expect(full).toContain(PLATFORMS.webflow.whereThingsLive);
    expect(full).toContain("Acme builds widgets");
    expect(full).not.toContain("guidelines.md");
    expect(topIssues[0].prompt).toContain("Webflow");
  });

  it("writes change requests for AI app builders", () => {
    const { full } = buildFixPrompts(audit, "lovable");
    expect(full).toContain("Make these changes to my Lovable site");
    expect(full).not.toContain("I'm not a developer");
  });

  it("writes developer briefs for custom sites", () => {
    const { full } = buildFixPrompts(audit, "custom");
    expect(full).toContain("You are an AI SEO implementation agent");
    expect(full).not.toContain("guidelines.md");
  });

  it("includes a prompt for every actionable issue", () => {
    const actionable = audit.categories
      .flatMap((c) => c.items)
      .filter((i) => i.status === "fail" || i.status === "partial");
    expect(buildFixPrompts(audit, "webflow").topIssues).toHaveLength(actionable.length);
  });

  it("matches the API's agentPrompts for the detected platform", () => {
    expect(audit.agentPrompts).toEqual(buildFixPrompts(audit, audit.platform));
  });
});
