/**
 * Which site builder a page was made with, so fix prompts can be written
 * for how the founder actually edits their site. Pure string checks over the
 * fetched HTML (no extra requests); safe to import from client components.
 */

export type PlatformId =
  | "webflow"
  | "framer"
  | "wix"
  | "squarespace"
  | "shopify"
  | "wordpress"
  | "hubspot"
  | "ghost"
  | "lovable"
  | "bolt"
  | "v0"
  | "replit"
  | "custom";

/**
 * no-code: the founder edits in a visual builder and asks an AI assistant how.
 * ai-builder: the prompt is pasted into the builder, which makes the change.
 * developer: the prompt is a brief for a developer or coding agent.
 */
export type PromptStyle = "no-code" | "ai-builder" | "developer";

export type Platform = {
  id: PlatformId;
  name: string;
  style: PromptStyle;
  /** Where SEO settings, head code and site-level settings live (no-code only). */
  whereThingsLive: string;
};

export const PLATFORMS: Record<PlatformId, Platform> = {
  webflow: {
    id: "webflow",
    name: "Webflow",
    style: "no-code",
    whereThingsLive:
      "Title, meta description and Open Graph image are in Page settings → SEO / Open Graph settings. Code such as JSON-LD goes in Page settings → Custom code → Inside <head> tag (or Site settings → Custom code for every page). robots.txt, sitemap and indexing are in Site settings → SEO. CMS pages take dynamic values from collection fields.",
  },
  framer: {
    id: "framer",
    name: "Framer",
    style: "no-code",
    whereThingsLive:
      "Title, description and social image are in each page's settings (Page settings → SEO / Social preview). Code such as JSON-LD goes in Page settings → Custom code → Start of <head>, or Site settings → General → Custom code for every page. Indexing and sitemap options are in Site settings.",
  },
  wix: {
    id: "wix",
    name: "Wix",
    style: "no-code",
    whereThingsLive:
      "Title and meta description are in the page's SEO basics (Pages menu → ⋯ → SEO basics), social image under Social share. Code such as JSON-LD goes in SEO basics → Advanced SEO → Structured data markup, or Settings → Custom code. robots.txt is in Marketing & SEO → SEO Tools → Robots.txt editor.",
  },
  squarespace: {
    id: "squarespace",
    name: "Squarespace",
    style: "no-code",
    whereThingsLive:
      "Title, description and social image are in the page's settings (Pages → ⚙ → SEO / Social image). Code such as JSON-LD goes in Page settings → Advanced → Page header code injection, or Settings → Developer tools → Code injection for every page. AI crawler access is under Settings → Crawlers; robots.txt itself can't be edited.",
  },
  shopify: {
    id: "shopify",
    name: "Shopify",
    style: "no-code",
    whereThingsLive:
      "Title and meta description are in each page, product or collection under Search engine listing. The social sharing image is in Online Store → Preferences. Code such as JSON-LD goes in Online Store → Themes → Edit code → theme.liquid (inside <head>). robots.txt is customised with a robots.txt.liquid template.",
  },
  wordpress: {
    id: "wordpress",
    name: "WordPress",
    style: "no-code",
    whereThingsLive:
      "Title, meta description and social image are in the SEO plugin box under the page editor (Yoast SEO or Rank Math; install one if missing). Code such as JSON-LD goes in a header-code plugin like WPCode, or the SEO plugin's schema settings. Indexing is in Settings → Reading; robots.txt is in Yoast → Tools → File editor or Rank Math → General settings.",
  },
  hubspot: {
    id: "hubspot",
    name: "HubSpot",
    style: "no-code",
    whereThingsLive:
      "Title, meta description and featured image are in the page editor under Settings. Code such as JSON-LD goes in Settings → Advanced → Head HTML (or Settings → Website → Pages → Site header HTML for every page). robots.txt is in Settings → Website → Pages → SEO & crawlers.",
  },
  ghost: {
    id: "ghost",
    name: "Ghost",
    style: "no-code",
    whereThingsLive:
      "Title and meta description are in Post/Page settings → Meta data, social image under X card and Facebook card. Code such as JSON-LD goes in Post settings → Code injection → Post header, or Settings → Code injection for every page. robots.txt comes from the theme's robots.txt file.",
  },
  lovable: { id: "lovable", name: "Lovable", style: "ai-builder", whereThingsLive: "" },
  bolt: { id: "bolt", name: "Bolt", style: "ai-builder", whereThingsLive: "" },
  v0: { id: "v0", name: "v0", style: "ai-builder", whereThingsLive: "" },
  replit: { id: "replit", name: "Replit", style: "ai-builder", whereThingsLive: "" },
  custom: {
    id: "custom",
    name: "Custom code",
    style: "developer",
    whereThingsLive: "",
  },
};

type DetectInput = {
  html: string;
  host: string;
  /** Content of <meta name="generator">, if any. */
  generator: string | null;
};

/** Checked in order; the first match wins (Framer pages can load Shopify assets). */
const SIGNALS: Array<[PlatformId, (input: DetectInput) => boolean]> = [
  ["lovable", ({ host, html }) => /\.lovable\.app$/.test(host) || html.includes("gpteng.co") || html.includes("data-lov-id")],
  ["bolt", ({ host }) => /\.bolt\.new$/.test(host)],
  ["v0", ({ host }) => /\.vusercontent\.net$/.test(host)],
  ["replit", ({ host }) => /\.replit\.app$/.test(host)],
  ["webflow", ({ html, generator }) => html.includes("data-wf-site") || /webflow/i.test(generator ?? "")],
  ["framer", ({ html, generator }) => /^framer/i.test(generator ?? "") || html.includes("framerusercontent.com")],
  ["wix", ({ html, generator }) => /wix\.com/i.test(generator ?? "") || html.includes("static.wixstatic.com")],
  ["squarespace", ({ html }) => html.includes("static1.squarespace.com") || html.includes("squarespace-cdn.com")],
  ["shopify", ({ html }) => html.includes("cdn.shopify.com/s/") || html.includes("Shopify.theme")],
  ["wordpress", ({ html, generator }) => html.includes("/wp-content/") || html.includes("/wp-includes/") || /^wordpress/i.test(generator ?? "")],
  ["hubspot", ({ generator }) => /^hubspot/i.test(generator ?? "")],
  ["ghost", ({ generator }) => /^ghost/i.test(generator ?? "")],
];

export function detectPlatform(input: DetectInput): PlatformId {
  const host = input.host.toLowerCase();
  return SIGNALS.find(([, matches]) => matches({ ...input, host }))?.[0] ?? "custom";
}

export function isPlatformId(value: string): value is PlatformId {
  return Object.hasOwn(PLATFORMS, value);
}
