# AEO Checker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the forked `ai-seo-audit` app into "AEO Checker": no paid APIs, direct page fetching, new AI-crawler / llms.txt / classic SEO / PageSpeed checks, deployed on Vercel and benchmarked against CheckAEO.

**Architecture:** Network access is isolated in `lib/net/safe-fetch.ts`, `lib/site-files.ts` and `lib/pagespeed.ts`, gathered by `fetchPageSources()` in `lib/audit.ts`. Everything after that is pure: `auditFromSources()` builds a `RuleContext` and scores the rules in `lib/rules.ts`, which makes every rule testable with HTML fixtures. The UI (server-rendered `/audit/[domain]` page + `/api/audit`) is inherited from the fork.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, Tailwind v4, Vitest, undici, ipaddr.js, robots-parser, linkedom, @mozilla/readability, turndown. Node 22 locally.

**Spec:** `docs/superpowers/specs/2026-10-21-aeo-checker-design.md`

## Global Constraints

- No paid APIs. `context.dev` and Turso are removed entirely by the end of Task 7.
- Page fetch: 10s timeout, 3 MB cap, max 5 redirects, only `http:`/`https:` on ports 80/443, private/internal IPs rejected on every hop.
- Site files (robots.txt, llms.txt, sitemap): 6s timeout, 1 MB cap (sitemap body truncated, not rejected).
- PageSpeed Insights: mobile strategy, 45s timeout, optional `PAGESPEED_API_KEY`; on failure all H checks are N/A.
- Category weights (sum 100): A 24, B 22, C 13, D 13, E 6, F 2, G 12, H 8.
- Product name: "AEO Checker". No context.dev branding, analytics, or links in the UI.
- Commit messages are precise and self-describing (they feed weekly reports) and end with:
  `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`
- The shell in this environment is slow (30s+ per command). Batch commands; use timeouts ≥ 300000 ms.

## File Map

| File | Status | Responsibility |
|---|---|---|
| `vitest.config.ts` | create | Test runner config with `@/` alias |
| `lib/net/safe-fetch.ts` | create | SSRF-safe fetch with timeout, size cap, manual redirects, typed `FetchError` |
| `lib/extract.ts` | create | HTML → main-content Markdown |
| `lib/site-files.ts` | create | robots.txt, llms.txt, sitemap discovery |
| `lib/pagespeed.ts` | create | PageSpeed Insights client + parser |
| `lib/audit.ts` | modify | `fetchPageSources`, `auditFromSources`, context building, scoring with category N/A redistribution |
| `lib/rules.ts` | modify | New context fields, categories G/H, rules A13–A15, G1–G7, H1–H4, new weights |
| `lib/audit-types.ts` | modify | New diagnostics shape, simplified API response |
| `lib/perform-audit.ts` | modify | No env key, no cache, friendly errors |
| `app/api/audit/route.ts`, `app/audit/[domain]/page.tsx` | modify | Drop brand/cache/missing-env |
| `components/audit-results-view.tsx` | modify | Drop brand, new diagnostics, N/A category display |
| `lib/brand.ts`, `lib/brand-types.ts`, `lib/turso.ts`, `public/context-logo.png` | delete | context.dev / Turso only |
| `app/layout.tsx`, `app/page.tsx`, `components/audit-form.tsx`, `public/site.webmanifest`, `app/robots.ts`, `app/sitemap.ts`, `README.md`, `LICENSE`, `.env.example` | modify | Rebrand, remove analytics |
| `tests/**` | create | Unit + fixture tests |
| `docs/benchmark.md` | create | CheckAEO comparison |

---

### Task 1: Test tooling and dependencies

**Files:**
- Modify: `package.json`, `next.config.ts`
- Create: `vitest.config.ts`, `tests/url.test.ts`

**Interfaces:**
- Produces: `npm test` (Vitest, `tests/**/*.test.ts`, `@/` alias to repo root).

- [ ] **Step 1: Install dependencies**

```bash
cd "/Users/mohnishsawlani/Documents/Wednesday Projects/aeo-checker-"
npm install
npm install undici ipaddr.js robots-parser linkedom @mozilla/readability turndown
npm install -D vitest @types/turndown
```

- [ ] **Step 2: Add test script** — in `package.json` `"scripts"`, add `"test": "vitest run"` after `"typecheck"`.

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 15_000,
  },
});
```

- [ ] **Step 4: Keep DOM/markdown libraries out of the Next bundle** — replace `next.config.ts` with:

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typedRoutes: true,
  // linkedom has optional native deps (canvas) that bundlers choke on.
  serverExternalPackages: ["linkedom", "@mozilla/readability", "turndown"],
};

export default nextConfig;
```

- [ ] **Step 5: Smoke test on existing code** — create `tests/url.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { normalizeAuditUrl } from "@/lib/url";

describe("normalizeAuditUrl", () => {
  it("adds https and strips www", () => {
    expect(normalizeAuditUrl("www.Example.com/pricing")).toBe(
      "https://example.com/pricing",
    );
  });

  it("rejects hosts without a dot", () => {
    expect(normalizeAuditUrl("localhost")).toBeNull();
  });
});
```

- [ ] **Step 6: Run** `npm test` — Expected: 2 passed.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json vitest.config.ts next.config.ts tests/url.test.ts
git commit -m "chore: add vitest and fetch/extract dependencies for direct page fetching"
```

---

### Task 2: SSRF-safe fetch

**Files:**
- Create: `lib/net/safe-fetch.ts`, `tests/safe-fetch.test.ts`

**Interfaces:**
- Produces:
  - `type FetchErrorCode = "invalid-url" | "blocked-address" | "timeout" | "unreachable" | "too-large" | "too-many-redirects" | "blocked" | "http-error" | "not-html"`
  - `class FetchError extends Error { readonly code: FetchErrorCode }` — `message` is user-facing.
  - `type FetchResult = { finalUrl: string; status: number; contentType: string; body: string; redirects: number }`
  - `type SafeFetchOptions = { timeoutMs?: number; maxBytes?: number; truncate?: boolean; maxRedirects?: number; accept?: string; allowPrivateNetwork?: boolean }`
  - `safeFetch(url: string, options?: SafeFetchOptions): Promise<FetchResult>`
  - `isPublicAddress(ip: string): boolean`
  - `assertPublicHost(url: URL): Promise<void>`

- [ ] **Step 1: Write failing tests** — `tests/safe-fetch.test.ts`:

```ts
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  FetchError,
  assertPublicHost,
  isPublicAddress,
  safeFetch,
} from "@/lib/net/safe-fetch";

describe("isPublicAddress", () => {
  it.each(["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"])(
    "allows public %s",
    (ip) => expect(isPublicAddress(ip)).toBe(true),
  );

  it.each([
    "127.0.0.1",
    "10.0.0.1",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "::1",
    "fd00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
    "not-an-ip",
  ])("blocks %s", (ip) => expect(isPublicAddress(ip)).toBe(false));
});

describe("safeFetch guards", () => {
  async function codeOf(promise: Promise<unknown>) {
    try {
      await promise;
      return "resolved";
    } catch (error) {
      return error instanceof FetchError ? error.code : "other";
    }
  }

  it("rejects non-http schemes", async () => {
    expect(await codeOf(safeFetch("ftp://example.com/"))).toBe("invalid-url");
  });

  it("rejects non-standard ports", async () => {
    expect(await codeOf(safeFetch("https://example.com:8443/"))).toBe(
      "invalid-url",
    );
  });

  it("rejects literal private IPs", async () => {
    expect(await codeOf(safeFetch("http://127.0.0.1/"))).toBe(
      "blocked-address",
    );
    expect(await codeOf(safeFetch("http://169.254.169.254/latest"))).toBe(
      "blocked-address",
    );
  });

  it("rejects hostnames resolving to private IPs", async () => {
    expect(await codeOf(assertPublicHost(new URL("http://localhost/")))).toBe(
      "blocked-address",
    );
  });
});

describe("safeFetch against a local server", () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    server = createServer((req, res) => {
      switch (req.url) {
        case "/ok":
          res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
          res.end("<html><body>héllo</body></html>");
          return;
        case "/redirect":
          res.writeHead(301, { location: "/ok" });
          res.end();
          return;
        case "/loop":
          res.writeHead(302, { location: "/loop" });
          res.end();
          return;
        case "/big":
          res.writeHead(200, { "content-type": "text/plain" });
          res.end("x".repeat(5000));
          return;
        case "/hang":
          return; // never respond
        default:
          res.writeHead(404);
          res.end();
      }
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => {
    server.closeAllConnections();
    server.close();
  });

  const local = { allowPrivateNetwork: true, allowAnyPort: true } as const;

  it("returns body, status and content type", async () => {
    const result = await safeFetch(`${base}/ok`, local);
    expect(result.status).toBe(200);
    expect(result.contentType).toContain("text/html");
    expect(result.body).toContain("héllo");
    expect(result.redirects).toBe(0);
  });

  it("follows redirects and counts them", async () => {
    const result = await safeFetch(`${base}/redirect`, local);
    expect(result.finalUrl).toBe(`${base}/ok`);
    expect(result.redirects).toBe(1);
  });

  it("stops redirect loops", async () => {
    await expect(safeFetch(`${base}/loop`, local)).rejects.toMatchObject({
      code: "too-many-redirects",
    });
  });

  it("rejects bodies over the cap", async () => {
    await expect(
      safeFetch(`${base}/big`, { ...local, maxBytes: 1000 }),
    ).rejects.toMatchObject({ code: "too-large" });
  });

  it("truncates instead of rejecting when asked", async () => {
    const result = await safeFetch(`${base}/big`, {
      ...local,
      maxBytes: 1000,
      truncate: true,
    });
    expect(result.body.length).toBeLessThanOrEqual(1000);
  });

  it("times out", async () => {
    await expect(
      safeFetch(`${base}/hang`, { ...local, timeoutMs: 300 }),
    ).rejects.toMatchObject({ code: "timeout" });
  });

  it("returns non-2xx statuses without throwing", async () => {
    const result = await safeFetch(`${base}/missing`, local);
    expect(result.status).toBe(404);
  });
});
```

Note: `allowAnyPort` is a test-only option alongside `allowPrivateNetwork` (the local server uses a random port). Add it to `SafeFetchOptions`.

- [ ] **Step 2: Run** `npm test -- tests/safe-fetch.test.ts` — Expected: FAIL, cannot resolve `@/lib/net/safe-fetch`.

- [ ] **Step 3: Implement `lib/net/safe-fetch.ts`**

```ts
/**
 * Fetch a user-supplied URL without letting it reach private networks.
 *
 * - Only http(s) on ports 80/443.
 * - Every redirect hop is re-validated; DNS answers are checked both before
 *   the request and at connect time (guards against DNS rebinding).
 * - Hard timeout and body-size cap.
 *
 * FetchError messages are shown to users as-is.
 */
import { lookup } from "node:dns/promises";
import { isIP, type LookupFunction } from "node:net";

import ipaddr from "ipaddr.js";
import { Agent, fetch as undiciFetch, type Response } from "undici";

export type FetchErrorCode =
  | "invalid-url"
  | "blocked-address"
  | "timeout"
  | "unreachable"
  | "too-large"
  | "too-many-redirects"
  | "blocked"
  | "http-error"
  | "not-html";

export class FetchError extends Error {
  readonly code: FetchErrorCode;

  constructor(code: FetchErrorCode, message: string) {
    super(message);
    this.name = "FetchError";
    this.code = code;
  }
}

export type FetchResult = {
  finalUrl: string;
  status: number;
  contentType: string;
  body: string;
  redirects: number;
};

export type SafeFetchOptions = {
  timeoutMs?: number;
  maxBytes?: number;
  /** Return the first `maxBytes` instead of throwing `too-large`. */
  truncate?: boolean;
  maxRedirects?: number;
  accept?: string;
  /** Tests only: allow loopback/private targets. */
  allowPrivateNetwork?: boolean;
  /** Tests only: allow non-standard ports. */
  allowAnyPort?: boolean;
};

export const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 AEOChecker/1.0";

const BLOCKED_ADDRESS_MESSAGE =
  "That address points to a private or internal network, so it can't be audited.";

export function isPublicAddress(ip: string): boolean {
  if (!ipaddr.isValid(ip)) return false;
  let addr = ipaddr.parse(ip);
  if (addr.kind() === "ipv6") {
    const v6 = addr as ipaddr.IPv6;
    if (v6.isIPv4MappedAddress()) addr = v6.toIPv4Address();
  }
  return addr.range() === "unicast";
}

export async function assertPublicHost(url: URL): Promise<void> {
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(hostname)) {
    if (!isPublicAddress(hostname)) {
      throw new FetchError("blocked-address", BLOCKED_ADDRESS_MESSAGE);
    }
    return;
  }
  let addresses: { address: string }[];
  try {
    addresses = await lookup(hostname, { all: true });
  } catch {
    throw new FetchError(
      "unreachable",
      `We couldn't find ${hostname}. Check the URL is spelled correctly.`,
    );
  }
  if (!addresses.length || addresses.some((a) => !isPublicAddress(a.address))) {
    throw new FetchError("blocked-address", BLOCKED_ADDRESS_MESSAGE);
  }
}

// Connect-time guard: re-checks the addresses the socket will actually use.
function guardedLookup(
  hostname: string,
  options: { all?: boolean },
  callback: (
    error: Error | null,
    address?: string | { address: string; family: number }[],
    family?: number,
  ) => void,
): void {
  lookup(hostname, { all: true }).then(
    (addresses) => {
      if (
        !addresses.length ||
        addresses.some((a) => !isPublicAddress(a.address))
      ) {
        callback(new FetchError("blocked-address", BLOCKED_ADDRESS_MESSAGE));
        return;
      }
      if (options.all) callback(null, addresses);
      else callback(null, addresses[0].address, addresses[0].family);
    },
    (error: Error) => callback(error),
  );
}

const publicAgent = new Agent({
  connect: { lookup: guardedLookup as unknown as LookupFunction },
});

function parseHttpUrl(raw: string, allowAnyPort: boolean): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new FetchError("invalid-url", "Enter a valid http(s) URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new FetchError("invalid-url", "Only http and https URLs can be audited.");
  }
  if (!allowAnyPort && url.port && url.port !== "80" && url.port !== "443") {
    throw new FetchError(
      "invalid-url",
      "Only standard web ports (80 and 443) can be audited.",
    );
  }
  return url;
}

export async function safeFetch(
  rawUrl: string,
  options: SafeFetchOptions = {},
): Promise<FetchResult> {
  const {
    timeoutMs = 10_000,
    maxBytes = 3_000_000,
    truncate = false,
    maxRedirects = 5,
    accept = "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
    allowPrivateNetwork = false,
    allowAnyPort = false,
  } = options;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let current = parseHttpUrl(rawUrl, allowAnyPort);
    for (let redirects = 0; ; redirects++) {
      if (!allowPrivateNetwork) await assertPublicHost(current);

      const response = await undiciFetch(current, {
        redirect: "manual",
        signal: controller.signal,
        dispatcher: allowPrivateNetwork ? undefined : publicAgent,
        headers: {
          "user-agent": USER_AGENT,
          accept,
          "accept-language": "en-US,en;q=0.9",
        },
      });

      const location = response.headers.get("location");
      if (response.status >= 300 && response.status < 400 && location) {
        await response.body?.cancel();
        if (redirects >= maxRedirects) {
          throw new FetchError(
            "too-many-redirects",
            `The page redirects more than ${maxRedirects} times.`,
          );
        }
        current = parseHttpUrl(
          new URL(location, current).toString(),
          allowAnyPort,
        );
        continue;
      }

      const body = await readBody(response, maxBytes, truncate);
      return {
        finalUrl: current.toString(),
        status: response.status,
        contentType: response.headers.get("content-type") ?? "",
        body,
        redirects,
      };
    }
  } catch (error) {
    throw toFetchError(error, controller.signal, timeoutMs);
  } finally {
    clearTimeout(timer);
  }
}

async function readBody(
  response: Response,
  maxBytes: number,
  truncate: boolean,
): Promise<string> {
  const tooLarge = () =>
    new FetchError(
      "too-large",
      `The page is larger than ${Math.round(maxBytes / 1_000_000)} MB, which is beyond what we audit.`,
    );

  const declared = Number(response.headers.get("content-length") ?? 0);
  if (!truncate && declared > maxBytes) {
    await response.body?.cancel();
    throw tooLarge();
  }
  if (!response.body) return "";

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (total + value.byteLength > maxBytes) {
      await reader.cancel();
      if (!truncate) throw tooLarge();
      chunks.push(value.subarray(0, maxBytes - total));
      total = maxBytes;
      break;
    }
    chunks.push(value);
    total += value.byteLength;
  }
  return decode(Buffer.concat(chunks), response.headers.get("content-type"));
}

function decode(bytes: Buffer, contentType: string | null): string {
  const charset = contentType?.match(/charset\s*=\s*"?([\w-]+)/i)?.[1];
  try {
    return new TextDecoder(charset ?? "utf-8").decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

function toFetchError(
  error: unknown,
  signal: AbortSignal,
  timeoutMs: number,
): FetchError {
  if (error instanceof FetchError) return error;
  if (signal.aborted) {
    return new FetchError(
      "timeout",
      `The site took longer than ${timeoutMs / 1000} seconds to respond. Try again, or check the site is up.`,
    );
  }
  // undici wraps connect errors: TypeError("fetch failed", { cause }).
  let cause: unknown = error;
  for (let i = 0; i < 4 && cause; i++) {
    if (cause instanceof FetchError) return cause;
    cause = (cause as { cause?: unknown }).cause;
  }
  return new FetchError(
    "unreachable",
    "We couldn't reach that site. Check the URL is correct and publicly accessible.",
  );
}
```

- [ ] **Step 4: Run** `npm test -- tests/safe-fetch.test.ts` — Expected: all pass. If `isIPv4MappedAddress`/`range` typings differ, check `node_modules/ipaddr.js/lib/ipaddr.js.d.ts` and adapt.

- [ ] **Step 5: Commit**

```bash
git add lib/net/safe-fetch.ts tests/safe-fetch.test.ts
git commit -m "feat: add SSRF-safe page fetcher with timeout, size cap and redirect checks"
```

---

### Task 3: Main-content Markdown extraction

**Files:**
- Create: `lib/extract.ts`, `tests/extract.test.ts`, `tests/fixtures/article.html`

**Interfaces:**
- Produces: `htmlToMainMarkdown(html: string): string` — never throws; returns `""` for empty input.

- [ ] **Step 1: Create fixture** `tests/fixtures/article.html` (also reused by Task 5/6 tests):

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Acme Widgets: What a Widget Is and How to Choose One</title>
  <meta name="description" content="Acme explains what a widget is, how widgets are priced in 2026, and how to pick the right widget for your team in five steps.">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta property="og:title" content="What a Widget Is">
  <meta property="og:description" content="A practical guide to widgets.">
  <meta property="og:image" content="https://acme.com/og.png">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="canonical" href="https://acme.com/blog/what-is-a-widget/">
  <script type="application/ld+json">
  {"@context":"https://schema.org","@graph":[
    {"@type":"Organization","name":"Acme","url":"https://acme.com","logo":"https://acme.com/logo.png","sameAs":["https://www.linkedin.com/company/acme","https://github.com/acme","https://www.wikidata.org/wiki/Q1"]},
    {"@type":"BlogPosting","headline":"What a Widget Is","author":{"@type":"Person","name":"Jane Doe"},"datePublished":"2026-01-10","dateModified":"2026-09-01"},
    {"@type":"Person","name":"Jane Doe","jobTitle":"Head of Research"},
    {"@type":"FAQPage","mainEntity":[]}
  ]}
  </script>
  <script>window.tracking = "should never appear";</script>
</head>
<body>
  <nav><a href="/">Home</a> <a href="/about">About</a> <a href="/company">Company</a> <a href="/pricing">Pricing</a></nav>
  <main>
    <article>
      <h1>What a widget is</h1>
      <p>By Jane Doe · Last updated September 1, 2026</p>
      <p>Acme is a widget company. A widget is a small reusable component that helps teams ship features faster, and Acme provides widgets for over 4,000 companies worldwide in 2026.</p>
      <h2>How widgets are priced</h2>
      <p>According to the 2026 Widget Benchmark, 62% of teams pay between $20 and $50 per seat per month. Pricing usually scales with seats, usage, and support tier.</p>
      <ul>
        <li>Starter: $20 per seat</li>
        <li>Team: $35 per seat</li>
        <li>Enterprise: custom pricing</li>
      </ul>
      <h2>How to choose a widget</h2>
      <p>Start with the problem, not the feature list. Teams that define success metrics first are 2x more likely to renew after the first year.</p>
      <blockquote>"Pick the widget your team will actually use, not the one with the longest feature list." — Jane Doe, Head of Research</blockquote>
      <table><tr><th>Plan</th><th>Seats</th></tr><tr><td>Team</td><td>10</td></tr></table>
      <h2>Frequently asked questions</h2>
      <h3>What is a widget?</h3>
      <p>A widget is a reusable component that does one job well.</p>
      <h3>How much does a widget cost?</h3>
      <p>Most widgets cost $20 to $50 per seat per month.</p>
      <p>Sources: <a href="https://www.gartner.com/widgets">Gartner</a>, <a href="https://www.forrester.com/widgets">Forrester</a>, <a href="https://en.wikipedia.org/wiki/Widget">Wikipedia</a>, <a href="https://www.g2.com/acme">G2</a>, <a href="https://github.com/acme">GitHub</a>.</p>
      <img src="/a.png" alt="Widget diagram"><img src="/b.png" alt="Pricing chart">
    </article>
  </main>
  <footer><a href="/privacy">Privacy</a> <a href="/terms">Terms</a> <a href="/contact">Contact</a> <a href="/blog/widget-pricing">Widget pricing</a></footer>
</body>
</html>
```

- [ ] **Step 2: Write failing tests** — `tests/extract.test.ts`:

```ts
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { htmlToMainMarkdown } from "@/lib/extract";

const article = readFileSync(
  new URL("./fixtures/article.html", import.meta.url),
  "utf8",
);

describe("htmlToMainMarkdown", () => {
  const md = htmlToMainMarkdown(article);

  it("keeps headings as ATX markdown", () => {
    expect(md).toMatch(/^## How widgets are priced$/m);
  });

  it("keeps list items", () => {
    expect(md).toMatch(/^-\s+Starter: \$20 per seat$/m);
  });

  it("keeps blockquotes", () => {
    expect(md).toMatch(/^>\s/m);
  });

  it("separates paragraphs with blank lines", () => {
    expect(md).toMatch(/worldwide in 2026\.\n\n/);
  });

  it("drops scripts", () => {
    expect(md).not.toContain("should never appear");
  });

  it("handles empty input", () => {
    expect(htmlToMainMarkdown("")).toBe("");
  });

  it("falls back to body content for tiny pages", () => {
    expect(htmlToMainMarkdown("<html><body><p>Hello world</p></body></html>")).toContain(
      "Hello world",
    );
  });
});
```

- [ ] **Step 3: Run** `npm test -- tests/extract.test.ts` — Expected: FAIL, module not found.

- [ ] **Step 4: Implement `lib/extract.ts`**

```ts
/**
 * HTML → main-content Markdown, replacing context.dev's
 * `webScrapeMd({ useMainContentOnly: true })`.
 *
 * Readability picks the main content; if it returns too little (common on
 * homepages and landing pages) we fall back to <main>/<article>, then <body>.
 */
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import TurndownService from "turndown";

const turndown = new TurndownService({
  headingStyle: "atx",
  bulletListMarker: "-",
  codeBlockStyle: "fenced",
});
const DROPPED_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "IFRAME", "SVG", "FORM"]);
turndown.remove((node) => DROPPED_TAGS.has(node.nodeName.toUpperCase()));

export function htmlToMainMarkdown(html: string): string {
  if (!html.trim()) return "";
  try {
    return turndown
      .turndown(extractMainHtml(html))
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  } catch {
    return "";
  }
}

function extractMainHtml(html: string): string {
  const bodyWords = wordCount(parseHTML(html).document.body?.textContent);

  try {
    // Readability mutates the document, so give it its own copy.
    const { document } = parseHTML(html);
    const article = new Readability(document as unknown as Document).parse();
    if (
      article?.content &&
      wordCount(article.textContent) >= Math.max(50, bodyWords * 0.25)
    ) {
      return article.content;
    }
  } catch {
    // Fall through to structural fallbacks.
  }

  const { document } = parseHTML(html);
  const main = document.querySelector("main, [role=main], article");
  if (main && wordCount(main.textContent) >= 50) return main.innerHTML;
  return document.body?.innerHTML ?? html;
}

function wordCount(text: string | null | undefined): number {
  return text?.trim().split(/\s+/).filter(Boolean).length ?? 0;
}
```

- [ ] **Step 5: Run** `npm test -- tests/extract.test.ts` — Expected: all pass. If turndown emits `-   Starter` (3 spaces) the `\s+` in the regex already covers it.

- [ ] **Step 6: Commit**

```bash
git add lib/extract.ts tests/extract.test.ts tests/fixtures/article.html
git commit -m "feat: extract main-content markdown locally with Readability and Turndown"
```

---

### Task 4: Site files and PageSpeed clients

**Files:**
- Create: `lib/site-files.ts`, `lib/pagespeed.ts`, `tests/site-files.test.ts`, `tests/pagespeed.test.ts`

**Interfaces:**
- Consumes: `safeFetch`, `FetchResult` from Task 2.
- Produces:
  - `type LlmsTxtInfo = { status: number; contentType: string; body: string } | null`
  - `type SitemapInfo = { declared: boolean; url: string | null; found: boolean }`
  - `type SiteFiles = { robotsTxt: string | null; llmsTxt: LlmsTxtInfo; sitemap: SitemapInfo }`
  - `fetchSiteFiles(pageUrl: URL): Promise<SiteFiles>` (never throws)
  - `parseSitemapDirectives(robotsTxt: string): string[]`, `isSitemapXml(body: string): boolean`, `looksLikeHtml(file: { contentType: string; body: string }): boolean`
  - `type PageSpeedResult = { performanceScore: number; lcpMs: number | null; cls: number | null; tbtMs: number | null }`
  - `fetchPageSpeed(url: string, apiKey?: string, timeoutMs?: number): Promise<PageSpeedResult | null>` (never throws)
  - `parsePageSpeed(json: unknown): PageSpeedResult | null`, `pageSpeedReportUrl(url: string): string`

- [ ] **Step 1: Write failing tests** — `tests/site-files.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  isSitemapXml,
  looksLikeHtml,
  parseSitemapDirectives,
} from "@/lib/site-files";

describe("parseSitemapDirectives", () => {
  it("reads Sitemap lines case-insensitively", () => {
    const robots =
      "User-agent: *\nDisallow: /admin\nSitemap: https://a.com/sitemap.xml\nsitemap:https://a.com/news.xml\n";
    expect(parseSitemapDirectives(robots)).toEqual([
      "https://a.com/sitemap.xml",
      "https://a.com/news.xml",
    ]);
  });

  it("returns [] when none declared", () => {
    expect(parseSitemapDirectives("User-agent: *\nAllow: /")).toEqual([]);
  });
});

describe("isSitemapXml", () => {
  it("accepts urlset and sitemapindex", () => {
    expect(isSitemapXml('<?xml version="1.0"?><urlset xmlns="x">')).toBe(true);
    expect(isSitemapXml("<sitemapindex>")).toBe(true);
  });

  it("rejects HTML", () => {
    expect(isSitemapXml("<!doctype html><html>")).toBe(false);
  });
});

describe("looksLikeHtml", () => {
  it("detects by content type or body", () => {
    expect(looksLikeHtml({ contentType: "text/html", body: "# hi" })).toBe(true);
    expect(looksLikeHtml({ contentType: "", body: "<!DOCTYPE html><html>" })).toBe(true);
    expect(looksLikeHtml({ contentType: "text/plain", body: "# Acme\n" })).toBe(false);
  });
});
```

`tests/pagespeed.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { pageSpeedReportUrl, parsePageSpeed } from "@/lib/pagespeed";

describe("parsePageSpeed", () => {
  it("extracts score and core metrics", () => {
    const json = {
      lighthouseResult: {
        categories: { performance: { score: 0.87 } },
        audits: {
          "largest-contentful-paint": { numericValue: 2300.4 },
          "cumulative-layout-shift": { numericValue: 0.04 },
          "total-blocking-time": { numericValue: 180 },
        },
      },
    };
    expect(parsePageSpeed(json)).toEqual({
      performanceScore: 87,
      lcpMs: 2300.4,
      cls: 0.04,
      tbtMs: 180,
    });
  });

  it("returns null without a performance score", () => {
    expect(parsePageSpeed({ error: { code: 429 } })).toBeNull();
  });

  it("builds a report link", () => {
    expect(pageSpeedReportUrl("https://a.com/x")).toBe(
      "https://pagespeed.web.dev/analysis?url=https%3A%2F%2Fa.com%2Fx&form_factor=mobile",
    );
  });
});
```

- [ ] **Step 2: Run** `npm test -- tests/site-files.test.ts tests/pagespeed.test.ts` — Expected: FAIL, modules not found.

- [ ] **Step 3: Implement `lib/site-files.ts`**

```ts
/**
 * Site-level files that AI crawlers read before the page itself.
 * Missing files are data (they become failing checks), never errors.
 */
import { safeFetch, type FetchResult } from "@/lib/net/safe-fetch";

export type LlmsTxtInfo = {
  status: number;
  contentType: string;
  body: string;
} | null;

export type SitemapInfo = {
  /** robots.txt declared at least one Sitemap: URL. */
  declared: boolean;
  url: string | null;
  found: boolean;
};

export type SiteFiles = {
  robotsTxt: string | null;
  llmsTxt: LlmsTxtInfo;
  sitemap: SitemapInfo;
};

const FILE_OPTIONS = {
  timeoutMs: 6_000,
  maxBytes: 1_000_000,
  truncate: true,
  accept: "text/plain,text/markdown,application/xml,text/xml;q=0.9,*/*;q=0.5",
};

export async function fetchSiteFiles(pageUrl: URL): Promise<SiteFiles> {
  const origin = pageUrl.origin;
  const [robots, llms] = await Promise.all([
    tryFetch(`${origin}/robots.txt`),
    tryFetch(`${origin}/llms.txt`),
  ]);

  const robotsTxt =
    robots && robots.status === 200 && !looksLikeHtml(robots)
      ? robots.body
      : null;
  const llmsTxt: LlmsTxtInfo = llms
    ? {
        status: llms.status,
        contentType: llms.contentType,
        body: llms.body.slice(0, 20_000),
      }
    : null;

  return { robotsTxt, llmsTxt, sitemap: await findSitemap(origin, robotsTxt) };
}

export function parseSitemapDirectives(robotsTxt: string): string[] {
  return robotsTxt
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*sitemap\s*:\s*(\S+)/i)?.[1])
    .filter((value): value is string => Boolean(value));
}

export function isSitemapXml(body: string): boolean {
  return /<(urlset|sitemapindex)\b/i.test(body);
}

export function looksLikeHtml(file: {
  contentType: string;
  body: string;
}): boolean {
  return (
    /text\/html/i.test(file.contentType) ||
    /^\s*(<!doctype html|<html)/i.test(file.body)
  );
}

async function findSitemap(
  origin: string,
  robotsTxt: string | null,
): Promise<SitemapInfo> {
  const declaredUrls = robotsTxt ? parseSitemapDirectives(robotsTxt) : [];
  const candidates = declaredUrls.length
    ? declaredUrls.slice(0, 2)
    : [`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`];

  for (const url of candidates) {
    const result = await tryFetch(url);
    if (
      result?.status === 200 &&
      (isSitemapXml(result.body) || /\.gz$/i.test(url))
    ) {
      return { declared: declaredUrls.length > 0, url, found: true };
    }
  }
  return {
    declared: declaredUrls.length > 0,
    url: candidates[0] ?? null,
    found: false,
  };
}

async function tryFetch(url: string): Promise<FetchResult | null> {
  try {
    return await safeFetch(url, FILE_OPTIONS);
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Implement `lib/pagespeed.ts`**

```ts
/**
 * Google PageSpeed Insights (Lighthouse, mobile). Free; an optional API key
 * raises the quota. Failures return null so the audit still completes.
 */
export type PageSpeedResult = {
  /** 0–100 Lighthouse performance score. */
  performanceScore: number;
  lcpMs: number | null;
  cls: number | null;
  tbtMs: number | null;
};

const PSI_ENDPOINT =
  "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";

export function pageSpeedReportUrl(url: string): string {
  return `https://pagespeed.web.dev/analysis?url=${encodeURIComponent(url)}&form_factor=mobile`;
}

export async function fetchPageSpeed(
  url: string,
  apiKey?: string,
  timeoutMs = 45_000,
): Promise<PageSpeedResult | null> {
  const params = new URLSearchParams({
    url,
    strategy: "mobile",
    category: "performance",
  });
  if (apiKey) params.set("key", apiKey);

  try {
    const response = await fetch(`${PSI_ENDPOINT}?${params}`, {
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
    if (!response.ok) return null;
    return parsePageSpeed(await response.json());
  } catch {
    return null;
  }
}

type LighthouseJson = {
  lighthouseResult?: {
    categories?: { performance?: { score?: unknown } };
    audits?: Record<string, { numericValue?: unknown } | undefined>;
  };
};

export function parsePageSpeed(json: unknown): PageSpeedResult | null {
  const lighthouse = (json as LighthouseJson | null)?.lighthouseResult;
  const score = lighthouse?.categories?.performance?.score;
  if (typeof score !== "number") return null;

  const metric = (id: string): number | null => {
    const value = lighthouse?.audits?.[id]?.numericValue;
    return typeof value === "number" ? value : null;
  };

  return {
    performanceScore: Math.round(score * 100),
    lcpMs: metric("largest-contentful-paint"),
    cls: metric("cumulative-layout-shift"),
    tbtMs: metric("total-blocking-time"),
  };
}
```

- [ ] **Step 5: Run** `npm test -- tests/site-files.test.ts tests/pagespeed.test.ts` — Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add lib/site-files.ts lib/pagespeed.ts tests/site-files.test.ts tests/pagespeed.test.ts
git commit -m "feat: fetch robots.txt, llms.txt, sitemap and PageSpeed Insights data"
```

---

### Task 5: Audit pipeline on direct fetching

Replaces context.dev in `lib/audit.ts`, splits network from pure scoring, adds the new context fields, and redistributes weight from fully-N/A categories. No new rules yet; the existing 32 rules must keep working.

**Files:**
- Modify: `lib/audit.ts`, `lib/rules.ts` (types + A8 evidence only), `lib/audit-types.ts`
- Create: `tests/helpers/sources.ts`, `tests/audit.test.ts`

**Interfaces:**
- Consumes: Tasks 2–4.
- Produces (used by Tasks 6–7):
  - `type PageSources = { requestedUrl: string; page: FetchResult; site: SiteFiles; pageSpeed: PageSpeedResult | null }`
  - `runAudit(normalizedUrl: string, options?: { pageSpeedApiKey?: string }): Promise<AuditResult>`
  - `fetchPageSources(normalizedUrl, options?): Promise<PageSources>`
  - `assertAuditablePage(page: FetchResult): void` — throws `FetchError` `blocked` / `http-error` / `not-html`
  - `auditFromSources(sources: PageSources): AuditResult` (pure)
  - New `RuleContext` fields: `httpStatus: number; redirects: number; robotsTxt: string | null; llmsTxt: LlmsTxtInfo; sitemap: SitemapInfo; pageSpeed: PageSpeedResult | null; htmlLang: string | null; viewport: string | null; openGraph: { title: boolean; description: boolean; image: boolean }; twitterCard: boolean; images: { total: number; withAlt: number }`
  - `makeSources(overrides?)` and `statusOf(audit, id)` test helpers.

- [ ] **Step 1: Test helpers** — `tests/helpers/sources.ts`:

```ts
import { readFileSync } from "node:fs";

import type { PageSources } from "@/lib/audit";
import type { AuditResult, AuditStatus } from "@/lib/audit-types";
import type { PageSpeedResult } from "@/lib/pagespeed";
import type { LlmsTxtInfo, SitemapInfo } from "@/lib/site-files";

export const ARTICLE_HTML = readFileSync(
  new URL("../fixtures/article.html", import.meta.url),
  "utf8",
);

export const GOOD_PAGESPEED: PageSpeedResult = {
  performanceScore: 95,
  lcpMs: 1800,
  cls: 0.02,
  tbtMs: 120,
};

type Overrides = {
  url?: string;
  html?: string;
  status?: number;
  redirects?: number;
  robotsTxt?: string | null;
  llmsTxt?: LlmsTxtInfo;
  sitemap?: Partial<SitemapInfo>;
  pageSpeed?: PageSpeedResult | null;
};

export function makeSources(overrides: Overrides = {}): PageSources {
  const url = overrides.url ?? "https://acme.com/blog/what-is-a-widget/";
  return {
    requestedUrl: url,
    page: {
      finalUrl: url,
      status: overrides.status ?? 200,
      contentType: "text/html; charset=utf-8",
      body: overrides.html ?? ARTICLE_HTML,
      redirects: overrides.redirects ?? 0,
    },
    site: {
      robotsTxt:
        overrides.robotsTxt === undefined
          ? "User-agent: *\nAllow: /\nSitemap: https://acme.com/sitemap.xml\n"
          : overrides.robotsTxt,
      llmsTxt:
        overrides.llmsTxt === undefined
          ? { status: 200, contentType: "text/plain", body: "# Acme\n\n> Widgets.\n" }
          : overrides.llmsTxt,
      sitemap: {
        declared: true,
        url: "https://acme.com/sitemap.xml",
        found: true,
        ...overrides.sitemap,
      },
    },
    pageSpeed:
      overrides.pageSpeed === undefined ? GOOD_PAGESPEED : overrides.pageSpeed,
  };
}

export function statusOf(audit: AuditResult, id: string): AuditStatus {
  const item = audit.categories
    .flatMap((c) => c.items)
    .find((i) => i.id === id);
  if (!item) throw new Error(`No audit item ${id}`);
  return item.status;
}
```

- [ ] **Step 2: Write failing tests** — `tests/audit.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { assertAuditablePage, auditFromSources } from "@/lib/audit";
import { FetchError } from "@/lib/net/safe-fetch";

import { makeSources, statusOf } from "./helpers/sources";

describe("auditFromSources", () => {
  const audit = auditFromSources(makeSources());

  it("scores a well-built article highly", () => {
    expect(audit.score).toBeGreaterThan(70);
  });

  it("category maxima sum to 100", () => {
    const total = audit.categories.reduce((s, c) => s + c.maxScore, 0);
    expect(total).toBeCloseTo(100, 0);
  });

  it("keeps existing rules working on direct-fetched HTML", () => {
    for (const id of ["A1", "A11", "A12", "B2", "B5", "B14", "C1", "C2", "C3", "C5"]) {
      expect([id, statusOf(audit, id)]).toEqual([id, "pass"]);
    }
  });

  it("reports diagnostics", () => {
    expect(audit.diagnostics).toMatchObject({
      httpStatus: 200,
      redirects: 0,
      markdownExtract: "ready",
      robotsTxt: "found",
      llmsTxt: "found",
      sitemap: "found",
      pageSpeed: "ready",
    });
  });

  it("uses the final URL for crawlability checks", () => {
    const http = auditFromSources(
      makeSources({ url: "http://acme.com/blog/what-is-a-widget/" }),
    );
    expect(statusOf(http, "A1")).toBe("fail");
  });
});

describe("assertAuditablePage", () => {
  const page = (status: number, contentType = "text/html", body = "<html>") => ({
    finalUrl: "https://a.com/",
    status,
    contentType,
    body,
    redirects: 0,
  });

  it.each([
    [403, "blocked"],
    [429, "blocked"],
    [404, "http-error"],
    [500, "http-error"],
  ])("HTTP %i → %s", (status, code) => {
    expect(() => assertAuditablePage(page(status))).toThrow(FetchError);
    try {
      assertAuditablePage(page(status));
    } catch (error) {
      expect((error as FetchError).code).toBe(code);
    }
  });

  it("rejects non-HTML", () => {
    expect(() =>
      assertAuditablePage(page(200, "application/pdf", "%PDF-1.7")),
    ).toThrow(/HTML/);
  });

  it("accepts HTML", () => {
    expect(() => assertAuditablePage(page(200))).not.toThrow();
  });
});
```

- [ ] **Step 3: Run** `npm test -- tests/audit.test.ts` — Expected: FAIL (`auditFromSources` not exported).

- [ ] **Step 4: Extend types in `lib/rules.ts`**

Add after the existing `import type { AuditStatus }` line:

```ts
import type { PageSpeedResult } from "@/lib/pagespeed";
import type { LlmsTxtInfo, SitemapInfo } from "@/lib/site-files";
```

Extend `RuleDependency` with:

```ts
  | "http"
  | "robots-txt"
  | "llms-txt"
  | "sitemap"
  | "meta"
  | "images"
  | "pagespeed"
```

Add to `RuleContext` after `hasByline: boolean;`:

```ts

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
```

In rule `A8`, replace the evidence line with:

```ts
        evidence: `${htmlWords} readable words were found in the raw HTML; ${ctx.words} words were extracted as main content.`,
```

- [ ] **Step 5: Update `lib/audit-types.ts`** — replace the `diagnostics` block in `AuditResult` and the `AuditApiResponse` type:

```ts
  diagnostics: {
    httpStatus: number;
    redirects: number;
    markdownExtract: "ready" | "empty";
    robotsTxt: "found" | "missing";
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
```

- [ ] **Step 6: Rewrite the top of `lib/audit.ts`** — replace lines 1–192 (header comment through the end of `buildContext`) with:

```ts
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
```

- [ ] **Step 7: Replace scoring in `lib/audit.ts`** — replace `scoreCategories` and `scoreCategory` (the block between the "Scoring" banner and `function scoreBand`) with:

```ts
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
```

- [ ] **Step 8: Remove context.dev fetch helpers and add new parsers** — in `lib/audit.ts`, delete the "Fetch helpers: context.dev only" banner and the `scrapeMarkdown` / `scrapeHtml` functions. Add after `detectNoIndex`:

```ts
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
```

- [ ] **Step 9: Run** `npm test` — Expected: all tests pass. `npm run typecheck` will still fail in `lib/perform-audit.ts`, `lib/brand.ts`, and the UI (fixed in Task 7); confirm the only errors are in those files:

```bash
npx tsc --noEmit 2>&1 | grep -E "^[a-z]" | cut -d'(' -f1 | sort -u
```

Expected files: `app/api/audit/route.ts`, `app/audit/[domain]/page.tsx`, `components/audit-results-view.tsx`, `lib/perform-audit.ts`.

- [ ] **Step 10: Commit**

```bash
git add lib/audit.ts lib/rules.ts lib/audit-types.ts tests/helpers/sources.ts tests/audit.test.ts
git commit -m "feat: run audits on directly fetched HTML instead of context.dev

Split network access (fetchPageSources) from pure scoring
(auditFromSources), add robots/llms/sitemap/PageSpeed and classic SEO
fields to RuleContext, and redistribute weight from fully N/A categories."
```

---

### Task 6: New checks and weights

**Files:**
- Modify: `lib/rules.ts`
- Create: `tests/rules.test.ts`

**Interfaces:**
- Consumes: `RuleContext` fields from Task 5; `looksLikeHtml` from Task 4.
- Produces: categories `G` ("Classic SEO") and `H` ("Performance"); rules `A13`, `A14`, `A15`, `G1`–`G7`, `H1`–`H4`; exported `AI_SEARCH_CRAWLERS`, `AI_TRAINING_CRAWLERS`, `blockedAiCrawlers(robotsTxt: string, pageUrl: string): { search: string[]; training: string[] }`.

- [ ] **Step 1: Write failing tests** — `tests/rules.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { auditFromSources } from "@/lib/audit";
import { CATEGORIES, blockedAiCrawlers } from "@/lib/rules";

import { ARTICLE_HTML, makeSources, statusOf } from "./helpers/sources";

const run = (overrides: Parameters<typeof makeSources>[0] = {}) =>
  auditFromSources(makeSources(overrides));

const withHead = (head: string, body = "<p>Hello</p>") =>
  `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;

describe("category weights", () => {
  it("sum to 100", () => {
    expect(CATEGORIES.reduce((s, c) => s + c.maxScore, 0)).toBe(100);
  });
});

describe("A13 AI crawler access", () => {
  const url = "https://acme.com/blog/x";

  it("detects blocked search and training bots", () => {
    const robots =
      "User-agent: GPTBot\nDisallow: /\n\nUser-agent: PerplexityBot\nDisallow: /blog/\n\nUser-agent: *\nAllow: /\n";
    expect(blockedAiCrawlers(robots, url)).toEqual({
      search: ["PerplexityBot"],
      training: ["GPTBot"],
    });
  });

  it("passes when nothing is blocked or robots.txt is missing", () => {
    expect(statusOf(run(), "A13")).toBe("pass");
    expect(statusOf(run({ robotsTxt: null }), "A13")).toBe("pass");
  });

  it("is partial when only training bots are blocked", () => {
    const robots = "User-agent: GPTBot\nDisallow: /\n\nUser-agent: Google-Extended\nDisallow: /\n";
    expect(statusOf(run({ robotsTxt: robots }), "A13")).toBe("partial");
  });

  it("fails when an answer bot is blocked", () => {
    const robots = "User-agent: OAI-SearchBot\nDisallow: /\n";
    expect(statusOf(run({ robotsTxt: robots }), "A13")).toBe("fail");
  });

  it("fails when everything is blocked", () => {
    expect(statusOf(run({ robotsTxt: "User-agent: *\nDisallow: /\n" }), "A13")).toBe("fail");
  });
});

describe("A14 llms.txt", () => {
  it("passes for a markdown llms.txt", () => {
    expect(statusOf(run(), "A14")).toBe("pass");
  });

  it("is partial for plain text without a heading", () => {
    const llmsTxt = { status: 200, contentType: "text/plain", body: "acme widgets" };
    expect(statusOf(run({ llmsTxt }), "A14")).toBe("partial");
  });

  it("fails for an HTML catch-all page", () => {
    const llmsTxt = { status: 200, contentType: "text/html", body: "<!doctype html><html>" };
    expect(statusOf(run({ llmsTxt }), "A14")).toBe("fail");
  });

  it("fails when missing", () => {
    const llmsTxt = { status: 404, contentType: "text/html", body: "" };
    expect(statusOf(run({ llmsTxt }), "A14")).toBe("fail");
    expect(statusOf(run({ llmsTxt: null }), "A14")).toBe("fail");
  });
});

describe("A15 redirects", () => {
  it("passes with at most one redirect", () => {
    expect(statusOf(run({ redirects: 1 }), "A15")).toBe("pass");
  });

  it("is partial for redirect chains", () => {
    expect(statusOf(run({ redirects: 3 }), "A15")).toBe("partial");
  });
});

describe("G classic SEO", () => {
  it("passes the article fixture", () => {
    const audit = run();
    for (const id of ["G1", "G2", "G3", "G4", "G5", "G6", "G7"]) {
      expect([id, statusOf(audit, id)]).toEqual([id, "pass"]);
    }
  });

  it("G1 title length", () => {
    expect(statusOf(run({ html: withHead("<title>Short title here</title>") }), "G1")).toBe("partial");
    expect(statusOf(run({ html: withHead("") }), "G1")).toBe("fail");
  });

  it("G2 meta description", () => {
    expect(
      statusOf(run({ html: withHead('<meta name="description" content="Too short.">') }), "G2"),
    ).toBe("partial");
    expect(statusOf(run({ html: withHead("") }), "G2")).toBe("fail");
  });

  it("G3 alt text", () => {
    const body = '<img src="a"><img src="b"><img src="c" alt="c">';
    expect(statusOf(run({ html: withHead("", body) }), "G3")).toBe("fail");
    expect(statusOf(run({ html: withHead("") }), "G3")).toBe("na");
  });

  it("G4 social tags", () => {
    expect(
      statusOf(run({ html: withHead('<meta property="og:title" content="x">') }), "G4"),
    ).toBe("partial");
    expect(statusOf(run({ html: withHead("") }), "G4")).toBe("fail");
  });

  it("G5 viewport and G6 lang", () => {
    const audit = run({ html: withHead('<meta name="viewport" content="initial-scale=1">') });
    expect(statusOf(audit, "G5")).toBe("partial");
    expect(statusOf(audit, "G6")).toBe("fail");
  });

  it("G7 sitemap", () => {
    expect(statusOf(run({ sitemap: { found: false, declared: true } }), "G7")).toBe("partial");
    expect(statusOf(run({ sitemap: { found: false, declared: false } }), "G7")).toBe("fail");
  });
});

describe("H performance", () => {
  it("passes good metrics", () => {
    const audit = run();
    for (const id of ["H1", "H2", "H3", "H4"]) {
      expect([id, statusOf(audit, id)]).toEqual([id, "pass"]);
    }
  });

  it("grades slow pages", () => {
    const audit = run({
      pageSpeed: { performanceScore: 42, lcpMs: 3500, cls: 0.3, tbtMs: 700 },
    });
    expect(statusOf(audit, "H1")).toBe("fail");
    expect(statusOf(audit, "H2")).toBe("partial");
    expect(statusOf(audit, "H3")).toBe("fail");
    expect(statusOf(audit, "H4")).toBe("fail");
  });

  it("is N/A without PageSpeed and redistributes its weight", () => {
    const audit = run({ pageSpeed: null });
    const h = audit.categories.find((c) => c.id === "H")!;
    expect(h.maxScore).toBe(0);
    expect(h.items.every((i) => i.status === "na")).toBe(true);
    const total = audit.categories.reduce((s, c) => s + c.maxScore, 0);
    expect(total).toBeCloseTo(100, 0);
  });
});

describe("fixture sanity", () => {
  it("fixture has images with alt", () => {
    expect(ARTICLE_HTML).toContain('alt="Widget diagram"');
  });
});
```

- [ ] **Step 2: Run** `npm test -- tests/rules.test.ts` — Expected: FAIL (`blockedAiCrawlers` missing, weights ≠ 100, no G/H items).

- [ ] **Step 3: Update `CATEGORIES` in `lib/rules.ts`** — set `maxScore` to A 24, B 22, C 13, D 13, E 6, F 2, and append:

```ts
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
```

- [ ] **Step 4: Add imports and crawler helpers in `lib/rules.ts`** — after the existing imports:

```ts
import robotsParser from "robots-parser";

import { looksLikeHtml } from "@/lib/site-files";
```

After the `CATEGORIES` array:

```ts
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
```

- [ ] **Step 5: Add A13–A15 to `RULES`** — after rule `A12`:

```ts
  {
    id: "A13",
    categoryId: "A",
    label: "AI answer and search crawlers are allowed by robots.txt.",
    recommendation:
      "Allow OAI-SearchBot, ChatGPT-User, Claude-SearchBot, Claude-User, PerplexityBot, and Perplexity-User in robots.txt. Blocking training bots (GPTBot, ClaudeBot, Google-Extended) is optional, but blocking answer bots removes you from AI answers.",
    dependencies: ["robots-txt", "url"],
    multiplier: 2,
    evaluate: (ctx) => {
      if (!ctx.robotsTxt) {
        return {
          status: "pass",
          evidence: "No robots.txt was found, so AI crawlers are not blocked.",
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
      if (looksLikeHtml(file)) {
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
          ? "/llms.txt exists and starts with a Markdown heading."
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
```

- [ ] **Step 6: Add G and H rules to `RULES`** — after rule `F6` (end of the array, before `];`):

```ts

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
      metricRule(ctx.pageSpeed?.performanceScore ?? null, (score) => ({
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
      metricRule(ctx.pageSpeed?.lcpMs ?? null, (ms) => ({
        status: lowerIsBetter(ms, 2500, 4000),
        evidence: `Largest Contentful Paint is ${(ms / 1000).toFixed(1)}s.`,
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
      metricRule(ctx.pageSpeed?.cls ?? null, (cls) => ({
        status: lowerIsBetter(cls, 0.1, 0.25),
        evidence: `Cumulative Layout Shift is ${cls.toFixed(2)}.`,
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
      metricRule(ctx.pageSpeed?.tbtMs ?? null, (ms) => ({
        status: lowerIsBetter(ms, 200, 600),
        evidence: `Total Blocking Time is ${Math.round(ms)}ms.`,
      })),
  },
```

- [ ] **Step 7: Add helpers** — in the helpers section of `lib/rules.ts` (after `clip`):

```ts
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
  value: number | null,
  grade: (value: number) => RuleEvaluation,
): RuleEvaluation {
  return value === null
    ? {
        status: "na",
        evidence:
          "PageSpeed Insights was unavailable for this audit. Re-run the audit or open the report link in diagnostics.",
      }
    : grade(value);
}
```

- [ ] **Step 8: Run** `npm test` — Expected: all pass. If `robots-parser` default import fails under Vitest, use `import robotsParser = require("robots-parser")` is NOT allowed in ESM; instead check `node_modules/robots-parser/index.d.ts` export shape and adjust the import.

- [ ] **Step 9: Commit**

```bash
git add lib/rules.ts tests/rules.test.ts
git commit -m "feat: add AI crawler, llms.txt, redirect, classic SEO and PageSpeed checks

New rules A13-A15, G1-G7, H1-H4 and categories G (Classic SEO) and
H (Performance). Rebalance category weights to A24 B22 C13 D13 E6 F2
G12 H8."
```

---

### Task 7: Wire the app and remove context.dev / Turso

**Files:**
- Modify: `lib/perform-audit.ts`, `app/api/audit/route.ts`, `app/audit/[domain]/page.tsx`, `components/audit-results-view.tsx`, `.env.example`, `package.json`
- Delete: `lib/brand.ts`, `lib/brand-types.ts`, `lib/turso.ts`
- Create: `tests/perform-audit.test.ts`

**Interfaces:**
- Consumes: `runAudit`, `FetchError`.
- Produces: `performAudit(rawUrl: string): Promise<{ status: "ready"; audit: AuditResult; domain: string } | { status: "error"; message: string }>`, `INVALID_DOMAIN_MESSAGE`.

- [ ] **Step 1: Write failing test** — `tests/perform-audit.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { INVALID_DOMAIN_MESSAGE, performAudit } from "@/lib/perform-audit";

describe("performAudit", () => {
  it("rejects invalid input without fetching", async () => {
    expect(await performAudit("not a url")).toEqual({
      status: "error",
      message: INVALID_DOMAIN_MESSAGE,
    });
  });

  it("returns friendly fetch errors", async () => {
    const result = await performAudit("http://169.254.169.254/latest");
    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.message).toMatch(/private or internal network/);
    }
  });
});
```

Note: `normalizeAuditUrl("http://169.254.169.254/latest")` keeps the IP host (it contains dots), so the SSRF guard is what rejects it.

- [ ] **Step 2: Run** `npm test -- tests/perform-audit.test.ts` — Expected: FAIL (perform-audit still imports turso / requires CONTEXT_DEV_API_KEY).

- [ ] **Step 3: Replace `lib/perform-audit.ts`**

```ts
import { runAudit } from "@/lib/audit";
import type { AuditResult } from "@/lib/audit-types";
import { FetchError } from "@/lib/net/safe-fetch";
import { displayHost, normalizeAuditUrl } from "@/lib/url";

export type PerformAuditResult =
  | { status: "ready"; audit: AuditResult; domain: string }
  | { status: "error"; message: string };

export const INVALID_DOMAIN_MESSAGE = "Enter a valid URL.";

export async function performAudit(
  rawUrl: string,
): Promise<PerformAuditResult> {
  const url = normalizeAuditUrl(rawUrl);
  if (!url) return { status: "error", message: INVALID_DOMAIN_MESSAGE };

  try {
    const audit = await runAudit(url, {
      pageSpeedApiKey: process.env.PAGESPEED_API_KEY || undefined,
    });
    return { status: "ready", audit, domain: displayHost(url) };
  } catch (error) {
    if (error instanceof FetchError) {
      return { status: "error", message: error.message };
    }
    console.error("Audit failed", url, error);
    return { status: "error", message: "Audit failed. Please try again." };
  }
}
```

- [ ] **Step 4: Replace `respond` and handlers in `app/api/audit/route.ts`** — drop `refresh`/`cached`/`missing-env`; keep the CDN cache headers (they give free edge caching per URL):

```ts
export async function GET(req: NextRequest) {
  const searchParams = req.nextUrl.searchParams;
  return respond(searchParams.get("url") ?? searchParams.get("domain") ?? "");
}

export async function POST(req: NextRequest) {
  let body: { url?: string; domain?: string };
  try {
    body = (await req.json()) as { url?: string; domain?: string };
  } catch {
    return NextResponse.json(
      { status: "error", message: "Invalid JSON body." } satisfies AuditApiResponse,
      { status: 400 },
    );
  }
  return respond(body.url ?? body.domain ?? "");
}

async function respond(rawUrl: string) {
  const result = await performAudit(rawUrl);

  if (result.status === "ready") {
    const payload: AuditApiResponse = { status: "ready", audit: result.audit };
    return NextResponse.json(payload, { headers: CACHE_HEADERS });
  }

  const status = result.message === INVALID_DOMAIN_MESSAGE ? 400 : 502;
  const payload: AuditApiResponse = { status: "error", message: result.message };
  return NextResponse.json(payload, { status });
}
```

- [ ] **Step 5: Update `app/audit/[domain]/page.tsx`**
  - Remove `import { fetchBrand } from "@/lib/brand";`.
  - Change the `siteUrl` fallback to `"http://localhost:3000"`.
  - In `generateMetadata`, set `title` to `` `${decoded} | AEO & SEO Score` `` and `description` to `` `See how ${decoded} scores for ChatGPT, Claude, Perplexity, and Google. Free AEO and SEO audit covering AI crawler access, llms.txt, schema, content structure, classic SEO, and page speed, with a copy-paste fix prompt.` ``.
  - Replace the body of `AuditPage` from `const forceRefresh` through the `missing-env` block with:

```tsx
  const auditTarget = resolveAuditUrl(decoded, urlParam);
  const result = await performAudit(auditTarget);
```

  - Remove `refresh` from the `searchParams` destructure and the `PageProps` type (`searchParams: Promise<{ url?: string }>`).
  - Replace both `"AI SEO Audit"` strings in the schemas with `"AEO Checker"`, and `` `AI SEO Audit | ${decoded}` `` with `` `AEO Checker | ${decoded}` ``; description `` `AEO and SEO audit and 0–100 score for ${decoded}.` ``.
  - Remove the `if (result.updatedAt)` block.
  - Render `<AuditResultsView audit={result.audit} />`.

- [ ] **Step 6: Update `components/audit-results-view.tsx`**
  - Remove the `@/lib/brand` and `@/lib/brand-types` imports, `CONTEXT_DEV_ENDPOINTS`, and `contextDevHref` (grep the file first for other uses of `contextDevHref` / `CONTEXT_DEV_ENDPOINTS` and delete those JSX blocks too).
  - Props become `type AuditResultsViewProps = { audit: AuditResult };` and the component signature `export function AuditResultsView({ audit }: AuditResultsViewProps)`.
  - Top strip: replace the cached/updatedAt/re-run cluster with:

```tsx
          <div className="flex flex-wrap items-center gap-3 font-mono text-xs uppercase tracking-[0.18em] text-muted">
            <time dateTime={audit.fetchedAt}>
              {formatTimestamp(Date.parse(audit.fetchedAt))}
            </time>
            <span className="text-ink/40">·</span>
            <button
              type="button"
              disabled={refreshing}
              onClick={reRunAudit}
              className="underline decoration-ink/20 decoration-1 underline-offset-4 transition hover:text-teal hover:decoration-teal disabled:opacity-50"
            >
              {refreshing ? "re-running..." : "re-run audit"}
            </button>
          </div>
```

  - `reRunAudit` becomes `setRefreshing(true); window.location.reload();`.
  - Hero: delete the logo `<div>`, the `brand?.slogan` block and the `brand?.industries` block; the `<h1>` content becomes `{audit.title ?? audit.host}`.
  - Diagnostics `<dl>`: replace the three rows with:

```tsx
            <DiagnosticRow label="HTTP status" value={audit.diagnostics.httpStatus} />
            <DiagnosticRow label="Redirects" value={audit.diagnostics.redirects} />
            <DiagnosticRow label="Main-content extract" value={audit.diagnostics.markdownExtract} />
            <DiagnosticRow label="robots.txt" value={audit.diagnostics.robotsTxt} />
            <DiagnosticRow label="llms.txt" value={audit.diagnostics.llmsTxt} />
            <DiagnosticRow label="Sitemap" value={audit.diagnostics.sitemap} />
            <DiagnosticRow label="PageSpeed Insights" value={audit.diagnostics.pageSpeed} />
            <DiagnosticRow label="JSON-LD parse failures" value={audit.diagnostics.jsonLdParseFailures} />
```

    Below the `<dl>` (inside the same grid cell — wrap `<dl>` and link in a `<div>`), add:

```tsx
            <a
              href={audit.diagnostics.pageSpeedReportUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-4 inline-flex items-center gap-1.5 font-mono text-xs uppercase tracking-[0.18em] text-muted transition hover:text-ink"
            >
              Full PageSpeed report <ExternalLink className="size-3.5" />
            </a>
```

    Check `DiagnosticRow`'s `value` prop type accepts `string | number`; widen it if not.
  - `CategorySection`: guard the percent for fully N/A categories:

```tsx
  const percent =
    category.maxScore > 0
      ? Math.round((category.score / category.maxScore) * 100)
      : null;
```

    and render `{percent === null ? "n/a" : `${percent}%`}` where `{percent}%` was. Update any progress bar width to `${percent ?? 0}%`. When `percent === null` and `category.id === "H"`, render under the description:

```tsx
          {percent === null && category.id === "H" ? (
            <p className="mt-3 text-sm/6 text-muted">
              Performance data was unavailable for this run. Re-run the audit,
              or open the full PageSpeed report from the diagnostics section.
            </p>
          ) : null}
```

- [ ] **Step 7: Delete context.dev / Turso code and deps**

```bash
git rm lib/brand.ts lib/brand-types.ts lib/turso.ts
npm uninstall context.dev @libsql/client
```

- [ ] **Step 8: Replace `.env.example`**

```bash
# Public URL of this deployment (used for metadata, sitemap, robots).
NEXT_PUBLIC_SITE_URL=http://localhost:3000

# Optional: free Google API key for PageSpeed Insights. Raises the quota.
# https://developers.google.com/speed/docs/insights/v5/get-started
PAGESPEED_API_KEY=
```

- [ ] **Step 9: Verify** — run, in one command:

```bash
npm test && npm run typecheck && npm run lint && npm run build
```

Expected: all green. `grep -rn "context\.dev\|CONTEXT_DEV\|turso" app components lib` returns nothing.

- [ ] **Step 10: Live smoke test**

```bash
npm run dev &
sleep 15
curl -s "http://localhost:3000/api/audit?url=https://vercel.com" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s);console.log(r.status,r.audit?.score,r.audit?.diagnostics,r.message)})'
```

Expected: `ready <score> { httpStatus: 200, ... }`. Then open `http://localhost:3000/audit/vercel.com` in the browser and check the page renders all 8 categories. Stop the dev server.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat: remove context.dev and Turso; wire direct-fetch audit into API and UI

performAudit no longer needs an API key or cache. Results page drops
the context.dev brand lookup, shows new fetch diagnostics, a PageSpeed
report link, and handles fully N/A categories."
```

---

### Task 8: Rebrand to AEO Checker

**Files:**
- Modify: `app/layout.tsx`, `app/page.tsx`, `components/audit-form.tsx`, `public/site.webmanifest`, `app/robots.ts`, `app/sitemap.ts`, `README.md`, `LICENSE`
- Delete: `public/context-logo.png`

- [ ] **Step 1: `app/layout.tsx`**
  - `siteUrl` fallback → `"http://localhost:3000"`.
  - Every `"AI SEO Audit"` → `"AEO Checker"`; default title and OG/Twitter title → `"AEO Checker | Score your site for ChatGPT, Perplexity & Google"`; description → `"Free AEO and SEO checker. Paste a URL to get a 0–100 score for AI answer engines and search, with prioritized fixes and a copy-paste prompt for your coding agent."`.
  - Delete `authors`, `creator`, `publisher`, and `twitter.creator`.
  - `softwareSchema`: delete `publisher`. Delete `organizationSchema` and its `<script>`. `websiteSchema`: delete `publisher`.
  - Delete the entire `<head>` block (Databuddy script) and the `Script` import.
  - Delete both fixed badge `<a>` elements (context.dev and GitHub).

- [ ] **Step 2: `app/page.tsx`**
  - Titles → `"AEO Checker | Score your site for ChatGPT, Perplexity & Google"`; description → `"Paste a URL and get a free 0–100 AEO and SEO score. Checks AI crawler access, llms.txt, schema, content structure, classic SEO, and page speed, then gives you prioritized fixes."`.
  - FAQ: rename "AI SEO audit" → "AEO audit" in Q1; Q3 answer → `"The checker reads your page the way AI crawlers do (raw HTML, no JavaScript) and checks robots.txt access for GPTBot, ClaudeBot, PerplexityBot and other AI bots, llms.txt, heading and paragraph structure, JSON-LD schema, E-E-A-T trust signals, title and meta tags, Open Graph tags, image alt text, sitemap, and mobile page speed from Google PageSpeed Insights."`; Q4 "Is the AI SEO Audit free?" → "Is the AEO Checker free?"; Q5 answer → `"Most audits complete in 20–40 seconds. The checker fetches your page and site files directly, runs Google PageSpeed Insights in parallel, and scores 45+ checks."`.
  - HowTo: "30+ AI-readability rules" → "45+ AEO and SEO checks".
  - Hero eyebrow `◢ Will ChatGPT cite your site?` stays. Sub-copy → `"See your site through the eyes of ChatGPT, Claude, Perplexity, and Google. Get a 0–100 score and prioritized fixes, plus a prompt your coding agent can run."`. Feature list → `["Free", "no signup"]`, `["~30s", "paste a URL, get a score"]`, `["45+ checks", "AEO, SEO and speed"]`.

- [ ] **Step 3: `components/audit-form.tsx`** — `EXAMPLES` → `["vercel.com", "mintlify.com", "gumroad.com"]`.

- [ ] **Step 4: `public/site.webmanifest`** — `name` and `short_name` → `"AEO Checker"`.

- [ ] **Step 5: `app/robots.ts`, `app/sitemap.ts`** — `siteUrl` fallback → `"http://localhost:3000"`.

- [ ] **Step 6: `LICENSE`** — keep the existing notice and add a line below it: `Copyright (c) 2026 Mohnish Sawlani (modifications)`.

- [ ] **Step 7: `README.md`** — replace with:

````markdown
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
| `PAGESPEED_API_KEY` | no | Free Google key; raises PageSpeed Insights quota |

## Scripts

`npm test` · `npm run typecheck` · `npm run lint` · `npm run build`

## API

`GET /api/audit?url=https://example.com` → `{ status: "ready", audit }` or `{ status: "error", message }`.

## Deploy

Import the repo into Vercel, set `NEXT_PUBLIC_SITE_URL`, optionally `PAGESPEED_API_KEY`, deploy.

## License

MIT. See [LICENSE](./LICENSE).
````

- [ ] **Step 8: Delete logo and verify**

```bash
git rm public/context-logo.png
grep -rni "context\.dev\|contextdotdev\|databuddy\|freeaiseoaudit\|AI SEO Audit" app components lib public README.md || echo CLEAN
npm test && npm run typecheck && npm run lint && npm run build
```

Expected: `CLEAN`, all green.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "chore: rebrand to AEO Checker and remove upstream analytics and badges"
```

---

### Task 9: Publish to GitHub and deploy on Vercel

Requires the user for authentication.

- [ ] **Step 1: Push** — check `gh auth status`; if not logged in, ask the user to run `! gh auth login`. Then:

```bash
git push -u origin main
```

Expected: `main` pushed to `github.com/Mohnish57/aeo-checker-`.

- [ ] **Step 2: Vercel login** — ask the user to run `! vercel login` and confirm when done. Verify with `vercel whoami`.

- [ ] **Step 3: Link and deploy**

```bash
vercel link --yes --project aeo-checker
vercel --prod --yes
```

Record the production URL (e.g. `https://aeo-checker.vercel.app`).

- [ ] **Step 4: Set env and redeploy**

```bash
printf '%s' "https://<production-host>" | vercel env add NEXT_PUBLIC_SITE_URL production
vercel --prod --yes
```

- [ ] **Step 5: Connect GitHub for auto-deploys** — `vercel git connect` (or in the Vercel dashboard: Project → Settings → Git). Confirm a push to `main` triggers a deploy.

- [ ] **Step 6: Production smoke test**

```bash
curl -s "https://<production-host>/api/audit?url=https://vercel.com" | head -c 400
```

Expected: `{"status":"ready",...}`. Open `https://<production-host>/audit/vercel.com` in the browser; all 8 categories render; PageSpeed shows "ready" (if "unavailable", recommend the user add `PAGESPEED_API_KEY`).

No commit (no file changes). If `vercel link` created `.vercel/`, confirm it is gitignored (add `.vercel` to `.gitignore` and commit if not).

---

### Task 10: Benchmark against CheckAEO and tune

**Files:**
- Create: `docs/benchmark.md`
- Modify (if tuning needed): `lib/rules.ts`, `tests/rules.test.ts`

- [ ] **Step 1: Pick 5 URLs** — ask the user for their own site; fill the rest with a SaaS homepage (`https://vercel.com`), a blog article (`https://vercel.com/blog` latest post), an e-commerce homepage (`https://www.allbirds.com`), and a docs page (`https://nextjs.org/docs`).

- [ ] **Step 2: Run CheckAEO on each** (Chrome automation via the claude-in-chrome skill, free tier). Record CheckAEO's overall score, category scores, and every check it reports with pass/fail.

- [ ] **Step 3: Run ours on each** — `GET /api/audit?url=...` on production; record score, category scores, and statuses.

- [ ] **Step 4: Write `docs/benchmark.md`** — a table per URL mapping each CheckAEO check to our rule ID (or "missing"), both results, and agree/disagree. Summary at top: overall agreement %, checks CheckAEO has that we lack, and checks we have that it lacks.

- [ ] **Step 5: Tune** — for each disagreement where CheckAEO is right (verify by looking at the page source), adjust that rule's threshold, add a failing test reproducing the case in `tests/rules.test.ts` first, then fix. For checks CheckAEO has that we lack, list them in `docs/benchmark.md` with a recommendation (add / skip, and why) for the user to approve before building.

- [ ] **Step 6: Verify and commit**

```bash
npm test && npm run typecheck && npm run lint && npm run build
git add docs/benchmark.md lib/rules.ts tests/rules.test.ts
git commit -m "docs: benchmark AEO Checker against CheckAEO on 5 sites and tune thresholds"
git push
```

Expected: Vercel auto-deploys the tuned version.
