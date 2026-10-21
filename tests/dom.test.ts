import { describe, expect, it } from "vitest";

import {
  MAX_DOM_DEPTH,
  MAX_DOM_NODES,
  limitNesting,
  parsePage,
  prunedClone,
} from "@/lib/dom";

function depthOf(root: Node): number {
  let max = 0;
  const stack: [Node, number][] = [[root, 0]];
  while (stack.length) {
    const [node, depth] = stack.pop()!;
    max = Math.max(max, depth);
    for (const child of node.childNodes) stack.push([child, depth + 1]);
  }
  return max;
}

describe("limitNesting", () => {
  it("leaves ordinary pages untouched", () => {
    const html = "<!doctype html><html><body><div><p>Hi</p></div></body></html>";
    expect(limitNesting(html)).toEqual({ html, truncated: false });
  });

  it("cuts the page before the first tag nested deeper than the limit", () => {
    const html = "<div>".repeat(MAX_DOM_DEPTH + 100) + "tail";
    const result = limitNesting(html);
    expect(result.truncated).toBe(true);
    expect(result.html).toBe("<div>".repeat(MAX_DOM_DEPTH));
    expect(depthOf(parsePage(html).document)).toBeLessThanOrEqual(MAX_DOM_DEPTH + 1);
  });

  it("cuts the page once it has more nodes than the limit", () => {
    const result = limitNesting("<p>x</p>".repeat(MAX_DOM_NODES));
    expect(result.truncated).toBe(true);
    // Each <p>x</p> is two nodes: an element and a text run.
    expect(result.html).toBe("<p>x</p>".repeat(MAX_DOM_NODES / 2));
  });

  it("counts each decoded entity as a node", () => {
    expect(limitNesting("&amp;".repeat(MAX_DOM_NODES + 1)).truncated).toBe(true);
  });

  it.each([
    ["unclosed list items", "<ul>" + "<li>x".repeat(5000)],
    ["unclosed paragraphs", "<p>x".repeat(5000)],
    ["void elements", "<br><img src=a>".repeat(5000)],
    ["self-closing SVG children", "<svg>" + "<path d='M0'/>".repeat(5000) + "</svg>"],
    ["sibling blocks", "<div>x</div>".repeat(5000)],
  ])("does not count %s as nesting", (_label, html) => {
    expect(limitNesting(html).truncated).toBe(false);
  });
});

describe("prunedClone", () => {
  const { document } = parsePage("<body>" + "<p>abcdefghij</p>".repeat(100) + "</body>");
  const body = document.querySelector("body")!;

  it("keeps nodes only up to the node limit", () => {
    const clone = prunedClone(body, { maxNodes: 20, maxTextChars: 10_000, maxDepthSum: 1e9, maxChildren: 1e9 }) as Element;
    expect(clone.querySelectorAll("p").length).toBe(10);
    expect(body.querySelectorAll("p").length).toBe(100);
  });

  it("stops at the depth budget", () => {
    // Each <p> costs depth 1 and its text depth 2: 3 per paragraph.
    const clone = prunedClone(body, { maxNodes: 10_000, maxTextChars: 10_000, maxDepthSum: 30, maxChildren: 1e9 }) as Element;
    expect(clone.querySelectorAll("p").length).toBe(10);
  });

  it("keeps at most maxChildren children per element", () => {
    const clone = prunedClone(body, { maxNodes: 10_000, maxTextChars: 10_000, maxDepthSum: 1e9, maxChildren: 7 }) as Element;
    expect(clone.querySelectorAll("p").length).toBe(7);
  });

  it("cuts text at the character limit", () => {
    const clone = prunedClone(body, { maxNodes: 10_000, maxTextChars: 25, maxDepthSum: 1e9, maxChildren: 1e9 });
    expect(clone.textContent).toBe("abcdefghijabcdefghijabcde");
  });
});
