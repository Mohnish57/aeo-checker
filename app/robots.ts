import type { MetadataRoute } from "next";

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

const aiBots = [
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "ClaudeBot",
  "Claude-User",
  "Claude-SearchBot",
  "PerplexityBot",
  "Google-Extended",
  "Applebot-Extended",
];

// Every /audit/* visit and /api/audit call runs a full live audit (target
// fetches plus a PageSpeed Insights run), so crawlers stay off both.
const disallow = ["/api/", "/audit/"];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      ...aiBots.map((userAgent) => ({ userAgent, allow: "/", disallow })),
      { userAgent: "*", allow: "/", disallow },
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
    host: siteUrl,
  };
}
