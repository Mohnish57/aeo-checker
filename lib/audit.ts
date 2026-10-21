/**
 * Audit orchestrator.
 *
 * Responsibilities:
 *   1. Fetch the page, its site files (robots.txt, llms.txt, sitemap) and
 *      PageSpeed Insights data (`fetchPageSources`).
 *   2. Parse those into a `RuleContext` (everything rules need to inspect).
 *   3. Run every rule from `lib/rules.ts` and assemble the AuditResult.
 *
 * Only `fetchPageSources` touches the network; `auditFromSources` is pure so
 * it can be tested with fixtures. To change *what* is measured, edit
 * `lib/rules.ts`.
 */
import { buildAgentFixPrompts } from "@/lib/agent-fix-prompt";
import type {
  AuditBand,
  AuditCategory,
  AuditItem,
  AuditResult,
  AuditStatus,
} from "@/lib/audit-types";
import { htmlToMainMarkdown } from "@/lib/extract";
import { FetchError, safeFetch, type FetchResult } from "@/lib/net/safe-fetch";
import {
  fetchPageSpeed,
  pageSpeedReportUrl,
  type PageSpeedResult,
} from "@/lib/pagespeed";
import {
  CATEGORIES,
  RULES,
  countMatches,
  countWords,
  type CategoryDef,
  type DateSignals,
  type Heading,
  type JsonObject,
  type Rule,
  type RuleContext,
  type RuleEvaluation,
  type SchemaSummary,
} from "@/lib/rules";
import { fetchSiteFiles, type SiteFiles } from "@/lib/site-files";
import { displayHost } from "@/lib/url";

const STATUS_VALUE: Record<AuditStatus, number> = {
  pass: 1,
  partial: 0.5,
  fail: 0,
  na: 0, // N/A rules do not contribute to the score.
};

export type PageSources = {
  requestedUrl: string;
  page: FetchResult;
  site: SiteFiles;
  pageSpeed: PageSpeedResult | null;
};

export type RunAuditOptions = { pageSpeedApiKey?: string };

export async function runAudit(
  normalizedUrl: string,
  options: RunAuditOptions = {},
): Promise<AuditResult> {
  return auditFromSources(await fetchPageSources(normalizedUrl, options));
}

export async function fetchPageSources(
  normalizedUrl: string,
  options: RunAuditOptions = {},
): Promise<PageSources> {
  const page = await safeFetch(normalizedUrl);
  assertAuditablePage(page);
  // PageSpeed takes 15-40s; it starts only once the page is known to be
  // auditable and runs alongside the site-file fetches. It never rejects.
  const [site, pageSpeed] = await Promise.all([
    fetchSiteFiles(new URL(page.finalUrl)),
    fetchPageSpeed(page.finalUrl, options.pageSpeedApiKey),
  ]);
  return { requestedUrl: normalizedUrl, page, site, pageSpeed };
}

const BOT_WALL_STATUSES = new Set([401, 403, 429, 503]);

export function assertAuditablePage(page: FetchResult): void {
  if (BOT_WALL_STATUSES.has(page.status)) {
    throw new FetchError(
      "blocked",
      `The site blocked our checker (HTTP ${page.status}). Bot protection that blocks us usually blocks AI crawlers too, so check your firewall or bot-management rules.`,
    );
  }
  if (page.status >= 400) {
    throw new FetchError("http-error", `The page returned HTTP ${page.status}.`);
  }
  const isHtml =
    /html/i.test(page.contentType) ||
    /^\s*(<!doctype html|<html)/i.test(page.body);
  if (!isHtml) {
    throw new FetchError("not-html", "That URL did not return an HTML page.");
  }
}

export function auditFromSources(sources: PageSources): AuditResult {
  const ctx = buildContext(sources);
  const categories = scoreCategories(ctx);

  const score = round1(categories.reduce((sum, c) => sum + c.score, 0));
  const topPriorities = categories
    .flatMap((c) => c.items)
    .filter((item) => item.status === "fail" || item.status === "partial")
    .sort((a, b) => b.maxScore - a.maxScore)
    .slice(0, 5)
    .map((item) => `${item.id}: ${item.recommendation}`);

  const audit: Omit<AuditResult, "agentPrompts"> = {
    url: sources.requestedUrl,
    host: ctx.host,
    title: ctx.title,
    description: ctx.description,
    fetchedAt: new Date().toISOString(),
    score,
    band: scoreBand(score),
    topPriorities,
    stats: {
      markdownChars: ctx.markdown.length,
      rawHtmlChars: ctx.html.length,
      words: ctx.words,
      headings: ctx.headings.length,
      links: ctx.links.length,
      externalLinks: ctx.externalLinks.length,
      jsonLdBlocks: ctx.jsonLdBlockCount,
    },
    categories,
    diagnostics: {
      httpStatus: ctx.httpStatus,
      redirects: ctx.redirects,
      markdownExtract: ctx.markdown ? "ready" : "empty",
      robotsTxt: ctx.robotsTxt ? "found" : "missing",
      llmsTxt: ctx.llmsTxt?.status === 200 ? "found" : "missing",
      sitemap: ctx.sitemap.found ? "found" : "missing",
      pageSpeed: ctx.pageSpeed ? "ready" : "unavailable",
      pageSpeedReportUrl: pageSpeedReportUrl(sources.requestedUrl),
      jsonLdParseFailures: ctx.jsonLdParseFailures,
    },
  };

  return { ...audit, agentPrompts: buildAgentFixPrompts(audit) };
}

// ---------------------------------------------------------------------------
// Context building: parse everything that rules might want to read.
// ---------------------------------------------------------------------------

function buildContext(sources: PageSources): RuleContext {
  const { page, site, pageSpeed } = sources;
  const url = new URL(page.finalUrl);
  const pageUrl = url.toString();
  const host = displayHost(pageUrl);

  const html = page.body;
  const markdown = htmlToMainMarkdown(html);
  const htmlText = htmlToText(html);
  const analysisText = normalizeWhitespace(markdown || htmlText);
  const title = extractTitle(html) ?? firstMarkdownHeading(markdown);
  const description = extractMetaContent(html, "description");
  const links = extractLinks(html, markdown, pageUrl);
  const externalLinks = links.filter(
    (link) => new URL(link).origin !== url.origin,
  );
  const sameOriginLinks = links.filter(
    (link) => new URL(link).origin === url.origin,
  );
  const {
    schemas: jsonLd,
    blockCount: jsonLdBlockCount,
    parseFailures: jsonLdParseFailures,
  } = extractJsonLd(html);
  const schema = summarizeSchema(jsonLd);
  const headings = extractHeadings(html, markdown);
  const h1Count = Math.max(
    countMatches(html, /<h1\b/gi),
    headings.filter((h) => h.level === 1).length,
  );
  const h2Count = Math.max(
    countMatches(html, /<h2\b/gi),
    headings.filter((h) => h.level === 2).length,
  );
  const paragraphs = extractParagraphs(markdown || htmlText);
  const words = countWords(analysisText);
  const htmlWords = countWords(htmlText);
  const dataPoints = countDataPoints(analysisText);
  const grade = fleschKincaidGrade(analysisText);
  const dateSignals = extractDateSignals(html, analysisText, jsonLd);
  const canonical = extractCanonical(html);
  const hasNoIndex = detectNoIndex(html);
  const faqStatus = computeFaqStatus(analysisText, headings);
  const hasByline = detectByline(analysisText, schema);

  return {
    url,
    host,
    title,
    description,
    canonical,
    hasNoIndex,
    html,
    htmlText,
    htmlWords,
    markdown,
    analysisText,
    words,
    paragraphs,
    headings,
    h1Count,
    h2Count,
    links,
    externalLinks,
    sameOriginLinks,
    jsonLd,
    jsonLdBlockCount,
    jsonLdParseFailures,
    schema,
    dataPoints,
    grade,
    dateSignals,
    faqStatus,
    hasByline,
    httpStatus: page.status,
    redirects: page.redirects,
    robotsTxt: site.robotsTxt,
    llmsTxt: site.llmsTxt,
    sitemap: site.sitemap,
    pageSpeed,
    htmlLang: extractHtmlLang(html),
    viewport: extractMetaContent(html, "viewport"),
    openGraph: {
      title: !!extractMetaContent(html, "og:title"),
      description: !!extractMetaContent(html, "og:description"),
      image: !!extractMetaContent(html, "og:image"),
    },
    twitterCard: !!extractMetaContent(html, "twitter:card"),
    images: countImages(html),
  };
}

// ---------------------------------------------------------------------------
// Scoring: iterate RULES, group by category, apply multipliers.
// ---------------------------------------------------------------------------

type Evaluated = { rule: Rule; result: RuleEvaluation };

function scoreCategories(ctx: RuleContext): AuditCategory[] {
  const evaluated = CATEGORIES.map((category) => ({
    category,
    results: RULES.filter((rule) => rule.categoryId === category.id).map(
      (rule): Evaluated => ({ rule, result: rule.evaluate(ctx) }),
    ),
  }));

  // A category where every rule is N/A (e.g. PageSpeed unavailable) gives
  // its weight to the others so the total stays out of 100.
  const isActive = (results: Evaluated[]) =>
    results.some(({ result }) => result.status !== "na");
  const activeTotal = evaluated
    .filter(({ results }) => isActive(results))
    .reduce((sum, { category }) => sum + category.maxScore, 0);
  const scale = activeTotal > 0 ? 100 / activeTotal : 0;

  return evaluated.map(({ category, results }) =>
    scoreCategory(
      category,
      results,
      isActive(results) ? category.maxScore * scale : 0,
    ),
  );
}

function scoreCategory(
  category: CategoryDef,
  evaluated: Evaluated[],
  maxScore: number,
): AuditCategory {
  // Denominator only includes applicable (non-N/A) rules so N/A items
  // don't inflate scores by getting full credit or shrinking weights.
  const applicable = evaluated.filter(({ result }) => result.status !== "na");
  const denominator = applicable.reduce(
    (sum, { rule }) => sum + (rule.multiplier ?? 1),
    0,
  );

  const items: AuditItem[] = evaluated
    .map(({ rule, result }) => {
      if (result.status === "na" || denominator === 0) {
        return {
          id: rule.id,
          label: rule.label,
          status: result.status,
          evidence: result.evidence,
          recommendation: rule.recommendation,
          maxScore: 0,
          score: 0,
        };
      }
      const itemMax = (maxScore * (rule.multiplier ?? 1)) / denominator;
      return {
        id: rule.id,
        label: rule.label,
        status: result.status,
        evidence: result.evidence,
        recommendation: rule.recommendation,
        maxScore: round1(itemMax),
        score: round1(itemMax * STATUS_VALUE[result.status]),
      };
    })
    .sort((a, b) => b.maxScore - a.maxScore);

  return {
    id: category.id,
    name: category.name,
    description: category.description,
    score: round1(items.reduce((sum, item) => sum + item.score, 0)),
    maxScore: round1(maxScore),
    naExcluded: evaluated.length - applicable.length,
    items,
  };
}

function scoreBand(score: number): AuditBand {
  if (score <= 40) {
    return {
      label: "Critical",
      interpretation:
        "The page is structurally hard for AI engines to fetch, parse, or trust.",
    };
  }
  if (score <= 55) {
    return {
      label: "Below average",
      interpretation:
        "Foundations are present in places, but the page is losing extractability and trust signals.",
    };
  }
  if (score <= 70) {
    return {
      label: "Average",
      interpretation:
        "The page has reasonable AI SEO hygiene, with gaps in chunking, schema, or authority signals.",
    };
  }
  if (score <= 85) {
    return {
      label: "Strong",
      interpretation:
        "The page is structured well enough to compete for AI citations on relevant prompts.",
    };
  }
  return {
    label: "Excellent",
    interpretation:
      "The page exposes strong crawlability, structure, schema, and trust signals.",
  };
}

// ---------------------------------------------------------------------------
// Parsing helpers: turn raw HTML/markdown into the structured fields rules
// expect. These are internal; rules only ever read from the RuleContext.
// ---------------------------------------------------------------------------

function extractTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? decodeHtml(normalizeWhitespace(match[1])) : null;
}

function firstMarkdownHeading(markdown: string): string | null {
  const match = markdown.match(/^#\s+(.+)$/m);
  return match ? normalizeWhitespace(match[1]) : null;
}

function extractMetaContent(html: string, name: string): string | null {
  const tags = html.match(/<meta\b[^>]*>/gi) ?? [];
  for (const tag of tags) {
    const tagName = getAttr(tag, "name") ?? getAttr(tag, "property");
    if (tagName?.toLowerCase() === name.toLowerCase()) {
      const content = getAttr(tag, "content");
      if (content) return decodeHtml(content);
    }
  }
  return null;
}

function extractCanonical(html: string): string | null {
  const tags = html.match(/<link\b[^>]*>/gi) ?? [];
  for (const tag of tags) {
    const rel = getAttr(tag, "rel");
    if (rel?.toLowerCase().split(/\s+/).includes("canonical")) {
      return getAttr(tag, "href");
    }
  }
  return null;
}

function detectNoIndex(html: string): boolean {
  const tags = html.match(/<meta\b[^>]*>/gi) ?? [];
  return tags.some((tag) => {
    const name = getAttr(tag, "name") ?? getAttr(tag, "property");
    const content = getAttr(tag, "content") ?? "";
    return /robots|googlebot/i.test(name ?? "") && /\bnoindex\b/i.test(content);
  });
}

function extractHtmlLang(html: string): string | null {
  const tag = html.match(/<html\b[^>]*>/i)?.[0];
  const lang = tag ? getAttr(tag, "lang") : null;
  return lang?.trim() || null;
}

function countImages(html: string): { total: number; withAlt: number } {
  const tags = html.match(/<img\b[^>]*>/gi) ?? [];
  return {
    total: tags.length,
    // alt="" is a valid decorative-image marker, so presence is what counts.
    withAlt: tags.filter((tag) => getAttr(tag, "alt") !== null).length,
  };
}

function getAttr(tag: string, attr: string): string | null {
  // Require attribute boundary (^ or whitespace) before the name so that e.g.
  // `href` does NOT match `data-href`. Supports double-quoted, single-quoted,
  // and unquoted attribute values.
  const escaped = attr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `(?:^|\\s)${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
    "i",
  );
  const match = tag.match(pattern);
  if (!match) return null;
  return decodeHtml(match[1] ?? match[2] ?? match[3] ?? "");
}

function extractLinks(
  html: string,
  markdown: string,
  baseUrl: string,
): string[] {
  const raw = new Set<string>();
  const anchorTags = html.match(/<a\b[^>]*>/gi) ?? [];
  for (const tag of anchorTags) {
    const href = getAttr(tag, "href");
    if (href) raw.add(href);
  }
  for (const match of markdown.matchAll(
    /\[[^\]]+\]\((https?:\/\/[^)\s]+)\)/gi,
  )) {
    raw.add(match[1]);
  }

  const links = new Set<string>();
  for (const href of raw) {
    try {
      const url = new URL(href, baseUrl);
      if (url.protocol === "http:" || url.protocol === "https:") {
        url.hash = "";
        links.add(url.toString());
      }
    } catch {
      // Ignore malformed and non-web links.
    }
  }
  return [...links];
}

function extractJsonLd(html: string): {
  schemas: JsonObject[];
  blockCount: number;
  parseFailures: number;
} {
  // Match <script ... type=...application/ld+json...>...</script> permissively:
  //   - allow whitespace around `=`
  //   - allow single, double, or unquoted attribute values
  //   - allow extra attributes before or after the type attribute
  const pattern =
    /<script\b[^>]*\btype\s*=\s*(?:"\s*application\/ld\+json\s*"|'\s*application\/ld\+json\s*'|application\/ld\+json)[^>]*>([\s\S]*?)<\/script>/gi;
  const blocks = [...html.matchAll(pattern)];

  const schemas: JsonObject[] = [];
  let parseFailures = 0;

  for (const block of blocks) {
    const raw = stripScriptWrappers(block[1]).trim();
    if (!raw) continue;
    const parsed = tryParseJson(raw);
    if (parsed === undefined) {
      parseFailures++;
      continue;
    }
    schemas.push(...flattenSchema(parsed));
  }

  return { schemas, blockCount: blocks.length, parseFailures };
}

/**
 * Strip wrappers some CMSs inject around inline JSON-LD:
 *   <!-- {...} -->
 *   //<![CDATA[\n{...}\n//]]>
 *   /*<![CDATA[* / {...} /*]]>* /
 */
function stripScriptWrappers(body: string): string {
  let out = body.trim();
  out = out.replace(/^<!--/, "").replace(/-->$/, "");
  out = out.replace(/^\/\/\s*<!\[CDATA\[/, "").replace(/\/\/\s*\]\]>$/, "");
  out = out.replace(/^\/\*\s*<!\[CDATA\[\s*\*\//, "").replace(/\/\*\s*\]\]>\s*\*\/$/, "");
  return out.trim();
}

/**
 * Parse JSON-LD body. Tries raw first because `<script>` content is NOT
 * HTML-entity-decoded by browsers, so decoding `&amp;` → `&` first would
 * corrupt URLs with query strings. Falls back to a decoded retry only if
 * the raw parse fails.
 */
function tryParseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    // Some publishers do HTML-encode their JSON-LD (incorrectly). Retry.
    try {
      return JSON.parse(decodeHtml(raw));
    } catch {
      return undefined;
    }
  }
}

function flattenSchema(value: unknown): JsonObject[] {
  if (Array.isArray(value)) return value.flatMap(flattenSchema);
  if (!isObject(value)) return [];

  const objects = [value];
  const graph = value["@graph"];
  if (Array.isArray(graph)) {
    objects.push(...graph.filter(isObject));
  }
  return objects;
}

function summarizeSchema(schemas: JsonObject[]): SchemaSummary {
  const hasOrganization = schemas.some((s) =>
    hasSchemaType(s, ["Organization", "LocalBusiness", "Corporation"]),
  );
  const organization = schemas.find((s) =>
    hasSchemaType(s, ["Organization", "LocalBusiness", "Corporation"]),
  );
  const sameAsCount = schemas.reduce((sum, s) => {
    const sameAs = s.sameAs;
    if (Array.isArray(sameAs)) return sum + sameAs.length;
    if (typeof sameAs === "string") return sum + 1;
    return sum;
  }, 0);
  const organizationComplete = !!(
    organization &&
    organization.name &&
    organization.url &&
    organization.logo &&
    sameAsCount >= 1
  );

  const articles = schemas.filter((s) =>
    hasSchemaType(s, ["Article", "BlogPosting", "NewsArticle"]),
  );
  const articleComplete = articles.some(
    (s) => s.headline && s.author && s.datePublished && s.dateModified,
  );
  const hasPerson = schemas.some((s) => hasSchemaType(s, ["Person"]));
  const hasAuthor = schemas.some((s) => !!s.author);
  const hasFaq = schemas.some((s) => hasSchemaType(s, ["FAQPage"]));

  return {
    hasOrganization,
    organizationComplete,
    organizationEvidence: hasOrganization
      ? `Organization-like schema found; complete core fields: ${organizationComplete ? "yes" : "no"}; sameAs links: ${sameAsCount}.`
      : "No Organization-like schema was found.",
    hasArticle: articles.length > 0,
    articleComplete,
    articleEvidence: articles.length
      ? `Article-like schema blocks: ${articles.length}; complete authorship/date fields: ${articleComplete ? "yes" : "no"}.`
      : "No Article or BlogPosting schema was found.",
    hasPerson,
    hasAuthor,
    hasFaq,
    sameAsCount,
  };
}

function hasSchemaType(schema: JsonObject, types: string[]): boolean {
  const raw = schema["@type"];
  const actual = Array.isArray(raw) ? raw : [raw];
  return actual.some(
    (type) => typeof type === "string" && types.includes(type),
  );
}

function extractHeadings(html: string, markdown: string): Heading[] {
  const headings: Heading[] = [];
  for (const match of html.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi)) {
    headings.push({ level: Number(match[1]), text: htmlToText(match[2]) });
  }
  for (const match of markdown.matchAll(/^(#{1,6})\s+(.+)$/gm)) {
    headings.push({
      level: match[1].length,
      text: normalizeWhitespace(match[2]),
    });
  }

  const seen = new Set<string>();
  return headings.filter((h) => {
    const key = `${h.level}:${h.text.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return h.text.length > 0;
  });
}

function extractParagraphs(text: string): string[] {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .split(/\n{2,}/)
    .map((paragraph) =>
      normalizeWhitespace(
        paragraph
          .replace(/^#{1,6}\s+/gm, "")
          .replace(/^[-*]\s+/gm, "")
          .replace(/\[[^\]]+\]\(([^)]+)\)/g, "$1"),
      ),
    )
    .filter((paragraph) => countWords(paragraph) >= 8);
}

function countDataPoints(text: string): number {
  const matches = text.match(
    /\b(?:19|20)\d{2}\b|\b\d+(?:\.\d+)?\s?%|\$\s?\d+(?:[,.]\d+)*|\b\d+(?:\.\d+)?x\b|\b\d+(?:,\d{3})+(?:\.\d+)?\b/g,
  );
  return matches ? matches.length : 0;
}

function extractDateSignals(
  html: string,
  text: string,
  schemas: JsonObject[],
): DateSignals {
  const hasSchemaModified = schemas.some((s) => !!s.dateModified);
  const hasTimeTag = /<time\b[^>]*(datetime=|>)/i.test(html);
  const hasVisibleModified =
    /\b(updated|last updated|modified|last modified)\b.{0,40}\b(?:19|20)\d{2}\b/i.test(
      text,
    );
  const hasAnyDate =
    hasSchemaModified ||
    hasTimeTag ||
    /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+(?:19|20)\d{2}\b/i.test(
      text,
    ) ||
    /\b(?:19|20)\d{2}-\d{2}-\d{2}\b/.test(text);

  return {
    hasAnyDate,
    hasModifiedDate: hasSchemaModified || hasVisibleModified,
    evidence: `dateModified schema: ${hasSchemaModified ? "yes" : "no"}; visible modified date: ${hasVisibleModified ? "yes" : "no"}; time tag: ${hasTimeTag ? "yes" : "no"}.`,
  };
}

function computeFaqStatus(text: string, headings: Heading[]): AuditStatus {
  const questionHeadings = headings.filter((h) => h.text.includes("?"));
  if (
    /\b(faq|frequently asked questions|questions and answers)\b/i.test(text)
  ) {
    return "pass";
  }
  if (questionHeadings.length >= 2) return "pass";
  if (questionHeadings.length === 1 || countMatches(text, /\?/g) >= 2) {
    return "partial";
  }
  return "fail";
}

function detectByline(text: string, schema: SchemaSummary): boolean {
  if (schema.hasPerson || schema.hasAuthor) return true;
  return /\b(by|written by|reviewed by|edited by)\s+[A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){0,3}\b/.test(
    text,
  );
}

function htmlToText(html: string): string {
  return normalizeWhitespace(
    decodeHtml(
      html
        .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
        .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
        .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " ")
        .replace(/<[^>]+>/g, " "),
    ),
  );
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function decodeHtml(value: string): string {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function fleschKincaidGrade(text: string): number | null {
  // Flesch-Kincaid is English-specific. Bail out for CJK-heavy text.
  if (cjkRatio(text) > 0.35) return null;

  const words = text.match(/[A-Za-z][A-Za-z'-]*/g) ?? [];
  const sentences = text.match(/[.!?]+(?:\s|$)/g) ?? [];
  if (words.length < 80 || sentences.length < 3) return null;
  const syllables = words.reduce((sum, w) => sum + countSyllables(w), 0);
  return (
    0.39 * (words.length / sentences.length) +
    11.8 * (syllables / words.length) -
    15.59
  );
}

function cjkRatio(text: string): number {
  const cjk = text.match(/[一-鿿㐀-䶿豈-﫿぀-ゟ゠-ヿ가-힯]/g);
  return Math.min(text.length, 1) ? (cjk?.length ?? 0) / Math.max(text.length, 1) : 0;
}

function countSyllables(word: string): number {
  const cleaned = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!cleaned) return 1;
  const withoutSilentE = cleaned.replace(/e$/, "");
  const groups = withoutSilentE.match(/[aeiouy]+/g);
  return Math.max(groups?.length ?? 1, 1);
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function isObject(value: unknown): value is JsonObject {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export { CATEGORIES, RULES } from "@/lib/rules";
export type { Rule, RuleContext, CategoryDef } from "@/lib/rules";
