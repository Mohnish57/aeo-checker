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
import { buildFixPrompts } from "@/lib/agent-fix-prompt";
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
import {
  fetchSiteFiles,
  isRealLlmsTxt,
  isRobotsServerError,
  type SiteFiles,
} from "@/lib/site-files";
import { detectPlatform } from "@/lib/platform";
import { BLOCKED_SCORE_CAP } from "@/lib/projection";
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
  if (!page.body.trim()) {
    throw new FetchError(
      "blocked",
      `The site returned an empty page (HTTP ${page.status}) to our checker. That is usually bot protection, which tends to block AI crawlers too, so check your firewall or bot-management rules.`,
    );
  }
  if (isBotChallenge(page.body)) {
    throw new FetchError(
      "blocked",
      "The site showed our checker a bot challenge (CAPTCHA or browser check) instead of the page. AI crawlers usually get the same challenge, so check your firewall or bot-management rules.",
    );
  }
  const isHtml =
    /html/i.test(page.contentType) ||
    /^\s*(<!doctype html|<html)/i.test(page.body);
  if (!isHtml) {
    throw new FetchError("not-html", "That URL did not return an HTML page.");
  }
}

/** Challenge pages are small; real pages with a reCAPTCHA form are not checked. */
const MAX_CHALLENGE_PAGE_CHARS = 50_000;
const CHALLENGE_TITLE =
  /<title[^>]*>\s*(just a moment|attention required|access denied|are you a robot|security check|verify you are human)/i;
const CHALLENGE_MARKER =
  /(cf-chl|challenge-platform|\/errors\/validatecaptcha|px-captcha|_incapsula_resource|type the characters you see|bm-verify=|\/_sec\/verify|awswafcookiedomainlist|gokuprops)/i;

function isBotChallenge(body: string): boolean {
  if (body.length > MAX_CHALLENGE_PAGE_CHARS) return false;
  return CHALLENGE_TITLE.test(body) || CHALLENGE_MARKER.test(body);
}

/**
 * Why each blocking rule (see BLOCKING_RULE_IDS in lib/projection.ts) keeps
 * the page out of AI answers; the score is capped while any of them fails.
 */
const BLOCKING_RULES: Record<string, string> = {
  A8: "the main content needs JavaScript to appear, and AI crawlers usually don't run it",
  A12: "a noindex directive keeps it out of the search indexes AI engines draw on",
  A13: "robots.txt blocks one or more AI answer bots (see A13)",
};

export function auditFromSources(sources: PageSources): AuditResult {
  const ctx = buildContext(sources);
  const { categories, rawScore } = scoreCategories(ctx);
  const items = categories.flatMap((c) => c.items);
  const blockers = items.filter(
    (item) => item.status === "fail" && item.id in BLOCKING_RULES,
  );

  // Rounded once, from unrounded category totals, so it never exceeds 100.
  const score = round1(
    Math.min(rawScore, blockers.length ? BLOCKED_SCORE_CAP : 100),
  );
  const topPriorities = [
    ...blockers,
    ...items
      .filter((item) => item.status === "fail" || item.status === "partial")
      .filter((item) => !blockers.includes(item))
      .sort((a, b) => b.maxScore - a.maxScore),
  ]
    .slice(0, 5)
    .map((item) => `${item.id}: ${item.recommendation}`);

  const audit: Omit<AuditResult, "agentPrompts"> = {
    url: sources.requestedUrl,
    host: ctx.host,
    platform: detectPlatform({
      html: ctx.html,
      host: ctx.url.hostname,
      generator: ctx.generator,
    }),
    pageExcerpt: excerpt(ctx.markdown),
    title: ctx.title,
    description: ctx.description,
    fetchedAt: new Date().toISOString(),
    score,
    band: blockers.length
      ? {
          label: "Critical",
          interpretation: `This page is shut out of some or all AI answers: ${blockers
            .map((item) => BLOCKING_RULES[item.id])
            .join("; ")}. The score is capped at ${BLOCKED_SCORE_CAP} until this is fixed.`,
        }
      : scoreBand(score),
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
      robotsTxt:
        ctx.robotsTxt !== null
          ? "found"
          : isRobotsServerError(ctx.robotsTxtStatus)
            ? "error"
            : "missing",
      llmsTxt: isRealLlmsTxt(ctx.llmsTxt) ? "found" : "missing",
      sitemap: ctx.sitemap.found ? "found" : "missing",
      pageSpeed: ctx.pageSpeed ? "ready" : "unavailable",
      pageSpeedReportUrl: pageSpeedReportUrl(sources.page.finalUrl),
      jsonLdParseFailures: ctx.jsonLdParseFailures,
    },
  };

  return { ...audit, agentPrompts: buildFixPrompts(audit, audit.platform) };
}

const EXCERPT_CHARS = 1_200;

/**
 * The start of the page's main content as readable text: images dropped,
 * links reduced to their text, cut at a word boundary.
 */
function excerpt(markdown: string): string {
  const text = markdown
    .replace(/!\[[^\]]*\]\((?:\\.|[^)\\])*\)/g, "")
    .replace(/\[([^\]]*)\]\((?:\\.|[^)\\])*\)/g, (_, label: string) =>
      label.replace(/\s+/g, " ").trim(),
    )
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (text.length <= EXCERPT_CHARS) return text;
  const cut = text.slice(0, EXCERPT_CHARS);
  return `${cut.slice(0, cut.lastIndexOf(" ")).trimEnd()} …`;
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
  // Links inside the main content only: citations, not nav or footer.
  const contentExternalLinks = extractMarkdownLinks(markdown, pageUrl).filter(
    (link) => new URL(link).origin !== url.origin,
  );
  const ogImage = extractMetaContent(metas, "og:image");
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
  const leadParagraph = extractLeadParagraph(paragraphs, document, htmlText);
  const words = countWords(analysisText);
  const htmlWords = countWords(htmlText);
  const dataPoints = countDataPoints(analysisText);
  const grade = fleschKincaidGrade(markdown || htmlText);
  const dateSignals = extractDateSignals(document, analysisText, htmlText, jsonLd);
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
    generator: extractMetaContent(metas, "generator"),
    html,
    htmlText,
    htmlWords,
    markdown,
    analysisText,
    words,
    paragraphs,
    leadParagraph,
    headings,
    h1Count,
    h2Count,
    links,
    externalLinks,
    sameOriginLinks,
    contentExternalLinks,
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
    robotsTxtStatus: site.robotsTxtStatus,
    llmsTxt: site.llmsTxt,
    sitemap: site.sitemap,
    pageSpeed,
    htmlLang: extractHtmlLang(document),
    viewport: extractMetaContent(metas, "viewport"),
    openGraph: {
      title: !!extractMetaContent(metas, "og:title"),
      description: !!extractMetaContent(metas, "og:description"),
      image: !!ogImage,
      imageUrl: ogImage,
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

/** Web links in Markdown (main content), skipping images, resolved and deduped. */
function extractMarkdownLinks(markdown: string, baseUrl: string): string[] {
  const links = new Set<string>();
  for (const match of markdown.matchAll(/(?<!!)\[[^\]]*\]\(([^)\s]+)/g)) {
    try {
      const url = new URL(match[1], baseUrl);
      if (url.protocol === "http:" || url.protocol === "https:") {
        url.hash = "";
        links.add(url.toString());
      }
    } catch {
      // Ignore malformed links.
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

/** Deep enough for Article > author > worksFor > address; bounds hostile nesting. */
const MAX_SCHEMA_DEPTH = 12;

/**
 * Every object in a JSON-LD value, parents before children. Entities are
 * often nested (Article.author is a Person, Article.publisher an
 * Organization), so reading only the top level and @graph misses them.
 */
function flattenSchema(value: unknown, depth = 0): JsonObject[] {
  if (depth > MAX_SCHEMA_DEPTH) return [];
  if (Array.isArray(value)) {
    return value.flatMap((item) => flattenSchema(item, depth + 1));
  }
  if (!isObject(value)) return [];
  return [
    value,
    ...Object.values(value).flatMap((child) => flattenSchema(child, depth + 1)),
  ];
}

function summarizeSchema(schemas: JsonObject[]): SchemaSummary {
  const organizations = schemas.filter((s) =>
    hasSchemaType(s, ["Organization", "LocalBusiness", "Corporation"]),
  );
  const hasOrganization = organizations.length > 0;
  const sameAsCount = schemas.reduce((sum, s) => {
    const sameAs = s.sameAs;
    if (Array.isArray(sameAs)) return sum + sameAs.length;
    if (typeof sameAs === "string") return sum + 1;
    return sum;
  }, 0);
  // A page can carry several (publisher, author's employer); judge the best.
  const organizationComplete =
    sameAsCount >= 1 && organizations.some((o) => o.name && o.url && o.logo);

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
      text: normalizeWhitespace(stripInlineMarkdown(match[2])),
    });
  }

  // The same heading usually appears in both the DOM and the Markdown, and
  // extraction can shift its level, so dedupe on text alone (DOM first).
  // Whitespace is ignored: DOM text joins inline tags with spaces
  // ("Who is <span>X</span>?" reads "Who is X ?").
  const seen = new Set<string>();
  return headings.filter((h) => {
    const key = h.text.toLowerCase().replace(/\s+/g, "");
    if (seen.has(key)) return false;
    seen.add(key);
    return h.text.length > 0;
  });
}

/** `**bold**`, `_em_`, `` `code` `` and `[text](url)` down to their text. */
function stripInlineMarkdown(text: string): string {
  return text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__|\*|_|`)(.+?)\1/g, "$2")
    .replace(/\\([\\`*_{}[\]()#+\-.!])/g, "$1");
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
          // Images are not prose; links keep their text, not their URL.
          .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
          .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1"),
      ),
    )
    .filter((paragraph) => countWords(paragraph) >= 8);
}

const MIN_LEAD_WORDS = 12;
/** Each candidate costs a scan of the page text, so only the first few are tried. */
const MAX_LEAD_CANDIDATES = 20;
const LEAD_PROBE_CHARS = 40;
/** Bounds the backreference scan below; leads longer than this are kept as-is. */
const MAX_REPEAT_SCAN_CHARS = 1_000;

/**
 * The page's opening paragraph: the first substantive one that sits after
 * the H1 in the page, so banners and announcement bars above the title are
 * skipped. Position comes from the DOM because main-content extraction can
 * drop the H1 or move it. Text that responsive markup renders several times
 * back to back is collapsed.
 */
function extractLeadParagraph(
  paragraphs: string[],
  document: Document,
  pageText: string,
): string {
  const compact = (value: string) => value.replace(/\s+/g, "").toLowerCase();
  const candidates = paragraphs
    .filter((p) => countWords(p) >= MIN_LEAD_WORDS)
    .slice(0, MAX_LEAD_CANDIDATES);
  const h1 = document.querySelector("h1");
  const page = compact(pageText);
  const afterH1Text = h1 ? compact(nodeText(document, h1)) : "";
  const afterH1 = (p: string) => {
    const probe = compact(stripInlineMarkdown(p)).slice(0, LEAD_PROBE_CHARS);
    // Not found verbatim (escaping, entities): don't rule it out.
    return afterH1Text.includes(probe) || !page.includes(probe);
  };
  const lead =
    (h1 ? candidates.find(afterH1) : undefined) ?? candidates[0] ?? "";
  return lead.length <= MAX_REPEAT_SCAN_CHARS
    ? lead.replace(/(.{20,}?)\1+/g, "$1")
    : lead;
}

function countDataPoints(text: string): number {
  const matches = text.match(
    /\b(?:19|20)\d{2}\b|\b\d+(?:\.\d+)?\s?%|\$\s?\d+(?:[,.]\d+)*|\b\d+(?:\.\d+)?x\b|\b\d+(?:,\d{3})+(?:\.\d+)?\b/g,
  );
  return matches ? matches.length : 0;
}

/**
 * `text` is the main content; `pageText` is the whole page. Publish dates
 * often sit in a header that main-content extraction drops, so any date on
 * the page counts, but "updated" must appear in the main content so a footer
 * line like "Privacy policy updated 2024" does not pass.
 */
function extractDateSignals(
  document: Document,
  text: string,
  pageText: string,
  schemas: JsonObject[],
): DateSignals {
  const hasSchemaModified = schemas.some((s) => !!s.dateModified);
  const hasSchemaPublished = schemas.some((s) => !!s.datePublished);
  const hasTimeTag = document.querySelector("time") !== null;
  const hasVisibleModified =
    /\b(updated|last updated|modified|last modified)\b.{0,40}\b(?:19|20)\d{2}\b/i.test(
      text,
    );
  const hasVisibleDate =
    /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+(?:19|20)\d{2}\b/i.test(
      pageText,
    ) || /\b(?:19|20)\d{2}-\d{2}-\d{2}\b/.test(pageText);
  const hasAnyDate =
    hasSchemaModified || hasSchemaPublished || hasTimeTag || hasVisibleDate;

  return {
    hasAnyDate,
    hasModifiedDate: hasSchemaModified || hasVisibleModified,
    evidence: `dateModified schema: ${yesNo(hasSchemaModified)}; datePublished schema: ${yesNo(hasSchemaPublished)}; visible date: ${yesNo(hasVisibleDate)}; visible modified date: ${yesNo(hasVisibleModified)}; time tag: ${yesNo(hasTimeTag)}.`,
  };
}

function yesNo(value: boolean): string {
  return value ? "yes" : "no";
}

const FAQ_PATTERN = /\b(faqs?|frequently asked questions|questions and answers)\b/i;

/**
 * "pass" means a real FAQ section: an FAQ heading or two question headings.
 * A passing mention of "FAQ" or a few question marks in prose is "partial",
 * which B5 rewards a little but which does not make C5 demand FAQPage schema.
 */
function computeFaqStatus(text: string, headings: Heading[]): AuditStatus {
  const questionHeadings = headings.filter((h) => h.text.includes("?"));
  if (headings.some((h) => FAQ_PATTERN.test(h.text))) return "pass";
  if (questionHeadings.length >= 2) return "pass";
  if (
    FAQ_PATTERN.test(text) ||
    questionHeadings.length === 1 ||
    countMatches(text, /\?/g) >= 2
  ) {
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
 * With `from`, only text from that node onward (in document order) is kept.
 */
function nodeText(root: Node, from?: Node): string {
  const parts: string[] = [];
  const stack: Node[] = [root];
  let collecting = !from;
  while (stack.length) {
    const node = stack.pop()!;
    if (node === from) collecting = true;
    if (node.nodeType === 3) {
      if (collecting) parts.push(node.nodeValue ?? "");
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

/**
 * `text` keeps its line breaks (Markdown). Each line is a block (heading,
 * list item, paragraph) and ends at least one sentence: marketing headlines
 * and bullets rarely end in a full stop, and gluing them into one
 * "sentence" pushed landing pages to grade 25.
 */
function fleschKincaidGrade(text: string): number | null {
  // Flesch-Kincaid is English-specific. Bail out for CJK-heavy text.
  if (cjkRatio(text) > 0.35) return null;

  const words = text.match(/[A-Za-z][A-Za-z'-]*/g) ?? [];
  const sentences = text
    .split("\n")
    .filter((line) => /[A-Za-z]/.test(line))
    .reduce(
      (sum, line) => sum + Math.max(1, line.match(/[.!?]+(?:\s|$)/g)?.length ?? 0),
      0,
    );
  if (words.length < 80 || sentences < 3) return null;
  const syllables = words.reduce((sum, w) => sum + countSyllables(w), 0);
  return (
    0.39 * (words.length / sentences) +
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
