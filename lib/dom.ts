/**
 * Parse fetched HTML into a DOM once, with bounded cost.
 *
 * linkedom is built on htmlparser2, whose tokenizer is linear but whose
 * open-element stack is an array it `unshift`s and `indexOf`s. Parsing is
 * therefore quadratic in nesting depth: 3 MB of "<h1>" (750k levels) takes
 * minutes. Browsers stop nesting at 512 levels (Blink), and real pages stay
 * far below that, so we cut the HTML just before the first tag that would
 * nest deeper than MAX_DOM_DEPTH. We also cut once MAX_DOM_NODES elements
 * and text runs have been seen: building millions of DOM nodes costs seconds
 * of CPU and GC, and real pages have tens of thousands at most. A probe pass
 * with htmlparser2's own Parser finds the cut point using exactly the rules
 * linkedom will apply.
 */
import { Parser } from "htmlparser2";
import { parseHTML } from "linkedom";

export const MAX_DOM_DEPTH = 512;
export const MAX_DOM_NODES = 250_000;

export type ParsedPage = {
  document: Document;
  /** The HTML the document was built from (cut if it hit a limit). */
  html: string;
  truncated: boolean;
};

class LimitReached extends Error {
  constructor(readonly offset: number) {
    super("DOM limit reached");
  }
}

class LimitProbe extends Parser {
  private nodes = 0;

  private count(offset: number): void {
    if (++this.nodes > MAX_DOM_NODES) throw new LimitReached(offset);
  }

  onopentagname(start: number, endIndex: number): void {
    this.count(Math.max(start - 1, 0)); // index of "<"
    super.onopentagname(start, endIndex);
    // `stack` is private in the typings; it holds the open (non-void) tags.
    const stack = (this as unknown as { stack: unknown }).stack;
    if (Array.isArray(stack) && stack.length > MAX_DOM_DEPTH) {
      throw new LimitReached(Math.max(start - 1, 0));
    }
  }

  ontext(start: number, endIndex: number): void {
    this.count(start);
    super.ontext(start, endIndex);
  }

  ontextentity(codepoint: number, endIndex: number): void {
    // linkedom makes a separate text node for every decoded entity.
    this.count(this.startIndex);
    super.ontextentity(codepoint, endIndex);
  }
}

/** Returns `html`, cut before the first tag or text past a limit. */
export function limitNesting(html: string): { html: string; truncated: boolean } {
  try {
    const probe = new LimitProbe();
    probe.write(html);
    probe.end();
    return { html, truncated: false };
  } catch (error) {
    if (error instanceof LimitReached) {
      return { html: html.slice(0, error.offset), truncated: true };
    }
    throw error;
  }
}

export function parsePage(rawHtml: string): ParsedPage {
  const { html, truncated } = limitNesting(rawHtml);
  try {
    return { document: toDocument(html), html, truncated };
  } catch {
    return { document: toDocument("<!doctype html><html></html>"), html: "", truncated };
  }
}

/**
 * The page's <body>, without linkedom's `document.body` getter (which inserts
 * head/body elements when the markup has none). Null for fragments.
 */
export function bodyOf(document: Document): Element | null {
  return document.querySelector("body");
}

/** Counts elements, stopping as soon as the count exceeds `limit`. */
export function countElementsUpTo(root: Node, limit: number): number {
  let count = 0;
  const stack: Node[] = [root];
  while (stack.length && count <= limit) {
    const node = stack.pop()!;
    if (node.nodeType === 1) count++;
    const children = node.childNodes;
    for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
  }
  return count;
}

export type PruneLimits = {
  /** Elements plus text nodes. */
  maxNodes: number;
  maxTextChars: number;
  /**
   * Sum of the depths of kept nodes (equivalently, the sum of every kept
   * element's subtree size). Turndown inspects each element's whole subtree,
   * so this bounds its work on deep, wide pages.
   */
  maxDepthSum: number;
  /** Children kept per element (Turndown's <ol> rule is quadratic in it). */
  maxChildren: number;
};

/**
 * A copy of `root` holding its elements and text, in document order, until a
 * limit is reached; the text node that crosses the character limit is cut
 * and everything after it is left out. Children past `maxChildren` of any
 * one element are left out too. Only kept nodes are cloned.
 */
export function prunedClone(root: Node, limits: PruneLimits): Node {
  const copy =
    root.nodeType === 9
      ? (root as Document).createElement("body")
      : root.cloneNode(false);
  let nodes = 0;
  let textChars = 0;
  let depthSum = 0;
  const stack: [Node, Node, number][] = [];
  const pushChildren = (source: Node, target: Node, depth: number) => {
    const children = source.childNodes;
    const kept = Math.min(children.length, limits.maxChildren);
    for (let i = kept - 1; i >= 0; i--) {
      stack.push([children[i], target, depth]);
    }
  };
  pushChildren(root, copy, 1);

  while (stack.length) {
    const [node, parent, depth] = stack.pop()!;
    if (node.nodeType !== 1 && node.nodeType !== 3) continue; // comments etc.
    if (
      nodes >= limits.maxNodes ||
      textChars >= limits.maxTextChars ||
      depthSum + depth > limits.maxDepthSum
    ) {
      break; // pre-order: every remaining node comes later in the page
    }
    nodes++;
    depthSum += depth;
    const clone = node.cloneNode(false);
    if (node.nodeType === 3) {
      const text = node.nodeValue ?? "";
      const room = limits.maxTextChars - textChars;
      if (text.length > room) clone.nodeValue = text.slice(0, room);
      textChars += Math.min(text.length, room);
    }
    parent.appendChild(clone);
    if (node.nodeType === 1) pushChildren(node, clone, depth + 1);
  }
  return copy;
}

/** A fresh, mutable copy of the page's DOM (its HTML is already depth-limited). */
export function reparse(page: ParsedPage): Document {
  return toDocument(page.html);
}

function toDocument(html: string): Document {
  return parseHTML(html).document as unknown as Document;
}
