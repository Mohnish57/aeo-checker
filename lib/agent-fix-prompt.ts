/**
 * Fix prompts, written for how the founder edits their site:
 *   no-code     → pasted into ChatGPT/Claude, which walks them through their builder
 *   ai-builder  → pasted into Lovable/Bolt/v0/Replit, which makes the change
 *   developer   → a brief for a developer or coding agent
 * Pure and client-safe so the results page can rebuild prompts when the
 * founder corrects the detected platform.
 */
import type { AgentFixPrompts, AuditItem, AuditResult } from "@/lib/audit-types";
import { guideFor } from "@/lib/fix-guide";
import { PLATFORMS, type Platform, type PlatformId } from "@/lib/platform";
import { isActionable, projectedScore, rankFixes } from "@/lib/projection";

type PromptAudit = Omit<AuditResult, "agentPrompts">;

type PromptIssue = AuditItem & { categoryName: string };

const NO_FABRICATION =
  "Don't invent facts, numbers, reviews, quotes, authors or dates. If a fix needs information only I have, ask me for it.";

export function buildFixPrompts(
  audit: PromptAudit,
  platformId: PlatformId,
): AgentFixPrompts {
  const platform = PLATFORMS[platformId];
  const actionable = actionableIssues(audit);
  return {
    full: buildPrompt(audit, platform, actionable),
    topIssues: actionable.map((issue) => ({
      id: issue.id,
      label: guideFor(issue.id).problem,
      prompt: buildPrompt(audit, platform, [issue]),
    })),
  };
}

/** One prompt covering just the given issues, e.g. the top fixes. */
export function buildPromptForIssues(
  audit: PromptAudit,
  platformId: PlatformId,
  ids: string[],
): string {
  const wanted = new Set(ids);
  return buildPrompt(
    audit,
    PLATFORMS[platformId],
    actionableIssues(audit).filter((issue) => wanted.has(issue.id)),
  );
}

/** Site fixes in priority order, then work that needs more than a site edit. */
function actionableIssues(audit: PromptAudit): PromptIssue[] {
  const ranked = new Map(
    rankFixes(audit.categories).map((item, index) => [item.id, index]),
  );
  return audit.categories
    .flatMap((category) =>
      category.items.map((item) => ({ ...item, categoryName: category.name })),
    )
    .filter(isActionable)
    .sort(
      (a, b) =>
        (ranked.get(a.id) ?? Infinity) - (ranked.get(b.id) ?? Infinity) ||
        b.maxScore - a.maxScore ||
        a.id.localeCompare(b.id),
    );
}

function buildPrompt(
  audit: PromptAudit,
  platform: Platform,
  issues: PromptIssue[],
): string {
  switch (platform.style) {
    case "no-code":
      return noCodePrompt(audit, platform, issues);
    case "ai-builder":
      return aiBuilderPrompt(audit, platform, issues);
    case "developer":
      return developerPrompt(audit, issues);
  }
}

function noCodePrompt(
  audit: PromptAudit,
  platform: Platform,
  issues: PromptIssue[],
): string {
  const single = issues.length === 1;
  return `I run my website on ${platform.name}. I'm not a developer, so please guide me step by step.

My page: ${audit.url}
Page title: ${audit.title ?? "(none)"}
Meta description: ${audit.description ?? "(none)"}

An AI-visibility audit scored this page ${formatScore(audit.score)}/100${scoreTarget(audit)}. ${single ? "This fix helps" : "These fixes help"} ChatGPT, Claude, Perplexity and Google's AI answers find, understand and cite the page.

Where things live in ${platform.name}: ${platform.whereThingsLive}

For ${single ? "the issue" : "each issue, in order"}:
1. Explain the problem in one plain sentence.
2. Give me click-by-click steps in ${platform.name}.
3. Write the exact text or code I should paste, ready to copy. Base any copy on my page content below.
4. Tell me how to check it worked.
If ${platform.name} can't do something, say so and give me the simplest workaround. ${NO_FABRICATION}

${single ? "Issue" : "Issues"} to fix:
${issues.map(formatPlainIssue).join("\n\n")}
${excerptBlock(audit)}`;
}

function aiBuilderPrompt(
  audit: PromptAudit,
  platform: Platform,
  issues: PromptIssue[],
): string {
  return `Make these changes to my ${platform.name} site so AI answer engines (ChatGPT, Claude, Perplexity, Google AI) can read, trust and cite it.

Page: ${audit.url}
Current AI-visibility score: ${formatScore(audit.score)}/100${scoreTarget(audit)}

Rules:
- Keep my design, layout and brand voice.
- Page text, headings, metadata and JSON-LD must be in the HTML the server sends, not added only by JavaScript. If the app renders on the client, prerender or statically generate this page.
- ${NO_FABRICATION}

Changes:
${issues.map(formatPlainIssue).join("\n\n")}

When you're done, list what you changed.`;
}

function developerPrompt(audit: PromptAudit, issues: PromptIssue[]): string {
  return `You are an AI SEO implementation agent. Improve the audited page so it is easier for AI answer engines to crawl, parse, trust, and cite.

Target URL: ${audit.url}
Current score: ${formatScore(audit.score)}/100 (${audit.band.label})${scoreTarget(audit)}

Rules:
- Fix the issues below in priority order.
- Preserve the page's existing product intent and brand voice.
- Do not fabricate off-site authority, reviews, authorship, credentials, dates, or analytics evidence.
- Prefer server-rendered HTML for critical copy, headings, FAQs, schema, and metadata.
- After changes, run the project's lint, typecheck, and build commands if available.

Issues to fix:
${issues.map(formatDeveloperIssue).join("\n\n")}

Expected output from you:
1. A concise summary of what changed.
2. The files changed.
3. The verification commands run and their results.`;
}

function formatPlainIssue(issue: PromptIssue, index: number): string {
  const guide = guideFor(issue.id);
  return `${index + 1}. ${guide.problem}
   Why it matters: ${guide.why}
   What the audit found: ${issue.evidence}
   What good looks like: ${issue.recommendation}`;
}

function formatDeveloperIssue(issue: PromptIssue): string {
  return `- ${issue.id} ${issue.label}
  Category: ${issue.categoryName}
  Status: ${issue.status}
  Score impact: ${issue.maxScore.toFixed(1)} possible points
  Evidence: ${issue.evidence}
  Required fix: ${issue.recommendation}`;
}

function scoreTarget(audit: PromptAudit): string {
  const target = projectedScore(audit.categories);
  return target > audit.score ? `; fixing every site issue takes it to about ${formatScore(target)}` : "";
}

function excerptBlock(audit: PromptAudit): string {
  return audit.pageExcerpt
    ? `
My page content (start of page):
"""
${audit.pageExcerpt}
"""`
    : "";
}

function formatScore(score: number): string {
  return String(Math.round(score));
}
