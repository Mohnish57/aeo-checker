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
import { parsePage } from "@/lib/dom";
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
import { fetchSiteFiles, isRealLlmsTxt, type SiteFiles } from "@/lib/site-files";
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
  const { categories, rawScore } = scoreCategories(ctx);

  // Rounded once, from unrounded category totals, so it never exceeds 100.
  const score = round1(Math.min(rawScore, 100));
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
      robotsTxt: ctx.robotsTxt !== null ? "found" : "missing",
      llmsTxt: isRealLlmsTxt(ctx.llmsTxt) ? "found" : "missing",
      sitemap: ctx.sitemap.found ? "found" : "missing",
      pageSpeed: ctx.pageSpeed ? "ready" : "unavailable",
      pageSpeedReportUrl: pageSpeedReportUrl(sources.page.finalUrl),
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
  // Parse once (depth-limited, see lib/dom.ts). Every extractor below reads
  // this DOM; regexes over raw, attacker-chosen HTML were quadratic on
  // unclosed tags.
  const parsed = parsePage(html);
  const { document } = parsed;
  const metas = [...document.querySelectorAll("meta")];
  const markdown = htmlToMainMarkdown(parsed.html, parsed);
  const htmlText = nodeText(document);
  const analysisText = normalizeWhitespace(markdown || htmlText);
  const title = extractTitle(document) ?? firstMarkdownHeading(markdown);
  const description = extractMetaContent(metas, "description");
  const links = extractLinks(document, markdown, pageUrl);
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
  } = extractJsonLd(document);
  const schema = summarizeSchema(jsonLd);
  const headings = extractHeadings(document, markdown);
  const h1Count = Math.max(
    document.querySelectorAll("h1").length,
    headings.filter((h) => h.level === 1).length,
  );
  const h2Count = Math.max(
    document.querySelectorAll("h2").length,
    headings.filter((h) => h.level === 2).length,
  );
  const paragraphs = extractParagraphs(markdown || htmlText);
  const words = countWords(analysisText);
  const htmlWords = countWords(htmlText);
  const dataPoints = countDataPoints(analysisText);
  const grade = fleschKincaidGrade(analysisText);
  const dateSignals = extractDateSignals(document, analysisText, jsonLd);
  const canonical = extractCanonical(document);
  const hasNoIndex = detectNoIndex(metas);
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
    htmlLang: extractHtmlLang(document),
    viewport: extractMetaContent(metas, "viewport"),
    openGraph: {
      title: !!extractMetaContent(metas, "og:title"),
      description: !!extractMetaContent(metas, "og:description"),
      image: !!extractMetaContent(metas, "og:image"),
    },
    twitterCard: !!extractMetaContent(metas, "twitter:card"),
    images: countImages(document),
  };
}

// ---------------------------------------------------------------------------
// Scoring: iterate RULES, group by category, apply multipliers.
// ---------------------------------------------------------------------------

type Evaluated = { rule: Rule; result: RuleEvaluation };

function scoreCategories(ctx: RuleContext): {
  categories: AuditCategory[];
  rawScore: number;
} {
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

  const scored = evaluated.map(({ category, results }) =>
    scoreCategory(
      category,
      results,
      isActive(results) ? category.maxScore * scale : 0,
    ),
  );
  return {
    categories: scored.map((entry) => entry.category),
    rawScore: scored.reduce((sum, entry) => sum + entry.rawScore, 0),
  };
}

function scoreCategory(
  category: CategoryDef,
  evaluated: Evaluated[],
  maxScore: number,
): { category: AuditCategory; rawScore: number } {
  // Denominator only includes applicable (non-N/A) rules so N/A items
  // don't inflate scores by getting full credit or shrinking weights.
  const applicable = evaluated.filter(({ result }) => result.status !== "na");
  const denominator = applicable.reduce(
    (sum, { rule }) => sum + (rule.multiplier ?? 1),
    0,
  );

  // Item rows are rounded for display only; the category total is computed
  // from unrounded values and rounded once so it can never exceed maxScore.
  let rawScore = 0;
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
      rawScore += itemMax * STATUS_VALUE[result.status];
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

  rawScore = Math.min(rawScore, maxScore);
  return {
    rawScore,
    category: {
      id: category.id,
      name: category.name,
      description: category.description,
      score: round1(rawScore),
      maxScore: round1(maxScore),
      naExcluded: evaluated.length - applicable.length,
      items,
    },
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

function extractTitle(document: Document): string | null {
  const title = document.querySelector("title");
  return title ? normalizeWhitespace(title.textContent ?? "") : null;
}

function firstMarkdownHeading(markdown: string): string | null {
  const match = markdown.match(/^#\s+(.+)$/m);
  return match ? normalizeWhitespace(match[1]) : null;
}

function metaName(meta: Element): string | null {
  return meta.getAttribute("name") ?? meta.getAttribute("property");
}

function extractMetaContent(metas: Element[], name: string): string | null {
  for (const meta of metas) {
    if (metaName(meta)?.toLowerCase() === name.toLowerCase()) {
      const content = meta.getAttribute("content");
      if (content) return content;
    }
  }
  return null;
}

function extractCanonical(document: Document): string | null {
  for (const link of document.querySelectorAll("link[rel]")) {
    const rel = link.getAttribute("rel") ?? "";
    if (rel.toLowerCase().split(/\s+/).includes("canonical")) {
      return link.getAttribute("href");
    }
  }
  return null;
}

function detectNoIndex(metas: Element[]): boolean {
  return metas.some((meta) => {
    const name = metaName(meta) ?? "";
    const content = meta.getAttribute("content") ?? "";
    return /robots|googlebot/i.test(name) && /\bnoindex\b/i.test(content);
  });
}

function extractHtmlLang(document: Document): string | null {
  return document.querySelector("html")?.getAttribute("lang")?.trim() || null;
}

function countImages(document: Document): { total: number; withAlt: number } {
  const images = [...document.querySelectorAll("img")];
  return {
    total: images.length,
    // alt="" is a valid decorative-image marker, so presence is what counts.
    withAlt: images.filter((img) => img.hasAttribute("alt")).length,
  };
}

function extractLinks(
  document: Document,
  markdown: string,
  baseUrl: string,
): string[] {
  const raw = new Set<string>();
  for (const anchor of document.querySelectorAll("a[href]")) {
    const href = anchor.getAttribute("href");
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

function extractJsonLd(document: Document): {
  schemas: JsonObject[];
  blockCount: number;
  parseFailures: number;
} {
  // type="application/ld+json" in any quoting, case or surrounding whitespace.
  const blocks = [...document.querySelectorAll("script[type]")].filter(
    (script) =>
      script.getAttribute("type")?.trim().toLowerCase() ===
      "application/ld+json",
  );

  const schemas: JsonObject[] = [];
  let parseFailures = 0;

  for (const block of blocks) {
    const raw = stripScriptWrappers(block.textContent ?? "").trim();
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

function extractHeadings(document: Document, markdown: string): Heading[] {
  const headings: Heading[] = [...domHeadings(document)];
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
  document: Document,
  text: string,
  schemas: JsonObject[],
): DateSignals {
  const hasSchemaModified = schemas.some((s) => !!s.dateModified);
  const hasTimeTag = document.querySelector("time") !== null;
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

const NON_TEXT_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT"]);
const HEADING_TAG = /^H([1-6])$/;

/**
 * <h1>-<h6> in document order with their text, in one pass. Text inside a
 * nested heading belongs to the innermost one, so nested headings cost
 * O(n) rather than re-walking each subtree.
 */
function domHeadings(document: Document): Heading[] {
  const found: { level: number; parts: string[] }[] = [];
  const stack: { node: Node; heading: number }[] = [{ node: document, heading: -1 }];
  while (stack.length) {
    const { node, heading } = stack.pop()!;
    if (node.nodeType === 3) {
      if (heading >= 0) found[heading].parts.push(node.nodeValue ?? "");
      continue;
    }
    let current = heading;
    if (node.nodeType === 1) {
      const tag = (node as Element).tagName.toUpperCase();
      if (NON_TEXT_TAGS.has(tag)) continue;
      const level = HEADING_TAG.exec(tag)?.[1];
      if (level) {
        found.push({ level: Number(level), parts: [] });
        current = found.length - 1;
      }
    } else if (node.nodeType !== 9 && node.nodeType !== 11) {
      continue;
    }
    const children = node.childNodes;
    for (let i = children.length - 1; i >= 0; i--) {
      stack.push({ node: children[i], heading: current });
    }
  }
  return found.map(({ level, parts }) => ({
    level,
    text: normalizeWhitespace(parts.join(" ")),
  }));
}

/**
 * Visible-ish text of a node: every text node outside script/style/noscript,
 * space-separated. Iterative so deeply nested pages cannot overflow the stack.
 */
function nodeText(root: Node): string {
  const parts: string[] = [];
  const stack: Node[] = [root];
  while (stack.length) {
    const node = stack.pop()!;
    if (node.nodeType === 3) {
      parts.push(node.nodeValue ?? "");
      continue;
    }
    if (node.nodeType === 1) {
      if (NON_TEXT_TAGS.has((node as Element).tagName.toUpperCase())) continue;
    } else if (node.nodeType !== 9 && node.nodeType !== 11) {
      continue; // comments, doctype, processing instructions
    }
    const children = node.childNodes;
    for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
  }
  return normalizeWhitespace(parts.join(" "));
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: '"',
};

/** Only for JSON-LD that a publisher (incorrectly) HTML-encoded. */
function decodeHtml(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, code: string) => {
    if (code[0] === "#") {
      const point =
        code[1] === "x" || code[1] === "X"
          ? parseInt(code.slice(2), 16)
          : parseInt(code.slice(1), 10);
      return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : entity;
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? entity;
  });
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
