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
    if (!response.ok) {
      // Status only: the request URL carries the API key.
      console.warn(`PageSpeed Insights request failed: HTTP ${response.status}`);
      return null;
    }
    const result = parsePageSpeed(await response.json());
    if (!result) console.warn("PageSpeed Insights returned no performance score");
    return result;
  } catch (error) {
    // Error name only (e.g. TimeoutError); never the message or URL.
    const name = error instanceof Error ? error.name : "unknown error";
    console.warn(`PageSpeed Insights request failed: ${name}`);
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
