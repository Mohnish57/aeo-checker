/**
 * Normalize user input into the URL we fetch: adds https:// when missing,
 * lowercases the host and drops the hash. The host is otherwise kept as
 * entered, including "www.", because apex and www can serve different pages
 * (or the apex may not resolve), and an extra apex->www redirect would skew
 * the redirect check. Strip "www." only for display (`displayHost`).
 */
export function normalizeAuditUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const withProtocol = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  try {
    const url = new URL(withProtocol);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    url.hostname = url.hostname.toLowerCase();
    if (!url.hostname.includes(".")) return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

/** Host for labels and the /audit/[domain] slug: lowercase, without "www.". */
export function displayHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Results-page link: display host as the slug, the exact URL in ?url=. */
export function auditHref(auditUrl: string): string {
  return `/audit/${encodeURIComponent(displayHost(auditUrl))}?url=${encodeURIComponent(auditUrl)}`;
}

/**
 * The URL a results page audits. `urlParam` comes from Next's searchParams,
 * which are already decoded, so it is used as-is (decoding again would
 * mangle URLs containing "%25"). Without it, audit the slug's homepage.
 */
export function resolveAuditTarget(
  domainSegment: string,
  urlParam?: string | string[],
): string {
  const url = Array.isArray(urlParam) ? urlParam[0] : urlParam;
  return url ? url : `https://${domainSegment}/`;
}
