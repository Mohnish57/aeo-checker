import type { Metadata } from "next";

import { Gauge, MessagesSquare, TrendingUp } from "lucide-react";

import { AuditForm } from "@/components/audit-form";
import { SiteHeader } from "@/components/site-header";
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
    "Check how ChatGPT, Claude and Perplexity see your website. Free 0–100 score, your score after fixes, and copy-paste fix prompts for Webflow, WordPress, Wix, Framer, Lovable and more.",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    url: "/",
    title: pageTitle,
    description:
      "Free AI visibility score, your score after fixes, and fix prompts made for your website builder.",
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
        text: "Yes. The tool is free, requires no signup, and is open source on GitHub. Paste a URL, get a 0–100 score in about 30 seconds, and copy fix prompts written for your website builder, such as Webflow, WordPress, Wix or Lovable.",
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
    "Run a free AEO and SEO audit and apply the fixes in your website builder in three steps.",
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
      name: "Copy the fix prompts",
      text: "Copy the prompts, written for your website builder, into ChatGPT or Claude for step-by-step instructions, into an AI builder like Lovable, or send them to your developer.",
    },
  ],
};

const FEATURES = [
  {
    icon: Gauge,
    title: "Your score in 30 seconds",
    text: "We read your page the way AI assistants do and run 45 checks.",
  },
  {
    icon: TrendingUp,
    title: "See your score after fixes",
    text: "Know what fixing each issue is worth before you spend time on it.",
  },
  {
    icon: MessagesSquare,
    title: "Fixes for your website builder",
    text: "Copy-paste prompts for Webflow, WordPress, Wix, Framer, Lovable and more.",
  },
];

export default async function Home({ searchParams }: HomeProps) {
  const params = await searchParams;
  const initialDomain = params.domain ?? "";

  return (
    <>
      <SiteHeader />
      <main className="bg-canvas">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLdScript(faqSchema) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLdScript(howToSchema) }}
        />
        <section className="mx-auto w-full max-w-3xl px-4 pt-16 pb-12 text-center sm:px-6 sm:pt-24">
          <p className="inline-flex items-center gap-2 rounded-full bg-blue-soft px-3 py-1 text-[13px] font-medium text-blue">
            Free · No signup
          </p>
          <h1 className="mt-6 text-4xl font-semibold tracking-[-0.025em] text-balance text-ink sm:text-6xl/[1.05]">
            Will ChatGPT recommend your business?
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-lg/7 text-pretty text-muted">
            See how ChatGPT, Claude and Perplexity read your website. Get a
            score, the fixes that matter most, and prompts made for the tool
            your site is built with.
          </p>
          <div className="mx-auto mt-10 max-w-xl">
            <AuditForm initialDomain={initialDomain} />
          </div>
        </section>

        <section className="mx-auto grid w-full max-w-5xl gap-4 px-4 pb-16 sm:grid-cols-3 sm:px-6">
          {FEATURES.map(({ icon: Icon, title, text }) => (
            <div key={title} className="card p-5">
              <span className="grid size-9 place-items-center rounded-lg bg-blue-soft text-blue">
                <Icon className="size-[18px]" aria-hidden />
              </span>
              <h2 className="mt-4 text-[15px] font-semibold text-ink">{title}</h2>
              <p className="mt-1 text-sm/6 text-muted">{text}</p>
            </div>
          ))}
        </section>

        <section className="mx-auto w-full max-w-3xl px-4 pb-24 sm:px-6">
          <h2 className="text-2xl font-semibold tracking-tight text-ink">
            Questions
          </h2>
          <div className="card mt-5 divide-y divide-line">
            {faqSchema.mainEntity.map((entry) => (
              <details key={entry.name} className="group px-5 py-4">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[15px] font-medium text-ink">
                  {entry.name}
                  <span
                    aria-hidden
                    className="text-subtle transition group-open:rotate-45"
                  >
                    +
                  </span>
                </summary>
                <p className="mt-3 text-sm/6 text-muted">
                  {entry.acceptedAnswer.text}
                </p>
              </details>
            ))}
          </div>
        </section>
      </main>
    </>
  );
}
