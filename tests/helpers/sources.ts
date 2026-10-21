import { readFileSync } from "node:fs";

import type { PageSources } from "@/lib/audit";
import type { AuditResult, AuditStatus } from "@/lib/audit-types";
import type { PageSpeedResult } from "@/lib/pagespeed";
import type { LlmsTxtInfo, SitemapInfo } from "@/lib/site-files";

export const ARTICLE_HTML = readFileSync(
  new URL("../fixtures/article.html", import.meta.url),
  "utf8",
);

export const GOOD_PAGESPEED: PageSpeedResult = {
  performanceScore: 95,
  lcpMs: 1800,
  cls: 0.02,
  tbtMs: 120,
};

type Overrides = {
  url?: string;
  /** Final URL after redirects; defaults to `url`. */
  finalUrl?: string;
  html?: string;
  status?: number;
  redirects?: number;
  robotsTxt?: string | null;
  /** HTTP status of /robots.txt; defaults to 200, or 404 when robotsTxt is null. */
  robotsTxtStatus?: number | null;
  llmsTxt?: LlmsTxtInfo;
  sitemap?: Partial<SitemapInfo>;
  pageSpeed?: PageSpeedResult | null;
};

export function makeSources(overrides: Overrides = {}): PageSources {
  const url = overrides.url ?? "https://acme.com/blog/what-is-a-widget/";
  return {
    requestedUrl: url,
    page: {
      finalUrl: overrides.finalUrl ?? url,
      status: overrides.status ?? 200,
      contentType: "text/html; charset=utf-8",
      body: overrides.html ?? ARTICLE_HTML,
      redirects: overrides.redirects ?? 0,
    },
    site: {
      robotsTxt:
        overrides.robotsTxt === undefined
          ? "User-agent: *\nAllow: /\nSitemap: https://acme.com/sitemap.xml\n"
          : overrides.robotsTxt,
      robotsTxtStatus:
        overrides.robotsTxtStatus !== undefined
          ? overrides.robotsTxtStatus
          : overrides.robotsTxt === null
            ? 404
            : 200,
      llmsTxt:
        overrides.llmsTxt === undefined
          ? { status: 200, contentType: "text/plain", body: "# Acme\n\n> Widgets.\n" }
          : overrides.llmsTxt,
      sitemap: {
        declared: true,
        url: "https://acme.com/sitemap.xml",
        found: true,
        ...overrides.sitemap,
      },
    },
    pageSpeed:
      overrides.pageSpeed === undefined ? GOOD_PAGESPEED : overrides.pageSpeed,
  };
}

export function statusOf(audit: AuditResult, id: string): AuditStatus {
  const item = audit.categories
    .flatMap((c) => c.items)
    .find((i) => i.id === id);
  if (!item) throw new Error(`No audit item ${id}`);
  return item.status;
}

export function evidenceOf(audit: AuditResult, id: string): string {
  const item = audit.categories
    .flatMap((c) => c.items)
    .find((i) => i.id === id);
  if (!item) throw new Error(`No audit item ${id}`);
  return item.evidence;
}
