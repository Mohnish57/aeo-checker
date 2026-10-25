import type { PageSpeedResult } from "@/lib/pagespeed";
import type { PlatformId } from "@/lib/platform";

export type AuditStatus = "pass" | "partial" | "fail" | "na";

export type AuditItem = {
  id: string;
  label: string;
  status: AuditStatus;
  evidence: string;
  recommendation: string;
  score: number;
  maxScore: number;
};

export type AuditCategory = {
  id: string;
  name: string;
  description: string;
  score: number;
  maxScore: number;
  /** Number of rules excluded because they did not apply to this page. */
  naExcluded: number;
  items: AuditItem[];
};

export type AuditBand = {
  label: "Critical" | "Below average" | "Average" | "Strong" | "Excellent";
  interpretation: string;
};

export type AgentFixPrompts = {
  full: string;
  topIssues: Array<{
    id: string;
    label: string;
    prompt: string;
  }>;
};

export type AuditResult = {
  url: string;
  host: string;
  /** Site builder detected from the page HTML. */
  platform: PlatformId;
  /** Start of the page's main content, so fix prompts can write real copy. */
  pageExcerpt: string;
  title: string | null;
  description: string | null;
  fetchedAt: string;
  score: number;
  band: AuditBand;
  topPriorities: string[];
  agentPrompts: AgentFixPrompts;
  stats: {
    markdownChars: number;
    rawHtmlChars: number;
    words: number;
    headings: number;
    links: number;
    externalLinks: number;
    jsonLdBlocks: number;
  };
  categories: AuditCategory[];
  /** Mobile Lighthouse metrics; null when PageSpeed Insights was unavailable. */
  pageSpeed: PageSpeedResult | null;
  diagnostics: {
    httpStatus: number;
    redirects: number;
    markdownExtract: "ready" | "empty";
    /** "error": robots.txt returned 5xx/429, which crawlers read as disallow-all. */
    robotsTxt: "found" | "missing" | "error";
    llmsTxt: "found" | "missing";
    sitemap: "found" | "missing";
    pageSpeed: "ready" | "unavailable";
    pageSpeedReportUrl: string;
    jsonLdParseFailures: number;
  };
};

export type AuditApiResponse =
  | { status: "ready"; audit: AuditResult }
  | { status: "error"; message: string };
