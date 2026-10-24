"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  Copy,
  ExternalLink,
  MinusCircle,
  RotateCw,
  XCircle,
} from "lucide-react";

import { buildFixPrompts, buildPromptForIssues } from "@/lib/agent-fix-prompt";
import type {
  AuditCategory,
  AuditItem,
  AuditResult,
} from "@/lib/audit-types";
import { EFFORT_LABEL, guideFor } from "@/lib/fix-guide";
import { PLATFORMS, isPlatformId, type PlatformId } from "@/lib/platform";
import {
  BLOCKED_SCORE_CAP,
  gainOf,
  isActionable,
  isBlocker,
  projectedScore,
  rankFixes,
} from "@/lib/projection";

import { SiteHeader } from "@/components/site-header";

type AuditResultsViewProps = { audit: AuditResult };

type Issue = AuditItem & { categoryName: string };

const TOP_FIXES = 3;
const FIX_FIRST = 5;

const BAND_SUMMARY: Record<AuditResult["band"]["label"], string> = {
  Critical: "AI assistants will struggle to find, read or trust this page.",
  "Below average":
    "AI assistants can read this page, but rarely pick it as a source.",
  Average:
    "AI assistants can use this page, but clearer competitors will be cited first.",
  Strong: "This page is in good shape to be cited by AI assistants.",
  Excellent: "This page is set up very well for AI assistants.",
};

const BAND_TONE: Record<AuditResult["band"]["label"], string> = {
  Critical: "bg-red-soft text-red",
  "Below average": "bg-amber-soft text-amber",
  Average: "bg-amber-soft text-amber",
  Strong: "bg-green-soft text-green",
  Excellent: "bg-green-soft text-green",
};

export function AuditResultsView({ audit }: AuditResultsViewProps) {
  const [platformId, setPlatformId] = useState<PlatformId>(audit.platform);
  const [copiedKey, setCopiedKey] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const platform = PLATFORMS[platformId];

  const view = useMemo(() => {
    const issues: Issue[] = audit.categories.flatMap((category) =>
      category.items.map((item) => ({ ...item, categoryName: category.name })),
    );
    const byId = new Map(issues.map((issue) => [issue.id, issue]));
    const ranked = rankFixes(audit.categories).map((item) => byId.get(item.id)!);
    const top = ranked.slice(0, TOP_FIXES);
    return {
      ranked,
      top,
      after: projectedScore(audit.categories),
      topGain: round1(
        projectedScore(audit.categories, new Set(top.map((i) => i.id))) - audit.score,
      ),
      offSite: issues.filter((i) => isActionable(i) && !guideFor(i.id).siteFix),
      good: issues.filter((i) => i.status === "pass"),
      blocked: issues.some(isBlocker),
    };
  }, [audit]);

  const prompts = useMemo(() => {
    const all = buildFixPrompts(audit, platformId);
    return {
      full: all.full,
      byId: new Map(all.topIssues.map((issue) => [issue.id, issue.prompt])),
      top: buildPromptForIssues(
        audit,
        platformId,
        view.top.map((issue) => issue.id),
      ),
    };
  }, [audit, platformId, view.top]);

  async function copy(key: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      window.setTimeout(
        () => setCopiedKey((current) => (current === key ? "" : current)),
        1800,
      );
    } catch {
      /* ignore clipboard errors */
    }
  }

  const score = Math.round(audit.score);
  const after = Math.round(view.after);
  const issueCount = view.ranked.length + view.offSite.length;

  return (
    <>
      <SiteHeader>
        <time dateTime={audit.fetchedAt} className="hidden sm:inline">
          {formatTimestamp(Date.parse(audit.fetchedAt))}
        </time>
        <button
          type="button"
          disabled={refreshing}
          onClick={() => {
            setRefreshing(true);
            window.location.reload();
          }}
          aria-label="Re-check this page"
          className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-sm font-medium text-muted transition hover:bg-soft hover:text-ink disabled:opacity-60"
        >
          <RotateCw className={`size-3.5 ${refreshing ? "animate-spin" : ""}`} />
          <span className="hidden sm:inline">
            {refreshing ? "Re-checking…" : "Re-check"}
          </span>
        </button>
        <Link
          href="/"
          className="whitespace-nowrap rounded-lg bg-blue px-3 py-1.5 text-sm font-medium text-white transition hover:bg-blue-hover"
        >
          New check
        </Link>
      </SiteHeader>

      <main className="bg-canvas pb-24">
        <div className="mx-auto w-full max-w-5xl px-4 sm:px-6">
          {/* Page + platform */}
          <section className="flex flex-col gap-4 pt-8 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0">
              <a
                href={audit.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-sm text-subtle transition hover:text-blue"
              >
                {audit.host}
                <ExternalLink className="size-3.5" />
              </a>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight text-balance text-ink sm:text-3xl">
                {audit.title ?? audit.host}
              </h1>
            </div>
            <PlatformPicker
              value={platformId}
              detected={audit.platform}
              onChange={setPlatformId}
            />
          </section>

          {/* Score + top fixes */}
          <section className="mt-6 grid gap-4 lg:grid-cols-2">
            <div className="card p-6">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-medium text-muted">
                  AI visibility score
                </h2>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${BAND_TONE[audit.band.label]}`}
                >
                  {audit.band.label}
                </span>
              </div>
              <div className="mt-4 flex items-end gap-3 sm:gap-5">
                <ScoreFigure value={score} caption="Now" />
                {after > score ? (
                  <>
                    <ArrowRight className="mb-8 size-5 shrink-0 text-subtle sm:size-6" aria-hidden />
                    <ScoreFigure value={after} caption="After fixes" accent />
                  </>
                ) : null}
              </div>
              <ScoreBar now={audit.score} after={view.after} />
              <p className="mt-5 text-[15px]/6 text-pretty text-ink">
                {view.blocked
                  ? `Something is stopping AI assistants from using this page, so the score is capped at ${BLOCKED_SCORE_CAP}. Fixing the first issue below removes the cap.`
                  : BAND_SUMMARY[audit.band.label]}
              </p>
              <p className="mt-2 text-sm text-subtle">
                {issueCount} to fix · {view.good.length} already good
              </p>
            </div>

            <div className="card flex flex-col p-6">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-medium text-muted">Start here</h2>
                {view.topGain > 0 ? (
                  <span className="rounded-full bg-green-soft px-2.5 py-0.5 text-xs font-semibold text-green">
                    +{formatPoints(view.topGain)} points
                  </span>
                ) : null}
              </div>
              {view.top.length ? (
                <>
                  <p className="mt-1 text-lg font-semibold tracking-tight text-ink">
                    The {view.top.length === 1 ? "fix" : `${view.top.length} fixes`}{" "}
                    that matter most
                  </p>
                  <ol role="list" className="mt-4 grid flex-1 gap-3">
                    {view.top.map((issue, index) => (
                      <li key={issue.id} className="flex items-start gap-3">
                        <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-blue-soft text-xs font-semibold text-blue">
                          {index + 1}
                        </span>
                        <span className="flex-1 text-[15px]/6 text-ink">
                          {guideFor(issue.id).problem}
                        </span>
                        <GainLabel issue={issue} />
                      </li>
                    ))}
                  </ol>
                  <div className="mt-5">
                    <CopyButton
                      primary
                      copied={copiedKey === "top"}
                      label={`Copy prompt for ${view.top.length === 1 ? "this fix" : `these ${view.top.length}`}`}
                      onClick={() => void copy("top", prompts.top)}
                    />
                  </div>
                </>
              ) : (
                <p className="mt-2 text-[15px]/6 text-muted">
                  Nothing urgent. Every check you can fix on your site already
                  passes.
                </p>
              )}
            </div>
          </section>

          {/* How to use */}
          {issueCount > 0 ? (
            <section className="mt-4 flex flex-col gap-4 rounded-xl border border-blue/20 bg-blue-soft p-4 sm:flex-row sm:items-center sm:justify-between">
              <ol className="flex flex-col gap-1.5 text-sm text-ink sm:flex-row sm:gap-5">
                {howToSteps(platform.style, platform.name).map((step, index) => (
                  <li key={step} className="flex items-center gap-2">
                    <span className="grid size-5 place-items-center rounded-full bg-blue text-[11px] font-semibold text-white">
                      {index + 1}
                    </span>
                    {step}
                  </li>
                ))}
              </ol>
              <CopyButton
                copied={copiedKey === "full"}
                label={`Copy all ${issueCount} fixes`}
                onClick={() => void copy("full", prompts.full)}
              />
            </section>
          ) : null}

          <IssueSection
            title="Fix these first"
            subtitle="The biggest wins, in order."
            issues={view.ranked.slice(0, FIX_FIRST)}
            prompts={prompts.byId}
            copiedKey={copiedKey}
            onCopy={copy}
          />
          <IssueSection
            title="Also worth fixing"
            subtitle="Smaller gains that still add up."
            issues={view.ranked.slice(FIX_FIRST)}
            prompts={prompts.byId}
            copiedKey={copiedKey}
            onCopy={copy}
          />
          <IssueSection
            title="Needs more than a site edit"
            subtitle="Worth doing, but these take work outside your page, so they're not in your after-fixes score."
            issues={view.offSite}
            prompts={prompts.byId}
            copiedKey={copiedKey}
            onCopy={copy}
          />

          {view.good.length ? (
            <details className="group card mt-10">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 p-5">
                <span>
                  <span className="text-lg font-semibold tracking-tight text-ink">
                    Already good
                  </span>
                  <span className="ml-2 text-sm text-subtle">
                    {view.good.length} checks passed
                  </span>
                </span>
                <ChevronDown className="size-5 text-subtle transition group-open:rotate-180" />
              </summary>
              <ul role="list" className="grid gap-x-6 gap-y-2.5 border-t hairline p-5 sm:grid-cols-2">
                {view.good.map((issue) => (
                  <li key={issue.id} className="flex items-start gap-2 text-sm text-ink">
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-green" aria-hidden />
                    {guideFor(issue.id).title}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

          <CategoryBreakdown categories={audit.categories} />

          <details className="group card mt-4">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 p-5 text-[15px] font-medium text-ink">
              Technical details
              <ChevronDown className="size-5 text-subtle transition group-open:rotate-180" />
            </summary>
            <dl className="grid gap-x-8 border-t hairline p-5 text-sm sm:grid-cols-2">
              {diagnosticRows(audit).map(([label, value]) => (
                <div key={label} className="flex justify-between gap-4 border-b hairline py-2">
                  <dt className="text-muted">{label}</dt>
                  <dd className="tabular-nums text-ink">{value}</dd>
                </div>
              ))}
            </dl>
          </details>
        </div>
      </main>
    </>
  );
}

/* ---------------- Sub-components ---------------- */

function PlatformPicker({
  value,
  detected,
  onChange,
}: {
  value: PlatformId;
  detected: PlatformId;
  onChange: (id: PlatformId) => void;
}) {
  const groups: Array<[string, PlatformId[]]> = [
    ["Website builders", ["webflow", "wordpress", "wix", "squarespace", "framer", "shopify", "hubspot", "ghost"]],
    ["AI app builders", ["lovable", "bolt", "v0", "replit"]],
    ["Other", ["custom"]],
  ];
  return (
    <label className="flex shrink-0 flex-col gap-1 text-xs font-medium text-subtle">
      Your site is built with
      <span className="relative">
        <select
          value={value}
          onChange={(event) => {
            if (isPlatformId(event.target.value)) onChange(event.target.value);
          }}
          className="w-full appearance-none rounded-lg border hairline bg-panel py-2 pr-9 pl-3 text-sm font-medium text-ink transition hover:border-subtle focus:border-blue focus:ring-4 focus:ring-blue/15 focus:outline-none sm:w-64"
        >
          {groups.map(([label, ids]) => (
            <optgroup key={label} label={label}>
              {ids.map((id) => (
                <option key={id} value={id}>
                  {PLATFORMS[id].name}
                  {id === detected ? " (detected)" : ""}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <ChevronDown
          aria-hidden
          className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-subtle"
        />
      </span>
    </label>
  );
}

function ScoreFigure({
  value,
  caption,
  accent = false,
}: {
  value: number;
  caption: string;
  accent?: boolean;
}) {
  return (
    <div>
      <div className="flex items-baseline gap-1">
        <span
          className={`text-5xl sm:text-6xl font-semibold leading-none tracking-[-0.03em] tabular-nums ${accent ? "text-blue" : "text-ink"}`}
        >
          {value}
        </span>
        <span className="text-base text-subtle">/100</span>
      </div>
      <div className={`mt-2 text-sm font-medium ${accent ? "text-blue" : "text-muted"}`}>
        {caption}
      </div>
    </div>
  );
}

function ScoreBar({ now, after }: { now: number; after: number }) {
  const nowPct = clampPct(now);
  const gainPct = Math.max(0, clampPct(after) - nowPct);
  return (
    <div
      className="mt-5 flex h-2.5 overflow-hidden rounded-full bg-soft"
      role="img"
      aria-label={`Score ${Math.round(now)} now, ${Math.round(after)} after fixes`}
    >
      <div className="h-full bg-ink" style={{ width: `${nowPct}%` }} />
      <div className="h-full bg-blue/45" style={{ width: `${gainPct}%` }} />
    </div>
  );
}

function IssueSection({
  title,
  subtitle,
  issues,
  prompts,
  copiedKey,
  onCopy,
}: {
  title: string;
  subtitle: string;
  issues: Issue[];
  prompts: Map<string, string>;
  copiedKey: string;
  onCopy: (key: string, text: string) => void;
}) {
  if (!issues.length) return null;
  return (
    <section className="mt-10">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-lg font-semibold tracking-tight text-ink">
          {title}
          <span className="ml-2 text-sm font-normal text-subtle">{issues.length}</span>
        </h2>
      </div>
      <p className="mt-0.5 text-sm text-muted">{subtitle}</p>
      <div className="card mt-4 divide-y divide-line">
        {issues.map((issue) => (
          <IssueRow
            key={issue.id}
            issue={issue}
            prompt={prompts.get(issue.id)}
            copied={copiedKey === issue.id}
            onCopy={onCopy}
          />
        ))}
      </div>
    </section>
  );
}

function IssueRow({
  issue,
  prompt,
  copied,
  onCopy,
}: {
  issue: Issue;
  prompt: string | undefined;
  copied: boolean;
  onCopy: (key: string, text: string) => void;
}) {
  const guide = guideFor(issue.id);
  const Icon = issue.status === "fail" ? XCircle : MinusCircle;
  return (
    <article className="flex gap-3 p-5">
      <Icon
        aria-label={issue.status === "fail" ? "Failing" : "Partly done"}
        className={`mt-0.5 size-5 shrink-0 ${issue.status === "fail" ? "text-red" : "text-amber"}`}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-4">
          <h3 className="text-[15px]/6 font-semibold text-ink">{guide.problem}</h3>
          <GainLabel issue={issue} />
        </div>
        {guide.why ? <p className="mt-1 text-sm/6 text-muted">{guide.why}</p> : null}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {prompt ? (
            <CopyButton
              copied={copied}
              label="Copy fix prompt"
              onClick={() => onCopy(issue.id, prompt)}
            />
          ) : null}
          <span className="rounded-md bg-soft px-2 py-1 text-xs font-medium text-muted">
            {EFFORT_LABEL[guide.effort]}
          </span>
        </div>
        <details className="group mt-3">
          <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-xs font-medium text-subtle hover:text-ink">
            Details
            <ChevronDown className="size-3.5 transition group-open:rotate-180" />
          </summary>
          <dl className="mt-2 grid gap-2 rounded-lg bg-canvas p-3 text-xs/5 text-muted">
            <div>
              <dt className="font-semibold text-ink">What we found</dt>
              <dd>{issue.evidence}</dd>
            </div>
            <div>
              <dt className="font-semibold text-ink">What good looks like</dt>
              <dd>{issue.recommendation}</dd>
            </div>
            <div className="text-subtle">
              Check {issue.id} · {issue.categoryName} · {issue.score.toFixed(1)}/
              {issue.maxScore.toFixed(1)} points
            </div>
          </dl>
        </details>
      </div>
    </article>
  );
}

function GainLabel({ issue }: { issue: AuditItem }) {
  if (isBlocker(issue)) {
    return (
      <span className="shrink-0 rounded-full bg-red-soft px-2 py-0.5 text-xs font-semibold text-red">
        Lifts the cap
      </span>
    );
  }
  const gain = gainOf(issue);
  if (gain <= 0) return null;
  return (
    <span className="shrink-0 text-sm font-semibold tabular-nums text-green">
      +{formatPoints(gain)}
    </span>
  );
}

function CategoryBreakdown({ categories }: { categories: AuditCategory[] }) {
  return (
    <section className="mt-10">
      <h2 className="text-lg font-semibold tracking-tight text-ink">
        Score by area
      </h2>
      <div className="card mt-4 grid gap-x-8 gap-y-4 p-5 sm:grid-cols-2">
        {categories.map((category) => {
          const measured = category.maxScore > 0;
          const pct = measured ? (category.score / category.maxScore) * 100 : 0;
          return (
            <div key={category.id}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="font-medium text-ink">{category.name}</span>
                <span className="tabular-nums text-subtle">
                  {measured ? `${Math.round(pct)}%` : "Not measured"}
                </span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-soft">
                <div
                  className={`h-full rounded-full ${pct >= 75 ? "bg-green" : pct >= 50 ? "bg-blue" : "bg-amber"}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function CopyButton({
  copied,
  label,
  onClick,
  primary = false,
}: {
  copied: boolean;
  label: string;
  onClick: () => void;
  primary?: boolean;
}) {
  const tone = copied
    ? "border-green bg-green-soft text-green"
    : primary
      ? "border-blue bg-blue text-white hover:bg-blue-hover"
      : "border-line bg-panel text-ink hover:border-blue hover:text-blue";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue ${tone}`}
    >
      {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
      {copied ? "Copied" : label}
    </button>
  );
}

/* ---------------- helpers ---------------- */

function howToSteps(style: (typeof PLATFORMS)[PlatformId]["style"], name: string): string[] {
  switch (style) {
    case "no-code":
      return ["Copy a prompt", "Paste it into ChatGPT or Claude", `Follow the steps in ${name}`];
    case "ai-builder":
      return ["Copy a prompt", `Paste it into ${name}`, "Publish, then re-check"];
    case "developer":
      return ["Copy a prompt", "Send it to your developer", "Re-check once it's live"];
  }
}

function diagnosticRows(audit: AuditResult): Array<[string, string | number]> {
  const d = audit.diagnostics;
  return [
    ["HTTP status", d.httpStatus],
    ["Redirects", d.redirects],
    ["Main content found", d.markdownExtract === "ready" ? "Yes" : "No"],
    ["robots.txt", d.robotsTxt],
    ["llms.txt", d.llmsTxt],
    ["Sitemap", d.sitemap],
    ["Page speed data", d.pageSpeed],
    ["Words on page", audit.stats.words.toLocaleString()],
    ["Structured data blocks", audit.stats.jsonLdBlocks],
    ["Structured data errors", d.jsonLdParseFailures],
  ];
}

function clampPct(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function formatPoints(value: number): string {
  return value >= 10 ? String(Math.round(value)) : value.toFixed(1).replace(/\.0$/, "");
}

function formatTimestamp(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
