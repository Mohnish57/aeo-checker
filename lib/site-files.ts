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

const DEFAULT_SITEMAP_PATHS = ["/sitemap.xml", "/sitemap_index.xml"];

async function findSitemap(
  origin: string,
  robotsTxt: string | null,
): Promise<SitemapInfo> {
  const declaredRaw = robotsTxt ? parseSitemapDirectives(robotsTxt) : [];
  const declared = declaredRaw.length > 0;

  // Resolve relative Sitemap values; skip any that don't parse.
  const declaredUrls = unique(
    declaredRaw.flatMap((value) => {
      try {
        return [new URL(value, origin).toString()];
      } catch {
        return [];
      }
    }),
  ).slice(0, 2);

  const fallbackUrls = DEFAULT_SITEMAP_PATHS.map(
    (path) => `${origin}${path}`,
  ).filter((url) => !declaredUrls.includes(url));

  const found =
    (await firstFoundSitemap(declaredUrls)) ??
    (await firstFoundSitemap(fallbackUrls));
  if (found) return { declared, url: found, found: true };

  return {
    declared,
    url: declaredUrls[0] ?? `${origin}/sitemap.xml`,
    found: false,
  };
}

/** Fetch candidates in parallel; return the first found, in candidate order. */
async function firstFoundSitemap(urls: string[]): Promise<string | null> {
  const results = await Promise.all(urls.map((url) => tryFetch(url)));
  const index = results.findIndex((result, i) =>
    isFoundSitemap(urls[i], result),
  );
  return index === -1 ? null : urls[index];
}

function isFoundSitemap(url: string, result: FetchResult | null): boolean {
  if (result?.status !== 200) return false;
  if (/\.gz$/i.test(new URL(url).pathname)) return !looksLikeHtml(result);
  return isSitemapXml(result.body);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

async function tryFetch(url: string): Promise<FetchResult | null> {
  try {
    return await safeFetch(url, FILE_OPTIONS);
  } catch {
    return null;
  }
}
