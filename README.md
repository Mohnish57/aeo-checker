# AEO Checker

Paste a URL, get a 0–100 score for how ready the page is for AI answer engines (ChatGPT, Claude, Perplexity, Google AI Overviews) and classic search, with evidence for every check and prioritized fixes.

Forked from [context-dot-dev/ai-seo-audit](https://github.com/context-dot-dev/ai-seo-audit) (MIT). This version fetches pages directly (no paid APIs) and adds AI-crawler, llms.txt, classic SEO, and PageSpeed checks.

## What it checks

| Category | Weight | Examples |
|---|---|---|
| A. Technical AI Crawlability | 24 | HTTPS, content in raw HTML, canonical, noindex, AI bots allowed in robots.txt, llms.txt, redirects |
| B. Content Structure & Chunking | 22 | Direct-answer intro, heading hierarchy, short paragraphs, FAQ, data points, lists/tables |
| C. Structured Data / Schema | 13 | JSON-LD, Organization, Article, Person, FAQPage |
| D. E-E-A-T & Entity Authority | 13 | About/trust pages, privacy/terms/contact, original research, brand consistency |
| G. Classic SEO | 12 | Title, meta description, alt text, Open Graph, viewport, lang, sitemap |
| H. Performance | 8 | Lighthouse mobile score, LCP, CLS, TBT (PageSpeed Insights) |
| E. Off-site / Citation Surface | 6 | Review profiles, GitHub, sameAs, outbound citations |
| F. Measurement & Governance | 2 | Visible refresh date |

Checks live in `lib/rules.ts`. Each returns pass / partial / fail / N/A with evidence. N/A checks (and fully N/A categories) give their weight to the rest, so scores are always out of 100.

## Run locally

```bash
npm install
cp .env.example .env.local
npm run dev
```

| Variable | Required | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SITE_URL` | yes | Public URL of the deployment |
| `PAGESPEED_API_KEY` | recommended | Free Google API key. Without it, PageSpeed checks are usually N/A (shared quota is exhausted). |

## Scripts

`npm test` · `npm run typecheck` · `npm run lint` · `npm run build`

## API

`GET /api/audit?url=https://example.com` → `{ status: "ready", audit }` or `{ status: "error", message }`.

## Deploy

Import the repo into Vercel, set `NEXT_PUBLIC_SITE_URL` and `PAGESPEED_API_KEY` (recommended), then deploy.

## License

MIT. See [LICENSE](./LICENSE).
