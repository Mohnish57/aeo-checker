import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";

import { AuditForm } from "@/components/audit-form";
import { AuditResultsView } from "@/components/audit-results-view";
import { SiteHeader } from "@/components/site-header";
import { auditPageSchemas, jsonLdScript } from "@/lib/json-ld";
import { performAudit } from "@/lib/perform-audit";
import { resolveAuditTarget } from "@/lib/url";

export const runtime = "nodejs";
// PageSpeed Insights can take 45 s; 60 s is the Vercel Hobby ceiling.
export const maxDuration = 60;

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

type PageProps = {
  params: Promise<{ domain: string }>;
  searchParams: Promise<{ url?: string | string[] }>;
};

function decodeDomain(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { domain } = await params;
  const decoded = decodeDomain(domain);
  const canonical = `/audit/${encodeURIComponent(decoded)}`;
  const title = `${decoded} | AEO & SEO Score`;
  const description = `See how ${decoded} scores for ChatGPT, Claude, Perplexity, and Google. Free AEO and SEO audit covering AI crawler access, llms.txt, schema, content structure, classic SEO, and page speed, with a copy-paste fix prompt.`;
  return {
    title: { absolute: title },
    description,
    alternates: { canonical },
    openGraph: {
      type: "article",
      url: canonical,
      title,
      description,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
    robots: {
      index: false,
      follow: true,
      googleBot: {
        index: false,
        follow: true,
        "max-snippet": -1,
        "max-image-preview": "large",
      },
    },
  };
}

export default async function AuditPage({ params, searchParams }: PageProps) {
  const { domain } = await params;
  const { url: urlParam } = await searchParams;
  const decoded = decodeDomain(domain);
  const auditTarget = resolveAuditTarget(decoded, urlParam);
  const result = await performAudit(auditTarget);

  if (result.status === "error") {
    return (
      <ErrorScreen
        title={`We couldn't check ${decoded}`}
        message={result.message}
        retryDomain={decoded}
      />
    );
  }

  const [breadcrumbSchema, reportSchema] = auditPageSchemas(
    siteUrl,
    result.audit.url,
  );

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(breadcrumbSchema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(reportSchema) }}
      />
      <AuditResultsView audit={result.audit} />
    </>
  );
}

function ErrorScreen({
  title,
  message,
  retryDomain,
}: {
  title: string;
  message: string;
  retryDomain?: string;
}) {
  return (
    <>
      <SiteHeader />
      <main className="bg-canvas">
        <section className="mx-auto w-full max-w-xl px-4 py-16 sm:px-6 sm:py-24">
          <div className="card p-6 sm:p-8">
            <span className="grid size-10 place-items-center rounded-full bg-red-soft text-red">
              <AlertTriangle className="size-5" aria-hidden />
            </span>
            <h1 className="mt-4 text-2xl font-semibold tracking-tight text-ink">
              {title}
            </h1>
            <p className="mt-2 text-[15px]/6 text-pretty text-muted">{message}</p>
            <div className="mt-6 border-t hairline pt-6">
              <AuditForm initialDomain={retryDomain} />
            </div>
          </div>
          <Link href="/" className="mt-6 inline-block text-sm text-blue hover:underline">
            ← Back to home
          </Link>
        </section>
      </main>
    </>
  );
}
