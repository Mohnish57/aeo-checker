/**
 * Plain-English copy for every rule, written for founders rather than
 * developers. Rule IDs, evidence and the technical recommendation stay in
 * `lib/rules.ts`; the UI shows those under "Details". Client-safe.
 */

/** quick ≈ 5 minutes in a site builder; medium ≈ 30 minutes; developer = needs code. */
export type FixEffort = "quick" | "medium" | "developer";

export type FixGuide = {
  /** Neutral goal, shown for passing checks. */
  title: string;
  /** Shown when the check fails or partly fails. */
  problem: string;
  /** One line on why AI answer engines care. */
  why: string;
  effort: FixEffort;
  /** False when the fix is not an edit to this site (listings, research, speed work). */
  siteFix: boolean;
};

export const FIX_GUIDE: Record<string, FixGuide> = {
  // A. Technical AI crawlability
  A1: {
    title: "Your page loads securely (HTTPS)",
    problem: "Your page doesn't load securely (no HTTPS)",
    why: "AI engines and browsers treat insecure pages as less trustworthy and may skip them.",
    effort: "quick",
    siteFix: true,
  },
  A8: {
    title: "AI can read your page without running JavaScript",
    problem: "AI can't read your page without running JavaScript",
    why: "Most AI crawlers read the raw page and don't run scripts, so they see a blank or near-empty page.",
    effort: "developer",
    siteFix: true,
  },
  A11: {
    title: "Your page says which URL is the original (canonical)",
    problem: "Your page doesn't say which URL is the original",
    why: "Without it, AI and search engines may split or ignore duplicate versions of the page.",
    effort: "quick",
    siteFix: true,
  },
  A12: {
    title: "Your page is allowed in search results",
    problem: "Your page is hidden from search engines (noindex)",
    why: "AI answers draw on search indexes, so a hidden page can't be cited at all.",
    effort: "quick",
    siteFix: true,
  },
  A13: {
    title: "AI assistants are allowed to visit your site",
    problem: "Your site blocks AI assistants like ChatGPT or Perplexity",
    why: "If their crawlers are blocked in robots.txt, these assistants can't read or cite you.",
    effort: "quick",
    siteFix: true,
  },
  A14: {
    title: "You have an llms.txt guide for AI",
    problem: "There's no llms.txt guide for AI",
    why: "A short llms.txt file points AI tools straight at your most important pages.",
    effort: "medium",
    siteFix: true,
  },
  A15: {
    title: "Your page loads without a chain of redirects",
    problem: "Your page bounces through several redirects",
    why: "Each extra redirect is a chance for a crawler to give up before reaching the page.",
    effort: "developer",
    siteFix: true,
  },

  // B. Content structure
  B1: {
    title: "The opening says clearly who you are and what this page is",
    problem: "The opening doesn't say clearly who you are and what this page is",
    why: "AI assistants often quote the first 2–3 sentences, so they need to stand alone as an answer.",
    effort: "quick",
    siteFix: true,
  },
  B2: {
    title: "Headings are clear: one main title, then sections",
    problem: "Headings are unclear or out of order",
    why: "AI uses headings to understand what each part of the page answers.",
    effort: "medium",
    siteFix: true,
  },
  B3: {
    title: "Paragraphs are short and focused",
    problem: "Some paragraphs are too long",
    why: "AI quotes short, single-idea passages; long blocks are harder to lift into an answer.",
    effort: "medium",
    siteFix: true,
  },
  B4: {
    title: "Each section makes sense on its own",
    problem: "Sections don't stand on their own",
    why: "AI retrieves pages in chunks, so each section needs its own clear heading and point.",
    effort: "medium",
    siteFix: true,
  },
  B5: {
    title: "The page has an FAQ section",
    problem: "There's no FAQ section",
    why: "People ask AI questions; a question-and-answer section matches how they ask.",
    effort: "medium",
    siteFix: true,
  },
  B6: {
    title: "The page includes real numbers and facts",
    problem: "The page has few real numbers or facts",
    why: "AI prefers to cite specific, checkable facts such as figures, prices, dates and results.",
    effort: "medium",
    siteFix: true,
  },
  B7: {
    title: "The page quotes an expert or a named source",
    problem: "The page doesn't quote an expert or a named source",
    why: "Attributed quotes signal expertise and give AI something credible to repeat.",
    effort: "medium",
    siteFix: true,
  },
  B8: {
    title: "Claims link to trusted sources",
    problem: "Claims don't link to trusted sources",
    why: "Links to reputable sources let AI cross-check you, which makes it more willing to cite you.",
    effort: "medium",
    siteFix: true,
  },
  B10: {
    title: "Key terms are defined in plain sentences",
    problem: "Key terms aren't defined in plain sentences",
    why: "Sentences like \"X is…\" are exactly what AI lifts when someone asks \"what is X?\".",
    effort: "quick",
    siteFix: true,
  },
  B11: {
    title: "The page links to related pages on your site",
    problem: "The page doesn't link to enough related pages on your site",
    why: "Links to related pages help AI find and connect the rest of your content.",
    effort: "quick",
    siteFix: true,
  },
  B12: {
    title: "The page shows when it was last updated",
    problem: "The page doesn't show when it was last updated",
    why: "AI favours fresh information; an updated date tells it the page is current.",
    effort: "quick",
    siteFix: true,
  },
  B13: {
    title: "The writing is easy to read",
    problem: "The writing is hard to read",
    why: "Clear, plain sentences are easier for AI to quote accurately.",
    effort: "medium",
    siteFix: true,
  },
  B14: {
    title: "The page uses lists or tables",
    problem: "The page has no lists or tables",
    why: "Lists and tables are the easiest format for AI to pull steps and comparisons from.",
    effort: "quick",
    siteFix: true,
  },

  // C. Structured data
  C1: {
    title: "The page has structured data for AI (schema)",
    problem: "The page has no structured data for AI (schema)",
    why: "Schema is a hidden label that tells AI exactly what the page is and who it's from.",
    effort: "medium",
    siteFix: true,
  },
  C2: {
    title: "Your company details are labelled for AI",
    problem: "Your company details aren't fully labelled for AI",
    why: "Organization schema (name, logo, website, social profiles) helps AI recognise your brand.",
    effort: "medium",
    siteFix: true,
  },
  C3: {
    title: "The article's author and dates are labelled for AI",
    problem: "The article's author and dates aren't labelled for AI",
    why: "AI weighs who wrote something and when; Article schema states both.",
    effort: "medium",
    siteFix: true,
  },
  C4: {
    title: "Authors are labelled for AI",
    problem: "Authors aren't labelled for AI",
    why: "Person schema links the author to their credentials and profiles, which builds trust.",
    effort: "medium",
    siteFix: true,
  },
  C5: {
    title: "Your FAQ is labelled for AI",
    problem: "Your FAQ isn't labelled for AI",
    why: "FAQ schema hands AI your questions and answers in a format it reads directly.",
    effort: "medium",
    siteFix: true,
  },
  C11: {
    title: "Structured data is in the page itself, not added later by scripts",
    problem: "Structured data is only added by scripts after the page loads",
    why: "Crawlers that don't run JavaScript never see schema that scripts inject.",
    effort: "developer",
    siteFix: true,
  },

  // D. Trust and authority
  D5: {
    title: "The page links to your About or company page",
    problem: "The page doesn't link to your About or company page",
    why: "AI checks who is behind a page before trusting it.",
    effort: "quick",
    siteFix: true,
  },
  D6: {
    title: "Privacy, terms and contact pages are linked",
    problem: "Privacy, terms or contact pages aren't linked",
    why: "These pages are basic trust signals that a real business stands behind the site.",
    effort: "quick",
    siteFix: true,
  },
  D10: {
    title: "You publish your own research or data",
    problem: "There's no original research or data",
    why: "Original data is the content AI is most likely to cite, because no one else has it.",
    effort: "medium",
    siteFix: false,
  },
  D12: {
    title: "Your brand is described the same way everywhere",
    problem: "Your brand is described differently across the page",
    why: "Consistent names and descriptions help AI confirm who you are and what you do.",
    effort: "quick",
    siteFix: true,
  },

  // E. Off-site presence
  E1: {
    title: "You link to your profiles on review sites",
    problem: "There are no links to your review-site profiles (G2, Clutch, Trustpilot…)",
    why: "AI leans on third-party reviews to decide which brands to recommend.",
    effort: "medium",
    siteFix: false,
  },
  E7: {
    title: "You link to your GitHub or developer docs",
    problem: "There's no link to your GitHub or developer docs",
    why: "For technical products, AI uses code and docs to judge how real and active you are.",
    effort: "quick",
    siteFix: false,
  },
  E10: {
    title: "AI can match your brand to its official profiles",
    problem: "AI can't easily match your brand to its official profiles",
    why: "Links to LinkedIn, Crunchbase or Wikipedia in your schema stop AI confusing you with others.",
    effort: "medium",
    siteFix: true,
  },
  E12: {
    title: "You link to well-known sources in your field",
    problem: "You don't link to well-known sources in your field",
    why: "Being mentioned alongside recognised sources helps AI place you in your category.",
    effort: "medium",
    siteFix: true,
  },

  // F. Freshness
  F6: {
    title: "The page shows it's kept up to date",
    problem: "Nothing shows the page is kept up to date",
    why: "AI prefers recently refreshed pages when answering current questions.",
    effort: "quick",
    siteFix: true,
  },

  // G. Classic SEO
  G1: {
    title: "The page title is the right length",
    problem: "The page title is too short or too long",
    why: "The title is the first thing AI and Google read to understand the page.",
    effort: "quick",
    siteFix: true,
  },
  G2: {
    title: "The page has a good meta description",
    problem: "The meta description is missing or the wrong length",
    why: "It's the short summary AI and search engines show and quote.",
    effort: "quick",
    siteFix: true,
  },
  G3: {
    title: "Images have descriptions (alt text)",
    problem: "Some images have no description (alt text)",
    why: "AI can't see images; alt text tells it what they show.",
    effort: "quick",
    siteFix: true,
  },
  G4: {
    title: "Links shared on social and chat show a proper preview",
    problem: "Links shared on social and chat don't show a proper preview",
    why: "Open Graph tags control the title, text and image people see when your link is shared.",
    effort: "quick",
    siteFix: true,
  },
  G5: {
    title: "The page is set up for mobile",
    problem: "The page isn't set up for mobile",
    why: "Search engines rank and read the mobile version of your page first.",
    effort: "developer",
    siteFix: true,
  },
  G6: {
    title: "The page declares its language",
    problem: "The page doesn't declare its language",
    why: "It tells AI which language to answer in when citing you.",
    effort: "quick",
    siteFix: true,
  },
  G7: {
    title: "Your site has a sitemap",
    problem: "Your site has no sitemap that crawlers can find",
    why: "A sitemap lists every page so crawlers don't miss any.",
    effort: "quick",
    siteFix: true,
  },

  // H. Performance
  H1: {
    title: "The page is fast on mobile",
    problem: "The page is slow on mobile",
    why: "Slow pages are crawled less and rank lower.",
    effort: "developer",
    siteFix: false,
  },
  H2: {
    title: "The main content appears quickly",
    problem: "The main content takes too long to appear",
    why: "Google measures how fast the biggest element shows up and ranks slow pages lower.",
    effort: "developer",
    siteFix: false,
  },
  H3: {
    title: "The layout doesn't jump while loading",
    problem: "The layout jumps around while loading",
    why: "Shifting layouts frustrate visitors and count against you in Google's ranking.",
    effort: "developer",
    siteFix: false,
  },
  H4: {
    title: "The page responds quickly to taps and clicks",
    problem: "The page is slow to respond to taps and clicks",
    why: "Heavy scripts freeze the page, which hurts both visitors and rankings.",
    effort: "developer",
    siteFix: false,
  },
};

export function guideFor(id: string): FixGuide {
  return (
    FIX_GUIDE[id] ?? {
      title: id,
      problem: id,
      why: "",
      effort: "medium",
      siteFix: true,
    }
  );
}

export const EFFORT_LABEL: Record<FixEffort, string> = {
  quick: "~5 min",
  medium: "~30 min",
  developer: "Needs a developer",
};
