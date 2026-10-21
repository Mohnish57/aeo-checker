/**
 * JSON-LD for inline <script type="application/ld+json"> tags.
 *
 * JSON.stringify does not escape "<", so a value containing "</script>"
 * would close the tag and inject HTML. Every dangerouslySetInnerHTML JSON-LD
 * site must go through `jsonLdScript`.
 */
import { displayHost } from "@/lib/url";

export function jsonLdScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

/**
 * Breadcrumb and WebPage schema for a results page. Built from the audited
 * URL (already parsed and normalized), never from the raw route segment.
 */
export function auditPageSchemas(siteUrl: string, auditedUrl: string) {
  const host = displayHost(auditedUrl);
  const origin = new URL(auditedUrl).origin;
  const pageUrl = `${siteUrl}/audit/${encodeURIComponent(host)}`;

  const breadcrumb = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "AEO Checker", item: siteUrl },
      { "@type": "ListItem", position: 2, name: host, item: pageUrl },
    ],
  };

  const report = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: `AEO Checker | ${host}`,
    url: pageUrl,
    description: `AEO and SEO audit and 0–100 score for ${host}.`,
    isPartOf: { "@type": "WebSite", name: "AEO Checker", url: siteUrl },
    about: { "@type": "WebSite", url: origin, name: host },
  };

  return [breadcrumb, report] as const;
}
