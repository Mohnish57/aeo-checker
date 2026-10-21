/**
 * HTML → main-content Markdown (main content only).
 *
 * Readability picks the main content; if it returns too little (common on
 * homepages and landing pages) we fall back to <main>/<article>, then <body>.
 * Callers that already parsed the page pass the ParsedPage in to avoid a
 * second parse; its document is only read, never mutated.
 */
import { Readability } from "@mozilla/readability";
import TurndownService from "turndown";

import {
  bodyOf,
  countElementsUpTo,
  parsePage,
  prunedClone,
  reparse,
  type ParsedPage,
} from "@/lib/dom";

const turndown = new TurndownService({
  headingStyle: "atx",
  bulletListMarker: "-",
  codeBlockStyle: "fenced",
});
const DROPPED_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "IFRAME", "SVG", "FORM"]);
turndown.remove((node) => DROPPED_TAGS.has(node.nodeName.toUpperCase()));

/**
 * Readability is slow on huge DOMs (seconds at a few hundred thousand
 * elements). Above this we skip it and use the structural fallbacks.
 * Readability's own maxElemsToParse is passed too, but it counts with
 * getElementsByTagName("*"), which linkedom answers with 0, so the
 * pre-check here is what actually enforces the limit.
 */
export const MAX_READABILITY_ELEMENTS = 20_000;

/**
 * Turndown joins its output with string concatenation and indexed reads,
 * which is quadratic in output size, and its <ol> rule scans siblings per
 * item (so lists are capped per parent too). Conversion stops after this many nodes (elements and text; entity-
 * heavy text splits into many text nodes), characters, or total depth (its
 * blank-element check walks each element's subtree); the rest of a very
 * long or very deep page is left out of the Markdown.
 */
export const MAX_MARKDOWN_NODES = 30_000;
export const MAX_MARKDOWN_TEXT_CHARS = 200_000;
export const MAX_MARKDOWN_DEPTH_SUM = 2_000_000;
export const MAX_MARKDOWN_CHILDREN = 1_000;

export function htmlToMainMarkdown(html: string, parsed?: ParsedPage): string {
  if (!html.trim()) return "";
  try {
    const page = parsed ?? parsePage(html);
    const markdown = turndown
      .turndown(
        prunedClone(extractMainNode(page), {
          maxNodes: MAX_MARKDOWN_NODES,
          maxTextChars: MAX_MARKDOWN_TEXT_CHARS,
          maxDepthSum: MAX_MARKDOWN_DEPTH_SUM,
          maxChildren: MAX_MARKDOWN_CHILDREN,
        }) as unknown as TurndownService.Node,
      )
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    return withPageH1(markdown, page.document);
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

/**
 * The main-content node to convert. Always a parsed node, never a raw HTML
 * string: Turndown parses strings with its own (domino) parser, which can be
 * slow on adversarial markup. Turndown clones the node, so the shared
 * document is not mutated.
 */
function extractMainNode(page: ParsedPage): Node {
  const { document } = page;
  const body = bodyOf(document);
  const bodyWords = wordCount(body ? body.textContent : documentText(document));

  const elements = countElementsUpTo(document, MAX_READABILITY_ELEMENTS);
  if (elements <= MAX_READABILITY_ELEMENTS) {
    try {
      // Readability mutates the document, so give it its own copy.
      const article = new Readability(reparse(page), {
        maxElemsToParse: MAX_READABILITY_ELEMENTS,
      }).parse();
      if (
        article?.content &&
        wordCount(article.textContent) >= Math.max(50, bodyWords * 0.25)
      ) {
        return parsePage(article.content).document;
      }
    } catch {
      // Fall through to structural fallbacks.
    }
  }

  const main = document.querySelector("main, [role=main], article");
  if (main && wordCount(main.textContent) >= 50) return main;
  return body ?? document;
}

function documentText(document: Document): string {
  return [...document.childNodes].map((node) => node.textContent ?? "").join(" ");
}

function wordCount(text: string | null | undefined): number {
  return text?.trim().split(/\s+/).filter(Boolean).length ?? 0;
}
