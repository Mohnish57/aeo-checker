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
    const { document } = parseHTML(html);
    const markdown = turndown
      .turndown(extractMainHtml(html, document))
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    return withPageH1(markdown, document);
  } catch {
    return "";
  }
}

/**
 * Readability drops an <h1> that duplicates the page title. Heading rules
 * expect the H1 in the Markdown, so restore it when none survived.
 */
function withPageH1(markdown: string, document: Document): string {
  if (/^#\s/m.test(markdown)) return markdown;
  const h1 = document.querySelector("h1")?.textContent?.replace(/\s+/g, " ").trim();
  return h1 ? `# ${h1}\n\n${markdown}`.trim() : markdown;
}

function extractMainHtml(html: string, parsed: Document): string {
  const bodyWords = wordCount(parsed.body?.textContent);

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
