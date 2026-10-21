import type { Metadata } from "next";

import { AuditForm } from "@/components/audit-form";
import { jsonLdScript } from "@/lib/json-ld";

type HomeProps = {
  searchParams: Promise<{ domain?: string }>;
};

const pageTitle = "AEO Checker | Score your site for ChatGPT, Perplexity & Google";

export const metadata: Metadata = {
  title: {
    absolute: pageTitle,
  },
  description:
    "Paste a URL and get a free 0–100 AEO and SEO score. Checks AI crawler access, llms.txt, schema, content structure, classic SEO, and page speed, then gives you prioritized fixes.",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    url: "/",
    title: pageTitle,
    description:
      "Free 0–100 AI visibility score with a copy-paste fix prompt your coding agent can run.",
  },
};

const faqSchema = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: [
    {
      "@type": "Question",
      name: "What is an AEO audit?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "An AEO audit evaluates whether a web page is readable and citation-ready for AI answer engines like ChatGPT, Claude, and Perplexity. It scores crawlability for AI bots, semantic HTML and content chunking, structured data and schema markup, and trust signals such as author and date metadata.",
      },
    },
    {
      "@type": "Question",
      name: "How is AI SEO different from traditional SEO?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Traditional SEO targets ranking algorithms in Google search results, while AI SEO (sometimes called GEO or AEO) targets the retrieval and citation behavior of large language models. AI SEO emphasizes clean Markdown extraction, well-chunked content, server-rendered HTML, and explicit schema that LLMs can ground answers in.",
      },
    },
    {
      "@type": "Question",
      name: "Which AI-readability signals does this audit check?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "The checker reads your page the way AI crawlers do (raw HTML, no JavaScript) and checks robots.txt access for GPTBot, ClaudeBot, PerplexityBot and other AI bots, llms.txt, heading and paragraph structure, JSON-LD schema, E-E-A-T trust signals, title and meta tags, Open Graph tags, image alt text, sitemap, and mobile page speed from Google PageSpeed Insights.",
      },
    },
    {
      "@type": "Question",
      name: "Is the AEO Checker free?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Yes. The tool is free, requires no signup, and is open source on GitHub. Paste a URL, get a 0–100 score in about 30 seconds, and copy a fix prompt into Claude Code, Cursor, or any coding agent.",
      },
    },
    {
      "@type": "Question",
      name: "How long does an audit take?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Most audits complete in 20–40 seconds. The checker fetches your page and site files directly, runs Google PageSpeed Insights in parallel, and scores 45+ checks.",
      },
    },
  ],
};

const howToSchema = {
  "@context": "https://schema.org",
  "@type": "HowTo",
  name: "How to audit a page for AI SEO visibility",
  description:
    "Run a free AEO and SEO audit and apply the fixes with your coding agent in three steps.",
  totalTime: "PT2M",
  step: [
    {
      "@type": "HowToStep",
      position: 1,
      name: "Paste a URL",
      text: "Enter the full URL of any public page you want to audit for AI readability.",
    },
    {
      "@type": "HowToStep",
      position: 2,
      name: "Get a 0–100 score",
      text: "The audit fetches the page, evaluates 45+ AEO and SEO checks, and returns a visibility score with a per-category breakdown.",
    },
    {
      "@type": "HowToStep",
      position: 3,
      name: "Copy the fix prompt",
      text: "Copy the generated prompt and paste it into your coding agent (Claude Code, Cursor, etc.) to ship the fixes automatically.",
    },
  ],
};

export default async function Home({ searchParams }: HomeProps) {
  const params = await searchParams;
  const initialDomain = params.domain ?? "";

  return (
    <main className="relative min-h-[calc(100dvh-4rem)] overflow-hidden bg-canvas">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(faqSchema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(howToSchema) }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -right-20 -bottom-32 select-none text-[28rem] font-medium leading-none tracking-tighter text-ink/[0.04] sm:text-[36rem]"
      >
        100
      </div>
      <section className="relative mx-auto grid w-full max-w-7xl gap-12 px-5 py-10 sm:px-8 sm:py-14 lg:grid-cols-[7fr_5fr] lg:items-end lg:gap-16">
        <div className="flex flex-col justify-end">
          <div className="font-mono text-xs uppercase tracking-[0.28em] text-teal">
            ◢ Will ChatGPT cite your site?
          </div>
          <h1 className="mt-6 text-6xl font-medium tracking-[-0.04em] text-balance text-ink sm:text-[8rem]/[0.9]">
            Audit.
            <br />
            <span className="text-ink/35">Score.</span>{" "}
            <span className="text-teal">Fix.</span>
          </h1>
          <p className="mt-6 max-w-xl text-lg/7 text-pretty text-muted sm:text-xl/8">
            See your site through the eyes of ChatGPT, Claude, Perplexity, and
            Google. Get a 0–100 score and prioritized fixes, plus a prompt your
            coding agent can run.
          </p>
          <ul className="mt-8 grid max-w-2xl gap-3 border-t hairline pt-5 text-base text-ink sm:grid-cols-3 sm:gap-6">
            {[
              ["Free", "no signup"],
              ["~30s", "paste a URL, get a score"],
              ["45+ checks", "AEO, SEO and speed"],
            ].map(([headline, sub]) => (
              <li key={headline} className="flex gap-3 sm:flex-col sm:gap-1">
                <div className="font-mono text-sm font-medium tracking-wide text-teal sm:text-base">
                  {headline}
                </div>
                <div className="text-sm text-muted sm:text-sm">{sub}</div>
              </li>
            ))}
          </ul>
        </div>
        <div className="flex flex-col justify-end">
          <AuditForm initialDomain={initialDomain} />
        </div>
      </section>
    </main>
  );
}
