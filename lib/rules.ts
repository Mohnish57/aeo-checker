/**
 * Authoritative source for every AI-SEO audit rule.
 *
 * To add, remove, or tune a rule:
 *   1. Edit (or add) an entry in `RULES` below.
 *   2. Make sure its `categoryId` points at one of the entries in `CATEGORIES`.
 *   3. Declare every input it reads from the page via `dependencies` (this is
 *      documentation only; the evaluator receives the full `RuleContext`).
 *   4. Optionally set `multiplier` (defaults to 1) to weight the rule inside
 *      its category. A category's `maxScore` is split across every rule's
 *      multiplier. N/A rules are excluded and their weight is redistributed
 *      within the category; a category whose rules are all N/A gives its
 *      weight to the other categories.
 *
 * Everything downstream (scoring, agent prompts, UI) derives from this file.
 */
import robotsParser from "robots-parser";

import type { AuditStatus } from "@/lib/audit-types";
import type { PageSpeedResult } from "@/lib/pagespeed";
import { isRealLlmsTxt, type LlmsTxtInfo, type SitemapInfo } from "@/lib/site-files";

export type RuleDependency =
  | "url"
  | "title"
  | "description"
  | "html"
  | "markdown"
  | "text"
  | "canonical"
  | "noindex-meta"
  | "links"
  | "json-ld"
  | "schema-summary"
  | "headings"
  | "paragraphs"
  | "data-points"
  | "date-signals"
  | "readability"
  | "http"
  | "robots-txt"
  | "llms-txt"
  | "sitemap"
  | "meta"
  | "images"
  | "pagespeed";

export type SchemaSummary = {
  hasOrganization: boolean;
  organizationComplete: boolean;
  organizationEvidence: string;
  hasArticle: boolean;
  articleComplete: boolean;
  articleEvidence: string;
  hasPerson: boolean;
  hasAuthor: boolean;
  hasFaq: boolean;
  sameAsCount: number;
};

export type DateSignals = {
  hasAnyDate: boolean;
  hasModifiedDate: boolean;
  evidence: string;
};

export type Heading = { level: number; text: string };

export type JsonObject = Record<string, unknown>;

/**
 * Everything a rule's evaluator can read about the audited page.
 * Built once per audit by `lib/audit.ts` and passed to every rule.
 */
export type RuleContext = {
  url: URL;
  host: string;

  title: string | null;
  description: string | null;
  canonical: string | null;
  hasNoIndex: boolean;

  html: string;
  htmlText: string;
  htmlWords: number;
  markdown: string;
  analysisText: string;
  words: number;

  paragraphs: string[];
  headings: Heading[];
  h1Count: number;
  h2Count: number;

  links: string[];
  externalLinks: string[];
  sameOriginLinks: string[];

  jsonLd: JsonObject[];
  /** Total `<script type="application/ld+json">` blocks found, including those that failed to parse. */
  jsonLdBlockCount: number;
  /** Number of JSON-LD blocks that were present but could not be parsed. */
  jsonLdParseFailures: number;
  schema: SchemaSummary;

  dataPoints: number;
  grade: number | null;
  dateSignals: DateSignals;

  /** Precomputed FAQ-content presence, shared by B5 and C5. */
  faqStatus: AuditStatus;
  /** Precomputed byline presence, shared by C4, D1, etc. */
  hasByline: boolean;

  /** HTTP status of the final response and number of redirect hops. */
  httpStatus: number;
  redirects: number;

  /** Site files from the page origin. null/false when missing. */
  robotsTxt: string | null;
  llmsTxt: LlmsTxtInfo;
  sitemap: SitemapInfo;

  /** Lighthouse mobile data; null when PageSpeed Insights was unavailable. */
  pageSpeed: PageSpeedResult | null;

  /** Classic SEO head/body signals. */
  htmlLang: string | null;
  viewport: string | null;
  openGraph: { title: boolean; description: boolean; image: boolean };
  twitterCard: boolean;
  images: { total: number; withAlt: number };
};

export type RuleEvaluation = {
  status: AuditStatus;
  evidence: string;
};

export type Rule = {
  id: string;
  categoryId: string;
  label: string;
  recommendation: string;
  /** Free-form list of inputs this rule reads. Documentation only. */
  dependencies: RuleDependency[];
  /** Weight relative to siblings in the same category. Defaults to 1. */
  multiplier?: number;
  evaluate: (ctx: RuleContext) => RuleEvaluation;
};

export type CategoryDef = {
  id: string;
  name: string;
  description: string;
  maxScore: number;
};

// ---------------------------------------------------------------------------
// Categories: total maxScore must add to 100.
// ---------------------------------------------------------------------------

export const CATEGORIES: CategoryDef[] = [
  {
    id: "A",
    name: "Technical AI Crawlability",
    description:
      "Can AI retrieval crawlers fetch and parse the page without JavaScript?",
    maxScore: 24,
  },
  {
    id: "B",
    name: "Content Structure & Chunking",
    description: "Can answer engines extract self-contained, quotable passages?",
    maxScore: 22,
  },
  {
    id: "C",
    name: "Structured Data / Schema",
    description:
      "Does the raw HTML expose machine-readable entities and page facts?",
    maxScore: 13,
  },
  {
    id: "D",
    name: "E-E-A-T & Entity Authority",
    description: "Does the page expose trust, authorship, and entity signals?",
    maxScore: 13,
  },
  {
    id: "E",
    name: "Off-site / Citation Surface Presence",
    description:
      "Does the page connect the brand to surfaces AI engines often cite?",
    maxScore: 6,
  },
  {
    id: "F",
    name: "Measurement & Governance",
    description: "Are monitoring and refresh signals visible or inferable?",
    maxScore: 2,
  },
  {
    id: "G",
    name: "Classic SEO",
    description:
      "Do title, description, social tags, images, and sitemap meet search-engine basics?",
    maxScore: 12,
  },
  {
    id: "H",
    name: "Performance",
    description:
      "Does the page load fast on mobile? Measured with Google PageSpeed Insights.",
    maxScore: 8,
  },
];

/** Bots that fetch pages live to answer or cite. Blocking them removes you from answers. */
export const AI_SEARCH_CRAWLERS = [
  "OAI-SearchBot",
  "ChatGPT-User",
  "Claude-SearchBot",
  "Claude-User",
  "PerplexityBot",
  "Perplexity-User",
] as const;

/** Bots that collect training data. Blocking them is a legitimate trade-off. */
export const AI_TRAINING_CRAWLERS = [
  "GPTBot",
  "ClaudeBot",
  "Google-Extended",
  "Applebot-Extended",
  "CCBot",
] as const;

export function blockedAiCrawlers(
  robotsTxt: string,
  pageUrl: string,
): { search: string[]; training: string[] } {
  const robots = robotsParser(new URL("/robots.txt", pageUrl).toString(), robotsTxt);
  const blocked = (bots: readonly string[]) =>
    bots.filter((bot) => robots.isDisallowed(pageUrl, bot) === true);
  return {
    search: blocked(AI_SEARCH_CRAWLERS),
    training: blocked(AI_TRAINING_CRAWLERS),
  };
}

// ---------------------------------------------------------------------------
// Rules: the authoritative list. Order within a category controls UI order.
// ---------------------------------------------------------------------------

export const RULES: Rule[] = [
  // ----- A. Technical AI Crawlability -------------------------------------
  {
    id: "A1",
    categoryId: "A",
    label: "HTTPS is used for the audited URL.",
    recommendation:
      "Serve the page over HTTPS and redirect HTTP to HTTPS with a single 301.",
    dependencies: ["url"],
    evaluate: (ctx) => ({
      status: ctx.url.protocol === "https:" ? "pass" : "fail",
      evidence:
        ctx.url.protocol === "https:"
          ? "The submitted URL uses HTTPS."
          : "The submitted URL is not HTTPS.",
    }),
  },
  {
    id: "A8",
    categoryId: "A",
    label: "Critical content is present in the raw HTML response.",
    recommendation:
      "Render primary copy, headings, FAQs, and schema on the server. AI crawlers often do not execute client-side JavaScript.",
    dependencies: ["html", "text"],
    multiplier: 2,
    evaluate: (ctx) => {
      const htmlWords = ctx.htmlWords;
      const extracted = Math.max(ctx.words, 1);
      const ratio = htmlWords / extracted;
      const status: AuditStatus =
        htmlWords >= 250 && ratio >= 0.35
          ? "pass"
          : htmlWords >= 80
            ? "partial"
            : "fail";
      return {
        status,
        evidence: `${htmlWords} readable words were found in the raw HTML; ${ctx.words} words were extracted as main content.`,
      };
    },
  },
  {
    id: "A11",
    categoryId: "A",
    label: "Canonical tag is present and points to an indexable URL.",
    recommendation:
      "Add a self-referencing canonical tag, or a deliberate canonical target for duplicate variants.",
    dependencies: ["canonical"],
    evaluate: (ctx) => ({
      status: ctx.canonical ? "pass" : "fail",
      evidence: ctx.canonical
        ? `Canonical URL: ${ctx.canonical}.`
        : "No canonical link tag was found in the raw HTML.",
    }),
  },
  {
    id: "A12",
    categoryId: "A",
    label: "No noindex directive was found.",
    recommendation:
      "Remove noindex from pages that should be eligible for AI search citation.",
    dependencies: ["noindex-meta"],
    evaluate: (ctx) => ({
      status: ctx.hasNoIndex ? "fail" : "pass",
      evidence: ctx.hasNoIndex
        ? "A robots noindex directive appears in the page HTML."
        : "No robots noindex directive was detected in the raw HTML.",
    }),
  },
  {
    id: "A13",
    categoryId: "A",
    label: "AI answer and search crawlers are allowed by robots.txt.",
    recommendation:
      "Allow OAI-SearchBot, ChatGPT-User, Claude-SearchBot, Claude-User, PerplexityBot, and Perplexity-User in robots.txt. Blocking training bots (GPTBot, ClaudeBot, Google-Extended) is optional, but blocking answer bots removes you from AI answers.",
    dependencies: ["robots-txt", "url"],
    multiplier: 2,
    evaluate: (ctx) => {
      if (ctx.robotsTxt === null) {
        return {
          status: "pass",
          evidence: "No robots.txt was found, so AI crawlers are not blocked.",
        };
      }
      if (!ctx.robotsTxt.trim()) {
        return {
          status: "pass",
          evidence: "robots.txt is empty, so AI crawlers are not blocked.",
        };
      }
      const { search, training } = blockedAiCrawlers(
        ctx.robotsTxt,
        ctx.url.toString(),
      );
      const status: AuditStatus = search.length
        ? "fail"
        : training.length
          ? "partial"
          : "pass";
      const parts = [
        search.length ? `answer/search bots blocked: ${search.join(", ")}` : "",
        training.length ? `training bots blocked: ${training.join(", ")}` : "",
      ].filter(Boolean);
      return {
        status,
        evidence: parts.length
          ? `For this URL, ${parts.join("; ")}.`
          : `All ${AI_SEARCH_CRAWLERS.length + AI_TRAINING_CRAWLERS.length} AI crawlers checked are allowed for this URL.`,
      };
    },
  },
  {
    id: "A14",
    categoryId: "A",
    label: "An llms.txt file guides AI engines to key content.",
    recommendation:
      "Publish /llms.txt: a Markdown file with an H1 site name, a one-line summary, and links to your most important pages.",
    dependencies: ["llms-txt"],
    multiplier: 0.5,
    evaluate: (ctx) => {
      const file = ctx.llmsTxt;
      if (!file || file.status !== 200) {
        return {
          status: "fail",
          evidence: `No /llms.txt file was found${file ? ` (HTTP ${file.status})` : ""}.`,
        };
      }
      if (!isRealLlmsTxt(file)) {
        return {
          status: "fail",
          evidence:
            "/llms.txt returned an HTML page (likely a catch-all route), not a real llms.txt file.",
        };
      }
      const hasHeading = /^\s*#\s+\S/m.test(file.body);
      return {
        status: hasHeading ? "pass" : "partial",
        evidence: hasHeading
          ? "/llms.txt exists and has a Markdown H1 heading."
          : "/llms.txt exists but has no Markdown H1 heading.",
      };
    },
  },
  {
    id: "A15",
    categoryId: "A",
    label: "The page is reached without a redirect chain.",
    recommendation:
      "Link and canonicalize to the final URL so crawlers reach it in at most one redirect.",
    dependencies: ["http"],
    multiplier: 0.5,
    evaluate: (ctx) => ({
      status: ctx.redirects <= 1 && ctx.httpStatus === 200 ? "pass" : "partial",
      evidence: `HTTP ${ctx.httpStatus} after ${ctx.redirects} redirect(s).`,
    }),
  },

  // ----- B. Content Structure & Chunking ----------------------------------
  {
    id: "B1",
    categoryId: "B",
    label: "The page opens with a direct-answer BLUF intro naming the entity.",
    recommendation:
      "Start with a 2-3 sentence answer that names the brand, product, or topic and states what the page is about.",
    dependencies: ["paragraphs", "title", "url"],
    evaluate: (ctx) => {
      const first = firstUsefulParagraph(ctx.paragraphs);
      let status: AuditStatus = "fail";
      if (first) {
        const w = countWords(first);
        const tokens = [
          ctx.host.split(".")[0],
          ...(ctx.title ?? "")
            .split(/[\s|:.-]+/)
            .filter((t) => t.length > 3)
            .slice(0, 4),
        ].filter(Boolean);
        const namesEntity = tokens.some((t) =>
          new RegExp(`\\b${escapeRegExp(t)}\\b`, "i").test(first),
        );
        const answerPattern =
          /\b(is|are|helps|provides|offers|refers to|means|enables|builds|delivers)\b/i.test(
            first,
          );
        if (w >= 20 && w <= 90 && namesEntity && answerPattern) status = "pass";
        else if (w >= 12 && w <= 130 && (namesEntity || answerPattern))
          status = "partial";
      }
      return {
        status,
        evidence: first
          ? `First substantive paragraph: "${clip(first, 180)}"`
          : "No substantive opening paragraph was extracted.",
      };
    },
  },
  {
    id: "B2",
    categoryId: "B",
    label: "Heading hierarchy is clear with one H1 and topical H2 sections.",
    recommendation:
      "Use one H1, then H2/H3 boundaries for each answerable topic or sub-query.",
    dependencies: ["headings"],
    evaluate: (ctx) => {
      const status: AuditStatus =
        ctx.h1Count === 1 && ctx.h2Count >= 2
          ? "pass"
          : ctx.h1Count >= 1 && ctx.h2Count >= 1
            ? "partial"
            : "fail";
      return {
        status,
        evidence: `Detected ${ctx.h1Count} H1 heading(s), ${ctx.h2Count} H2 heading(s), and ${ctx.headings.length} total Markdown/HTML headings.`,
      };
    },
  },
  {
    id: "B3",
    categoryId: "B",
    label: "Paragraphs are short enough for passage retrieval.",
    recommendation:
      "Keep paragraphs to one idea each, usually 1-4 sentences and under roughly 120 words.",
    dependencies: ["paragraphs"],
    evaluate: (ctx) => {
      const paragraphs = ctx.paragraphs;
      const long = paragraphs.filter((p) => countWords(p) > 120).length;
      const veryLong = paragraphs.filter((p) => countWords(p) > 180).length;
      let status: AuditStatus = "fail";
      if (paragraphs.length) {
        if (veryLong === 0 && long / paragraphs.length <= 0.15) status = "pass";
        else if (veryLong <= 2 && long / paragraphs.length <= 0.35)
          status = "partial";
      }
      return {
        status,
        evidence: `${paragraphs.length} paragraph(s) found; ${long} exceed 120 words.`,
      };
    },
  },
  {
    id: "B4",
    categoryId: "B",
    label: "Sections are self-contained semantic chunks.",
    recommendation:
      "Break long pages into specific H2/H3 sections that can stand alone when retrieved as chunks.",
    dependencies: ["headings", "text"],
    evaluate: (ctx) => {
      const status: AuditStatus =
        ctx.h2Count >= 3 && ctx.words / Math.max(ctx.h2Count, 1) <= 450
          ? "pass"
          : ctx.h2Count >= 2
            ? "partial"
            : "fail";
      return {
        status,
        evidence: `${ctx.words} words across ${Math.max(ctx.h2Count, 1)} H2-level section(s).`,
      };
    },
  },
  {
    id: "B5",
    categoryId: "B",
    label: "FAQ or Q&A structure appears where appropriate.",
    recommendation:
      "Add a concise FAQ section for common prompt-style questions, especially on commercial and informational pages.",
    dependencies: ["text", "headings"],
    evaluate: (ctx) => ({
      status: ctx.faqStatus,
      evidence: `${countMatches(ctx.analysisText, /\?/g)} question mark(s) and ${ctx.headings.filter((h) => h.text.includes("?")).length} question-style heading(s) detected.`,
    }),
  },
  {
    id: "B6",
    categoryId: "B",
    label: "The page contains concrete data points.",
    recommendation:
      "Add dated statistics, named sources, percentages, benchmarks, prices, or other extractable facts.",
    dependencies: ["data-points"],
    evaluate: (ctx) => ({
      status:
        ctx.dataPoints >= 3 ? "pass" : ctx.dataPoints >= 1 ? "partial" : "fail",
      evidence: `${ctx.dataPoints} dated specifics, percentages, money values, multipliers, or named-entity-like data points were detected.`,
    }),
  },
  {
    id: "B7",
    categoryId: "B",
    label: "Quoted source or expert language is present.",
    recommendation:
      "Include at least one clearly attributed quote or sourced claim on long-form pages.",
    dependencies: ["markdown", "text"],
    evaluate: (ctx) => {
      const blockquote = /(^|\n)\s*>/.test(ctx.markdown);
      const accordingTo = /\baccording to\b/i.test(ctx.analysisText);
      const inlineQuote = /"[^"]{20,}"/.test(ctx.analysisText);
      const status: AuditStatus =
        blockquote || accordingTo ? "pass" : inlineQuote ? "partial" : "fail";
      return {
        status,
        evidence: blockquote
          ? "Markdown blockquote syntax was found."
          : accordingTo
            ? 'The phrase "according to" was found.'
            : "No obvious quotation or source-attribution pattern was found.",
      };
    },
  },
  {
    id: "B8",
    categoryId: "B",
    label: "External citations support major claims.",
    recommendation:
      "Link major factual claims to authoritative external sources so AI engines can cross-check them.",
    dependencies: ["links"],
    evaluate: (ctx) => ({
      status:
        ctx.externalLinks.length >= 3
          ? "pass"
          : ctx.externalLinks.length >= 1
            ? "partial"
            : "fail",
      evidence: `${ctx.externalLinks.length} external link(s) were detected.`,
    }),
  },
  {
    id: "B10",
    categoryId: "B",
    label: "Definitional sentence patterns are present.",
    recommendation:
      'Use patterns like "X is defined as..." or "X refers to..." for core concepts.',
    dependencies: ["text"],
    evaluate: (ctx) => {
      const found =
        /\b(is defined as|are defined as|refers to|means|is a|is an)\b/i.test(
          ctx.analysisText,
        );
      return {
        status: found ? "pass" : "fail",
        evidence: found
          ? "A definitional sentence pattern was detected."
          : "No clear definitional sentence pattern was detected.",
      };
    },
  },
  {
    id: "B11",
    categoryId: "B",
    label: "Internal links create sibling-page fan-out coverage.",
    recommendation:
      "Link to at least three related pages that cover adjacent questions, comparisons, use cases, or FAQs.",
    dependencies: ["links"],
    evaluate: (ctx) => ({
      status:
        ctx.sameOriginLinks.length >= 3
          ? "pass"
          : ctx.sameOriginLinks.length >= 1
            ? "partial"
            : "fail",
      evidence: `${ctx.sameOriginLinks.length} same-origin link(s) were detected in the page HTML or Markdown.`,
    }),
  },
  {
    id: "B12",
    categoryId: "B",
    label: "A visible or structured last-updated date exists.",
    recommendation:
      "Show a visible updated date and include dateModified in schema for pages that should be cited.",
    dependencies: ["date-signals", "url", "text"],
    evaluate: (ctx) => {
      if (!isArticleLike(ctx)) {
        return {
          status: "na",
          evidence:
            "This page does not look like an article or blog post, so a last-updated date is not required.",
        };
      }
      return {
        status: ctx.dateSignals.hasModifiedDate
          ? "pass"
          : ctx.dateSignals.hasAnyDate
            ? "partial"
            : "fail",
        evidence: ctx.dateSignals.evidence,
      };
    },
  },
  {
    id: "B13",
    categoryId: "B",
    label: "Readability is in a useful AI citation range.",
    recommendation:
      "Aim for clear expert prose: specific enough to be trusted, but not dense academic copy.",
    dependencies: ["readability"],
    evaluate: (ctx) => {
      const g = ctx.grade;
      const status: AuditStatus =
        g === null
          ? "partial"
          : g >= 10 && g <= 16
            ? "pass"
            : g >= 7 && g <= 20
              ? "partial"
              : "fail";
      return {
        status,
        evidence:
          g === null
            ? "Readability could not be estimated from the extracted text."
            : `Estimated Flesch-Kincaid grade level is ${g.toFixed(1)}.`,
      };
    },
  },
  {
    id: "B14",
    categoryId: "B",
    label: "Lists or tables make comparisons machine-extractable.",
    recommendation:
      "Use bullets, numbered lists, and tables for steps, comparisons, pros/cons, and factual summaries.",
    dependencies: ["markdown", "html"],
    evaluate: (ctx) => {
      const lists =
        countMatches(ctx.markdown, /^[-*]\s+/gm) +
        countMatches(ctx.html, /<li\b/gi);
      const tables =
        countMatches(ctx.markdown, /^\|.+\|$/gm) +
        countMatches(ctx.html, /<table\b/gi);
      const status: AuditStatus =
        tables >= 1 || lists >= 6 ? "pass" : lists >= 2 ? "partial" : "fail";
      return {
        status,
        evidence: `${lists} list item(s) and ${tables} table signal(s) detected.`,
      };
    },
  },

  // ----- C. Structured Data / Schema --------------------------------------
  {
    id: "C1",
    categoryId: "C",
    label: "JSON-LD structured data is present.",
    recommendation:
      "Add server-rendered JSON-LD. Start with WebPage, Organization, Article, Person, and FAQPage as applicable.",
    dependencies: ["json-ld"],
    evaluate: (ctx) => {
      const failureNote =
        ctx.jsonLdParseFailures > 0
          ? ` ${ctx.jsonLdParseFailures} block(s) were present but failed to parse; check for malformed JSON.`
          : "";
      return {
        status: ctx.jsonLd.length > 0 ? "pass" : "fail",
        evidence: `${ctx.jsonLd.length} JSON-LD entity(ies) parsed from ${ctx.jsonLdBlockCount} script block(s).${failureNote}`,
      };
    },
  },
  {
    id: "C2",
    categoryId: "C",
    label: "Organization schema includes name, URL, logo, and sameAs.",
    recommendation:
      "Add Organization schema with name, url, logo, and sameAs links to authoritative profiles.",
    dependencies: ["schema-summary"],
    evaluate: (ctx) => ({
      status: ctx.schema.organizationComplete
        ? "pass"
        : ctx.schema.hasOrganization
          ? "partial"
          : "fail",
      evidence: ctx.schema.organizationEvidence,
    }),
  },
  {
    id: "C3",
    categoryId: "C",
    label: "Article or BlogPosting schema includes authorship and dates.",
    recommendation:
      "For editorial pages, include Article or BlogPosting schema with headline, author, datePublished, and dateModified.",
    dependencies: ["schema-summary", "text", "url"],
    evaluate: (ctx) => {
      const status: AuditStatus = ctx.schema.articleComplete
        ? "pass"
        : ctx.schema.hasArticle
          ? "partial"
          : isArticleLike(ctx)
            ? "fail"
            : "na";
      return { status, evidence: ctx.schema.articleEvidence };
    },
  },
  {
    id: "C4",
    categoryId: "C",
    label: "Person schema supports visible authors.",
    recommendation:
      "Add Person schema for each author, including jobTitle, worksFor, credentials, and sameAs profiles.",
    dependencies: ["schema-summary", "text", "url"],
    evaluate: (ctx) => {
      if (!isArticleLike(ctx)) {
        return {
          status: "na",
          evidence:
            "This page does not look like an article or blog post, so Person schema is not required.",
        };
      }
      return {
        status: ctx.schema.hasPerson
          ? "pass"
          : ctx.hasByline
            ? "partial"
            : "fail",
        evidence: ctx.schema.hasPerson
          ? "Person schema was found."
          : ctx.hasByline
            ? "A byline was detected, but no Person schema was found."
            : "No Person schema or byline signal was found.",
      };
    },
  },
  {
    id: "C5",
    categoryId: "C",
    label: "FAQPage schema exists when Q&A content exists.",
    recommendation:
      "When FAQ content is visible, mirror the questions and answers in FAQPage JSON-LD.",
    dependencies: ["schema-summary", "text", "headings"],
    evaluate: (ctx) => ({
      status:
        ctx.faqStatus === "fail" ? "na" : ctx.schema.hasFaq ? "pass" : "fail",
      evidence: ctx.schema.hasFaq
        ? "FAQPage schema was found."
        : "FAQ-like content was found without FAQPage schema.",
    }),
  },
  {
    id: "C11",
    categoryId: "C",
    label: "Schema appears in the initial HTML response.",
    recommendation:
      "Do not rely on client-side JavaScript to inject important schema.",
    dependencies: ["json-ld"],
    evaluate: (ctx) => ({
      status: ctx.jsonLd.length > 0 ? "pass" : "fail",
      evidence:
        ctx.jsonLd.length > 0
          ? "JSON-LD was present in the raw HTML response."
          : "No JSON-LD was present in the raw HTML response.",
    }),
  },

  // ----- D. E-E-A-T & Entity Authority ------------------------------------
  {
    id: "D5",
    categoryId: "D",
    label: "About, company, trust, or newsroom pages are linked.",
    recommendation:
      "Make About, Company, Trust, or Newsroom pages easy to reach from the audited page.",
    dependencies: ["links"],
    evaluate: (ctx) => {
      const pattern = /(about|company|trust|newsroom|press)/i;
      return {
        status: linkPathStatus(ctx.links, pattern),
        evidence: `${ctx.links.filter((l) => pattern.test(l)).length} about/trust/newsroom-style link(s) detected.`,
      };
    },
  },
  {
    id: "D6",
    categoryId: "D",
    label: "Privacy, terms, and contact information are linked.",
    recommendation:
      "Expose privacy policy, terms, contact, and support paths in the page chrome or footer.",
    dependencies: ["links"],
    evaluate: (ctx) => {
      const privacy = linkPathStatus(ctx.links, /(privacy)/i);
      const terms = linkPathStatus(ctx.links, /(terms|legal)/i);
      const contact = linkPathStatus(ctx.links, /(contact|support)/i);
      const combined = linkPathStatus(
        ctx.links,
        /(privacy|terms|legal|contact|support)/i,
      );
      const status: AuditStatus =
        privacy === "pass" && terms !== "fail" && contact !== "fail"
          ? "pass"
          : combined;
      return {
        status,
        evidence: `${ctx.links.filter((l) => /(privacy|terms|legal|contact|support)/i.test(l)).length} privacy/terms/contact-style link(s) detected.`,
      };
    },
  },
  {
    id: "D10",
    categoryId: "D",
    label: "Original research or proprietary data signals exist.",
    recommendation:
      "Publish original data, methodology, benchmarks, or named research that other sites can cite.",
    dependencies: ["text", "data-points"],
    multiplier: 1 / 3,
    evaluate: (ctx) => {
      const found =
        /\b(original research|study|survey|benchmark|dataset|methodology|proprietary data|we analyzed|we measured)\b/i.test(
          ctx.analysisText,
        );
      const status: AuditStatus = found
        ? "pass"
        : ctx.dataPoints >= 3
          ? "partial"
          : "fail";
      return {
        status,
        evidence: found
          ? "Research or methodology language was detected."
          : `${ctx.dataPoints} data point(s) were detected without strong original-research language.`,
      };
    },
  },
  {
    id: "D12",
    categoryId: "D",
    label: "Brand/entity descriptors are consistent.",
    recommendation:
      "Use the same brand name, category, and entity descriptors in title, meta description, headings, schema, and body copy.",
    dependencies: ["title", "description", "text"],
    evaluate: (ctx) => {
      const brand = ctx.host.split(".")[0];
      const titleHasBrand =
        !!ctx.title && new RegExp(escapeRegExp(brand), "i").test(ctx.title);
      const descHasBrand =
        !!ctx.description &&
        new RegExp(escapeRegExp(brand), "i").test(ctx.description);
      const bodyMentions = countMatches(
        ctx.analysisText,
        new RegExp(`\\b${escapeRegExp(brand)}\\b`, "gi"),
      );
      const status: AuditStatus =
        titleHasBrand && descHasBrand && bodyMentions >= 2
          ? "pass"
          : titleHasBrand || descHasBrand || bodyMentions >= 1
            ? "partial"
            : "fail";
      return {
        status,
        evidence: `Brand token "${brand}" appears in title: ${ctx.title ? "yes" : "no"}, meta description: ${ctx.description ? "yes" : "no"}, body mentions: ${bodyMentions}.`,
      };
    },
  },

  // ----- E. Off-site / Citation Surface Presence --------------------------
  {
    id: "E1",
    categoryId: "E",
    label: "Review or marketplace citation surfaces are linked.",
    recommendation:
      "Link to maintained profiles on review or marketplace sites (G2, Capterra, Trustpilot, Gartner, ProductHunt) that match your category.",
    dependencies: ["links", "text", "json-ld"],
    multiplier: 0.5,
    evaluate: (ctx) => {
      const pattern =
        /(g2\.com|capterra\.com|trustpilot\.com|gartner\.com|producthunt\.com)/i;
      const count = ctx.externalLinks.filter((l) => pattern.test(l)).length;
      if (count > 0) {
        return {
          status: "pass",
          evidence: `${count} review/marketplace link(s) detected.`,
        };
      }
      if (!isCommercialOfferingLike(ctx)) {
        return {
          status: "na",
          evidence:
            "This page does not look like a commercial product or SaaS offering, so review/marketplace profiles are not expected.",
        };
      }
      return {
        status: "fail",
        evidence:
          "Page reads as a commercial product/SaaS offering, but no review or marketplace profile link was detected.",
      };
    },
  },
  {
    id: "E7",
    categoryId: "E",
    label: "GitHub or developer surface is linked when relevant.",
    recommendation:
      "For technical products, link active GitHub repositories, examples, or developer docs.",
    dependencies: ["links", "text", "json-ld", "url"],
    evaluate: (ctx) => {
      const found = /github\.com/i.test(ctx.externalLinks.join(" "));
      if (found) {
        return { status: "pass", evidence: "A GitHub link was detected." };
      }
      if (!isTechnicalProductLike(ctx)) {
        return {
          status: "na",
          evidence:
            "This page does not look like a technical or developer product, so a GitHub surface is not expected.",
        };
      }
      return {
        status: "fail",
        evidence:
          "Page reads as a developer/technical product, but no GitHub link was detected.",
      };
    },
  },
  {
    id: "E10",
    categoryId: "E",
    label: "Entity disambiguation is supported by sameAs links.",
    recommendation:
      "Use sameAs links to Wikidata, LinkedIn, Crunchbase, Wikipedia, GitHub, or other authoritative profiles on Organization or Person schema.",
    dependencies: ["schema-summary"],
    evaluate: (ctx) => {
      if (!hasDisambiguableEntity(ctx)) {
        return {
          status: "na",
          evidence:
            "No Organization, Person, or Article entity was found on this page to attach sameAs links to.",
        };
      }
      return {
        status:
          ctx.schema.sameAsCount >= 3
            ? "pass"
            : ctx.schema.sameAsCount >= 1
              ? "partial"
              : "fail",
        evidence: `${ctx.schema.sameAsCount} sameAs link(s) were found in JSON-LD.`,
      };
    },
  },
  {
    id: "E12",
    categoryId: "E",
    label: "Outbound citations place the entity near named category sources.",
    recommendation:
      "Cite and co-occur with authoritative category sources, benchmarks, standards, and named experts.",
    dependencies: ["links", "data-points"],
    evaluate: (ctx) => ({
      status:
        ctx.externalLinks.length >= 5 && ctx.dataPoints >= 3
          ? "pass"
          : ctx.externalLinks.length >= 2
            ? "partial"
            : "fail",
      evidence: `${ctx.externalLinks.length} external link(s) and ${ctx.dataPoints} data point(s) were detected.`,
    }),
  },

  // ----- F. Measurement & Governance --------------------------------------
  {
    id: "F6",
    categoryId: "F",
    label: "A content refresh signal is visible.",
    recommendation:
      "Publish visible updated dates and refresh important pages quarterly.",
    dependencies: ["date-signals", "url", "text"],
    evaluate: (ctx) => {
      if (!isArticleLike(ctx)) {
        return {
          status: "na",
          evidence:
            "This page does not look like an article or blog post, so a refresh-date signal is not required.",
        };
      }
      return {
        status: ctx.dateSignals.hasModifiedDate
          ? "pass"
          : ctx.dateSignals.hasAnyDate
            ? "partial"
            : "fail",
        evidence: ctx.dateSignals.evidence,
      };
    },
  },

  // ----- G. Classic SEO ---------------------------------------------------
  {
    id: "G1",
    categoryId: "G",
    label: "Title tag is 30–60 characters.",
    recommendation:
      "Write a unique 30–60 character title that leads with the topic and includes the brand.",
    dependencies: ["title"],
    evaluate: (ctx) => {
      const length = ctx.title?.length ?? 0;
      return {
        status: rangeStatus(length, [30, 60], [10, 70]),
        evidence: ctx.title
          ? `Title is ${length} characters: "${clip(ctx.title, 90)}".`
          : "No <title> tag was found.",
      };
    },
  },
  {
    id: "G2",
    categoryId: "G",
    label: "Meta description is 70–160 characters.",
    recommendation:
      "Write a 70–160 character meta description that answers what the page offers.",
    dependencies: ["description"],
    evaluate: (ctx) => {
      const length = ctx.description?.length ?? 0;
      return {
        status: rangeStatus(length, [70, 160], [1, 200]),
        evidence: ctx.description
          ? `Meta description is ${length} characters.`
          : "No meta description was found.",
      };
    },
  },
  {
    id: "G3",
    categoryId: "G",
    label: "Images have alt text.",
    recommendation:
      'Add descriptive alt text to meaningful images, and alt="" to decorative ones.',
    dependencies: ["images"],
    evaluate: (ctx) => {
      const { total, withAlt } = ctx.images;
      if (total === 0) {
        return { status: "na", evidence: "No <img> tags were found." };
      }
      const ratio = withAlt / total;
      return {
        status: ratio >= 0.9 ? "pass" : ratio >= 0.5 ? "partial" : "fail",
        evidence: `${withAlt} of ${total} image(s) have an alt attribute.`,
      };
    },
  },
  {
    id: "G4",
    categoryId: "G",
    label: "Open Graph and Twitter card tags are present.",
    recommendation:
      "Add og:title, og:description, og:image, and twitter:card so shared links render rich previews.",
    dependencies: ["meta"],
    evaluate: (ctx) => {
      const og = ctx.openGraph;
      const present = [og.title, og.description, og.image].filter(Boolean).length;
      const status: AuditStatus =
        present === 3 ? "pass" : present > 0 || ctx.twitterCard ? "partial" : "fail";
      return {
        status,
        evidence: `og:title ${yesNo(og.title)}, og:description ${yesNo(og.description)}, og:image ${yesNo(og.image)}, twitter:card ${yesNo(ctx.twitterCard)}.`,
      };
    },
  },
  {
    id: "G5",
    categoryId: "G",
    label: "Mobile viewport is configured.",
    recommendation:
      'Add <meta name="viewport" content="width=device-width, initial-scale=1">.',
    dependencies: ["meta"],
    evaluate: (ctx) => ({
      status: !ctx.viewport
        ? "fail"
        : /width\s*=\s*device-width/i.test(ctx.viewport)
          ? "pass"
          : "partial",
      evidence: ctx.viewport
        ? `Viewport: "${ctx.viewport}".`
        : "No viewport meta tag was found.",
    }),
  },
  {
    id: "G6",
    categoryId: "G",
    label: "Page language is declared.",
    recommendation: 'Set the page language, e.g. <html lang="en">.',
    dependencies: ["html"],
    evaluate: (ctx) => ({
      status: ctx.htmlLang ? "pass" : "fail",
      evidence: ctx.htmlLang
        ? `<html lang="${ctx.htmlLang}">.`
        : "The <html> tag has no lang attribute.",
    }),
  },
  {
    id: "G7",
    categoryId: "G",
    label: "An XML sitemap is discoverable.",
    recommendation:
      "Publish /sitemap.xml and declare it in robots.txt with a Sitemap: line.",
    dependencies: ["sitemap", "robots-txt"],
    evaluate: (ctx) => ({
      status: ctx.sitemap.found
        ? "pass"
        : ctx.sitemap.declared
          ? "partial"
          : "fail",
      evidence: ctx.sitemap.found
        ? `Sitemap found at ${ctx.sitemap.url}.`
        : ctx.sitemap.declared
          ? `robots.txt declares ${ctx.sitemap.url}, but it could not be fetched as XML.`
          : "No sitemap was declared in robots.txt or found at /sitemap.xml.",
    }),
  },

  // ----- H. Performance (PageSpeed Insights, mobile) ----------------------
  {
    id: "H1",
    categoryId: "H",
    label: "Lighthouse mobile performance score is 90+.",
    recommendation:
      "Open the PageSpeed Insights report and fix its top opportunities: image sizes, render-blocking scripts, and unused JavaScript.",
    dependencies: ["pagespeed"],
    multiplier: 2,
    evaluate: (ctx) =>
      metricRule(ctx, "the performance score", ctx.pageSpeed?.performanceScore ?? null, (score) => ({
        status: score >= 90 ? "pass" : score >= 50 ? "partial" : "fail",
        evidence: `Mobile performance score is ${score}/100.`,
      })),
  },
  {
    id: "H2",
    categoryId: "H",
    label: "Largest Contentful Paint is under 2.5s.",
    recommendation:
      "Serve the hero image or headline fast: preload it, compress it, and avoid client-side rendering for above-the-fold content.",
    dependencies: ["pagespeed"],
    evaluate: (ctx) =>
      metricRule(ctx, "Largest Contentful Paint", ctx.pageSpeed?.lcpMs ?? null, (ms) => ({
        status: lowerIsBetter(ms, 2500, 4000),
        evidence: `Largest Contentful Paint is ${(ms / 1000).toFixed(2)}s.`,
      })),
  },
  {
    id: "H3",
    categoryId: "H",
    label: "Cumulative Layout Shift is under 0.1.",
    recommendation:
      "Reserve space for images, ads, and embeds with explicit width/height so content does not jump.",
    dependencies: ["pagespeed"],
    evaluate: (ctx) =>
      metricRule(ctx, "Cumulative Layout Shift", ctx.pageSpeed?.cls ?? null, (cls) => ({
        status: lowerIsBetter(cls, 0.1, 0.25),
        evidence: `Cumulative Layout Shift is ${cls.toFixed(3)}.`,
      })),
  },
  {
    id: "H4",
    categoryId: "H",
    label: "Total Blocking Time is under 200ms.",
    recommendation:
      "Cut main-thread JavaScript: defer third-party scripts, split bundles, and remove unused code.",
    dependencies: ["pagespeed"],
    evaluate: (ctx) =>
      metricRule(ctx, "Total Blocking Time", ctx.pageSpeed?.tbtMs ?? null, (ms) => ({
        status: lowerIsBetter(ms, 200, 600),
        evidence: `Total Blocking Time is ${Math.round(ms)}ms.`,
      })),
  },
];

// ---------------------------------------------------------------------------
// Helpers used by rule evaluators. Kept here so rules.ts is self-contained.
// ---------------------------------------------------------------------------

export function countWords(text: string): number {
  // Intl.Segmenter provides CJK-aware word segmentation.
  // Falls back to Latin regex when unavailable (Node < 16, some edge runtimes).
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    try {
      const segmenter = new Intl.Segmenter(undefined, { granularity: "word" });
      let count = 0;
      for (const segment of segmenter.segment(text)) {
        if (segment.isWordLike) count++;
      }
      return count;
    } catch {
      // Fall through to regex fallback.
    }
  }

  // Fallback: Latin-script words + CJK characters (rough approximation).
  const latin =
    text.match(/[A-Za-z0-9À-ɏ][A-Za-z0-9À-ɏ'-]*/g) ?? [];
  const cjk = text.match(
    /[一-鿿㐀-䶿豈-﫿぀-ゟ゠-ヿ가-힯]/g,
  );
  return latin.length + (cjk?.length ?? 0);
}

export function countMatches(text: string, pattern: RegExp): number {
  return text.match(pattern)?.length ?? 0;
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function clip(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}...`;
}

function yesNo(value: boolean): string {
  return value ? "yes" : "no";
}

/** pass inside `good`, partial inside `ok`, fail otherwise (inclusive). */
function rangeStatus(
  value: number,
  good: [number, number],
  ok: [number, number],
): AuditStatus {
  if (value >= good[0] && value <= good[1]) return "pass";
  if (value >= ok[0] && value <= ok[1]) return "partial";
  return "fail";
}

function lowerIsBetter(value: number, good: number, ok: number): AuditStatus {
  return value <= good ? "pass" : value <= ok ? "partial" : "fail";
}

function metricRule(
  ctx: RuleContext,
  metric: string,
  value: number | null,
  grade: (value: number) => RuleEvaluation,
): RuleEvaluation {
  if (value !== null) return grade(value);
  return {
    status: "na",
    evidence: ctx.pageSpeed
      ? `PageSpeed Insights did not report ${metric} for this page.`
      : "PageSpeed Insights was unavailable for this audit. Re-run the audit or open the report link in diagnostics.",
  };
}

function firstUsefulParagraph(paragraphs: string[]): string {
  return paragraphs.find((p) => countWords(p) >= 12) ?? "";
}

/**
 * Heuristic for "this is a blog post / article / editorial page."
 * Used by date-freshness rules (B12, F6) and article-schema rule (C3).
 *
 * Intentionally strict: long marketing pages should NOT match. We require
 * either an editorial URL pattern or actual Article/BlogPosting JSON-LD.
 */
function isArticleLike(ctx: RuleContext): boolean {
  return (
    /\/(blog|article|articles|guide|guides|news|post|posts|insight|insights|research)\//i.test(
      ctx.url.pathname,
    ) || ctx.schema.hasArticle
  );
}

/**
 * Does the page read as a commercial product/SaaS offering? Used to gate rules
 * that only matter when there's something to sell or get reviewed.
 */
function isCommercialOfferingLike(ctx: RuleContext): boolean {
  if (isArticleLike(ctx)) return false;
  if (
    hasJsonLdType(ctx, [
      "Product",
      "SoftwareApplication",
      "WebApplication",
      "MobileApplication",
      "Service",
      "Offer",
    ])
  ) {
    return true;
  }
  return /\b(pricing|free trial|start free|sign up|signup|sign-up|get started|request a demo|schedule a demo|book a demo|buy now|add to cart|subscribe|per (?:month|user|seat)|saas|platform|software)\b/i.test(
    ctx.analysisText,
  );
}

/**
 * Does the page read as a technical/developer product (API, SDK, library,
 * docs)? Used to gate GitHub-presence and similar developer-surface rules.
 */
function isTechnicalProductLike(ctx: RuleContext): boolean {
  if (
    hasJsonLdType(ctx, [
      "SoftwareApplication",
      "SoftwareSourceCode",
      "APIReference",
    ])
  ) {
    return true;
  }
  if (/\/(docs?|api|sdk|reference|developers?)(\/|$)/i.test(ctx.url.pathname)) {
    return true;
  }
  return /\b(api|sdk|cli|library|framework|open[- ]source|developer (?:portal|docs|guide)|npm install|pip install|brew install|github\.com\/[^\s]+)\b/i.test(
    ctx.analysisText,
  );
}

/** Does the page expose an Organization or Person entity worth disambiguating? */
function hasDisambiguableEntity(ctx: RuleContext): boolean {
  return (
    ctx.schema.hasOrganization || ctx.schema.hasPerson || ctx.schema.hasArticle
  );
}

function hasJsonLdType(ctx: RuleContext, types: string[]): boolean {
  return ctx.jsonLd.some((obj) => {
    const raw = obj["@type"];
    const actual = Array.isArray(raw) ? raw : [raw];
    return actual.some(
      (type) => typeof type === "string" && types.includes(type),
    );
  });
}

function linkPathStatus(links: string[], pattern: RegExp): AuditStatus {
  const count = links.filter((l) => pattern.test(l)).length;
  if (count >= 2) return "pass";
  if (count === 1) return "partial";
  return "fail";
}

// ---------------------------------------------------------------------------
// Convenience indexes for consumers that look rules up by id.
// ---------------------------------------------------------------------------

export const RULES_BY_ID: Record<string, Rule> = Object.fromEntries(
  RULES.map((rule) => [rule.id, rule]),
);

export const CATEGORIES_BY_ID: Record<string, CategoryDef> = Object.fromEntries(
  CATEGORIES.map((c) => [c.id, c]),
);
