# Founder-friendly results: platform-aware prompts, projected score, redesign

Status: approved 2026-10-24

## Problem
The scoring engine is accurate, but results are written for developers:
jargon and rule IDs, fix prompts that assume a coding agent with repo access,
45 checks in one list, and no sense of what fixing them is worth.

## Goals
1. Detect the site builder and write fix prompts the founder can use on it.
2. Plain-English issue titles, a one-line "why AI cares", and an effort tag.
3. Show "score now → score after fixes" and the gain from the top fixes.
4. Group issues: fix first, also worth fixing, needs more than a site edit,
   already good.
5. Redesign home, loading and results: Apple system font, Atlassian palette,
   light, minimal.

## Design

### Platform detection — `lib/platform.ts` (client-safe, pure)
`detectPlatform({ html, host, generator })` returns a `PlatformId`. Signals,
checked in this order:

| Platform | Signal |
|---|---|
| Webflow | `data-wf-site`, generator "Webflow" |
| Framer | generator "Framer", `framerusercontent.com` |
| Wix | generator "Wix", `static.wixstatic.com` |
| Squarespace | `static1.squarespace.com`, `squarespace-cdn.com` |
| Shopify | `cdn.shopify.com/s/`, `Shopify.theme` |
| WordPress | `/wp-content/`, `/wp-includes/`, generator "WordPress" |
| HubSpot | generator "HubSpot" |
| Ghost | generator "Ghost" |
| Lovable | host `*.lovable.app`, `gpteng.co`, `data-lov-id` |
| Bolt / v0 / Replit | host `*.bolt.new` / `*.vusercontent.net` / `*.replit.app` |
| otherwise | `custom` |

Each platform has a display name, a prompt style (`no-code`, `ai-builder`,
`developer`) and, for no-code builders, a "where things live" hint (SEO
settings, head custom code, site-level SEO/robots).

`AuditResult` gains `platform: PlatformId` and `pageExcerpt` (first ~1,200
characters of the extracted Markdown, used so the AI can write copy from the
real page). The results page lets the user override the platform; prompts are
rebuilt in the browser, no re-audit.

### Plain English — `lib/fix-guide.ts` (client-safe)
Per rule ID: `title` (neutral goal), `problem` (shown when failing),
`why` (one line, AI impact), `effort` (`quick` ≈ 5 min, `medium` ≈ 30 min,
`developer`), `siteFix` (false when the fix is not an edit to this site:
E1 review listings, E7 GitHub, D10 original research, H1–H4 speed).
Rule IDs, technical evidence and the original recommendation move into a
"Details" disclosure.

### Projected score — `lib/projection.ts` (client-safe, pure)
- `projectedScore(categories, fixed?)`: sums `maxScore` for fixed items and
  `score` for the rest, then applies the blocked-page cap (40) if any of
  A8/A12/A13 still fails. `fixed` defaults to every actionable item with
  `siteFix: true`. Capped at 100.
- `rankFixes(categories)`: actionable, site-fixable items; blockers first,
  then by gain (`maxScore - score`).
- Top fixes = first 3 of the ranking; their combined gain is
  `projectedScore(categories, top3) - score`.
- `BLOCKED_SCORE_CAP` and the blocking IDs move here; `lib/audit.ts` imports
  them.

### Prompts — `lib/agent-fix-prompt.ts`
`buildFixPrompts(audit, platformId)` → `{ full, topIssues }` (all actionable
issues, same shape as today so the API is unchanged). Three templates:
- **no-code**: for ChatGPT/Claude. "I run my site on X, I'm not a
  developer": click-by-click steps, the exact copy or code to paste, how to
  check it worked, no invented facts, ask me when you need input. Includes
  the where-things-live hint and the page excerpt.
- **ai-builder**: a direct change request for Lovable/Bolt/v0/Replit;
  keep design, server-render or prerender critical content.
- **developer**: today's prompt, minus the stale `guidelines.md` line.

### UI
- Tokens (Atlassian): blue `#0C66E4` (hover `#0055CC`), ink `#172B4D`,
  subtle `#44546F`, subtlest `#626F86`, surface `#FFFFFF`, canvas `#F7F8F9`,
  border `#DCDFE4`, green `#1F845A`, amber `#A54800`/`#F5CD47`,
  red `#C9372C`. Font: `-apple-system, BlinkMacSystemFont, "SF Pro Text",
  "SF Pro Display", Inter, "Helvetica Neue", sans-serif`.
- Cards: white, 1px border, 12px radius, no heavy shadows.
- Results: header (host, title, "Built with X ▾"), score card (now → after
  fixes, band, plain interpretation), top-3 card (+N points), then
  "Fix these first", "Also worth fixing", "Needs more than a site edit",
  "Already good" (collapsed). Each issue: problem, why, effort, +points,
  Copy prompt, Details.
- Home and loading pages restyled to match; copy aimed at founders.

## Testing
Unit tests: detection fixtures per builder, projection (gain, cap, cap
lifted, 100 ceiling), prompt template per style, fix-guide covers every rule.
Manual: Chrome check of Wednesday (Webflow), Wikipedia and a WordPress site.
