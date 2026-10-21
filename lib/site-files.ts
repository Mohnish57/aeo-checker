/**
 * Site-level files that AI crawlers read before the page itself.
 * Missing files are data (they become failing checks), never errors.
 */
import { safeFetch, type FetchResult } from "@/lib/net/safe-fetch";

export type LlmsTxtInfo = {
  status: number;
  contentType: string;
  body: string;
} | null;

export type SitemapInfo = {
  /** robots.txt declared at least one Sitemap: URL. */
  declared: boolean;
  url: string | null;
  found: boolean;
};

export type SiteFiles = {
  robotsTxt: string | null;
  llmsTxt: LlmsTxtInfo;
  sitemap: SitemapInfo;
};

const FILE_OPTIONS = {
  timeoutMs: 6_000,
  maxBytes: 1_000_000,
  truncate: true,
  accept: "text/plain,text/markdown,application/xml,text/xml;q=0.9,*/*;q=0.5",
};

export async function fetchSiteFiles(pageUrl: URL): Promise<SiteFiles> {
  const origin = pageUrl.origin;
  const [robots, llms] = await Promise.all([
    tryFetch(`${origin}/robots.txt`),
    tryFetch(`${origin}/llms.txt`),
  ]);

  const robotsTxt =
    robots && robots.status === 200 && !looksLikeHtml(robots)
      ? robots.body
      : null;
  const llmsTxt: LlmsTxtInfo = llms
    ? {
        status: llms.status,
        contentType: llms.contentType,
        body: llms.body.slice(0, 20_000),
      }
    : null;

  return { robotsTxt, llmsTxt, sitemap: await findSitemap(origin, robotsTxt) };
}

export function parseSitemapDirectives(robotsTxt: string): string[] {
  return robotsTxt
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*sitemap\s*:\s*(\S+)/i)?.[1])
    .filter((value): value is string => Boolean(value));
}

export function isSitemapXml(body: string): boolean {
  return /<(urlset|sitemapindex)\b/i.test(body);
}

export function looksLikeHtml(file: {
  contentType: string;
  body: string;
}): boolean {
  return (
    /text\/html/i.test(file.contentType) ||
    /^\s*(<!doctype html|<html)/i.test(file.body)
  );
}

async function findSitemap(
  origin: string,
  robotsTxt: string | null,
): Promise<SitemapInfo> {
  const declaredUrls = robotsTxt ? parseSitemapDirectives(robotsTxt) : [];
  const candidates = declaredUrls.length
    ? declaredUrls.slice(0, 2)
    : [`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`];

  for (const url of candidates) {
    const result = await tryFetch(url);
    if (
      result?.status === 200 &&
      (isSitemapXml(result.body) || /\.gz$/i.test(url))
    ) {
      return { declared: declaredUrls.length > 0, url, found: true };
    }
  }
  return {
    declared: declaredUrls.length > 0,
    url: candidates[0] ?? null,
    found: false,
  };
}

async function tryFetch(url: string): Promise<FetchResult | null> {
  try {
    return await safeFetch(url, FILE_OPTIONS);
  } catch {
    return null;
  }
}
