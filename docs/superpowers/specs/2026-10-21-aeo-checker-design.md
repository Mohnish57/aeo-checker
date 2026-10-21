# AEO Checker — Design

**Date:** 2026-10-21
**Status:** Approved in chat, pending spec review
**Repo:** https://github.com/Mohnish57/aeo-checker
**Base:** Fork of [context-dot-dev/ai-seo-audit](https://github.com/context-dot-dev/ai-seo-audit) (MIT)

## Goal

A public website where anyone pastes a URL and gets:

1. A 0–100 score for how ready the page is for AI answer engines (ChatGPT, Perplexity, Claude, Google AI Overviews) and classic search.
2. A per-category breakdown with pass / partial / fail per check, with evidence.
3. A prioritized list of fixes, plus a copy-paste "fix prompt" for coding agents.

Success = per-check pass/fail results agree with CheckAEO on a 5-site benchmark set, and the app runs on Vercel's free tier with no paid API dependency.

## Non-goals

Full-site crawls, user accounts, history, PDF export, live querying of ChatGPT/Perplexity for citations.

## Architecture

Next.js 16 App Router, TypeScript, Tailwind v4, deployed on Vercel Hobby.

```
Home form ──navigate──▶ /audit/[domain]?url=…  (server component, Node runtime)
GET/POST /api/audit?url=…  (JSON API, same pipeline)
                                     │
                              lib/perform-audit.ts  validate URL, map errors
                                     │
                                     ├─ lib/fetch-page.ts   safe fetch: page HTML, robots.txt, llms.txt, sitemap
                                     ├─ lib/pagespeed.ts    Google PageSpeed Insights (parallel, optional)
                                     ├─ lib/extract.ts      HTML → main-content Markdown (Readability + Turndown)
                                     ├─ lib/audit.ts        build RuleContext, score categories
                                     └─ lib/rules.ts        all checks (single source of truth)
```

This keeps the fork's existing flow (server-rendered results page plus JSON API). Rules only read `RuleContext`; fetching is isolated in two modules. Scoring, bands, agent prompts and UI are inherited from the fork and derive from `rules.ts`.

## Changes to the fork

### Remove
- `context.dev` SDK and `CONTEXT_DEV_API_KEY`.
- Turso cache (`@libsql/client`, `aiseo_TURSO_*`). Every audit runs live.
- Upstream third-party analytics (Databuddy — it would report your traffic to the original author's account) and context.dev branding/links, schema and "Powered by" badge. Rebrand to "AEO Checker".
- context.dev brand lookup (`lib/brand.ts`, logo/backdrop on the results hero). Results render with `brand = null`, which the view already supports.

### Replace fetching (`lib/fetch-page.ts`)
- Direct `fetch` with a desktop-browser User-Agent, 10s timeout, 3 MB body cap, manual redirects (max 5).
- **SSRF guard:** only `http(s)`, standard ports; resolve DNS and reject private, loopback, link-local, CGNAT and metadata IPs on every redirect hop.
- Clear typed errors → user-facing messages: invalid URL, unreachable, timeout, non-HTML, blocked (401/403/429/503 bot walls), too large.
- Site files fetched in parallel from the page origin: `/robots.txt`, `/llms.txt`, sitemap (from robots `Sitemap:` directive, else `/sitemap.xml`). Missing files are data, not errors.

### Replace Markdown extraction (`lib/extract.ts`)
context.dev returned main-content Markdown. We reproduce it locally: parse with `linkedom`, run `@mozilla/readability` for main content, convert with `turndown`. Fallback to full `<body>` if Readability returns nothing. Keeps paragraph splitting, blockquote and list detection (B3, B7, B14) working.

Known trade-off: no JavaScript rendering. This matches what GPTBot/ClaudeBot/PerplexityBot see, so it is the correct lens for AEO. Pages that inject content/schema client-side will score lower — that is a real finding, and A8/C11 recommendations already say so.

## Checks

Existing 32 checks (A1–F6) are kept with logic unchanged, except evidence strings that mention Context.dev. New checks:

### A. Technical AI Crawlability (added)
| ID | Check | Pass | Partial | Fail |
|---|---|---|---|---|
| A13 | AI crawlers allowed in robots.txt for this URL | no AI bot blocked | only training bots blocked (GPTBot, ClaudeBot, Google-Extended, Applebot-Extended, CCBot) | any answer/search bot blocked (OAI-SearchBot, ChatGPT-User, Claude-SearchBot, Claude-User, PerplexityBot, Perplexity-User) |
| A14 | `/llms.txt` exists and is plain text/markdown | 200 + non-HTML body with a `#` heading | 200 non-HTML without a heading | missing, or HTML catch-all page |
| A15 | Page reached directly or via ≤1 redirect with HTTP 200 | 200, ≤1 hop | 2–5 hops or other 2xx | — (≥400 is reported as an audit error) |

A13 uses the `robots-parser` package. Multiplier 2 (blocking AI answer bots is the single biggest AEO failure). Training bots are scored as partial, not fail: blocking them is a legitimate business choice that does not stop live citations. A14 multiplier 0.5.

### G. Classic SEO (new category)
| ID | Check | Pass | Partial | Fail |
|---|---|---|---|---|
| G1 | Title length | 30–60 chars | 10–29 or 61–70 | missing / other |
| G2 | Meta description length | 70–160 chars | 1–69 or 161–200 | missing / other |
| G3 | Image alt text coverage | ≥90% of `<img>` have alt | ≥50% | <50% (N/A if no images) |
| G4 | Open Graph + Twitter card | og:title, og:description, og:image | some present | none |
| G5 | Mobile viewport meta | `width=device-width` | viewport without it | missing |
| G6 | `<html lang>` set | present | — | missing |
| G7 | XML sitemap discoverable | valid sitemap found | robots declares it but fetch fails | none |

### H. Performance (new category)
Google PageSpeed Insights API v5, mobile strategy, run in parallel with the page fetch, 45s timeout. Optional `PAGESPEED_API_KEY` env var (free) raises quota; without it the shared quota is used. If PSI fails or times out, all H checks are **N/A** and the UI shows "Performance unavailable — try again" with a link to the PSI report.

| ID | Check | Pass | Partial | Fail |
|---|---|---|---|---|
| H1 | Lighthouse performance score | ≥90 | 50–89 | <50 |
| H2 | Largest Contentful Paint | ≤2.5s | ≤4s | >4s |
| H3 | Cumulative Layout Shift | ≤0.1 | ≤0.25 | >0.25 |
| H4 | Total Blocking Time | ≤200ms | ≤600ms | >600ms |

## Scoring

Same mechanics as the fork: pass=1, partial=0.5, fail=0, N/A excluded and its weight redistributed within the category. If a whole category is N/A, its weight is redistributed proportionally across the other categories so the total stays out of 100.

Initial category weights (sum 100), to be tuned against CheckAEO:

| Category | Weight |
|---|---|
| A. Technical AI Crawlability | 24 |
| B. Content Structure & Chunking | 22 |
| C. Structured Data / Schema | 13 |
| D. E-E-A-T & Entity Authority | 13 |
| G. Classic SEO | 12 |
| H. Performance | 8 |
| E. Off-site / Citation Surface | 6 |
| F. Measurement & Governance | 2 |

Bands unchanged: ≤40 Critical, ≤55 Below average, ≤70 Average, ≤85 Strong, >85 Excellent.

## UI

Keep the fork's home page and results layout. Changes: branding, new categories render automatically from `CATEGORIES`, a "Performance unavailable" state, and friendly error states for the typed fetch errors.

## Testing

- **Unit (Vitest):** every new rule against small HTML/robots fixtures; SSRF guard (private IPs, redirects to private IPs, non-http schemes); extract.ts paragraph/list/blockquote output; category-level N/A redistribution.
- **Regression:** existing rules run against a saved fixture page to confirm the fetch/extract swap does not change their results unexpectedly.
- **Build gates:** `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` all pass before deploy.
- **Live benchmark (post-deploy):** 5 sites (user's own site + 4 varied: SaaS homepage, blog article, e-commerce, docs page) through our tool and CheckAEO. Record per-check agreement in `docs/benchmark.md`; tune thresholds/weights until checks shared by both tools agree, and list any CheckAEO checks we lack.

## Deployment

1. Push to `github.com/Mohnish57/aeo-checker` (`main`).
2. User runs `vercel login`; we run `vercel link` + `vercel --prod` (or connect the GitHub repo in Vercel for auto-deploys).
3. Env vars: `NEXT_PUBLIC_SITE_URL` (Vercel URL), optional `PAGESPEED_API_KEY`.

## Risks

- **Bot walls (Cloudflare etc.)** block direct fetches from Vercel IPs → clear "site blocked our checker" message. Same limitation AI crawlers often face.
- **PSI latency/quota** → isolated to category H, N/A fallback, optional API key.
- **Vercel function duration** → page fetch ≤10s per request, PSI ≤45s, all parallel; total stays under 60s. Keep the fork's `maxDuration = 120` (allowed on Hobby with Fluid Compute).
- **Score parity with CheckAEO** is per-check, not exact total — CheckAEO's weights are proprietary.
