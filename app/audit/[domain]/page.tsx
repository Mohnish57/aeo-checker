import type { Metadata } from "next";
import Link from "next/link";

import { AuditForm } from "@/components/audit-form";
import { AuditResultsView } from "@/components/audit-results-view";
import { auditPageSchemas, jsonLdScript } from "@/lib/json-ld";
import { performAudit } from "@/lib/perform-audit";

export const runtime = "nodejs";
export const maxDuration = 120;

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

type PageProps = {
  params: Promise<{ domain: string }>;
  searchParams: Promise<{ url?: string }>;
};

function decodeDomain(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function resolveAuditUrl(domainParam: string, urlParam?: string): string {
  if (urlParam) {
    try {
      return decodeURIComponent(urlParam);
    } catch {
      // fall through
    }
  }
  return `https://${domainParam}/`;
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
  const auditTarget = resolveAuditUrl(decoded, urlParam);
  const result = await performAudit(auditTarget);

  if (result.status === "error") {
    return (
      <ErrorScreen
        eyebrow={`could not audit ${decoded}`}
        title="Audit failed."
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
  eyebrow,
  title,
  message,
  retryDomain,
}: {
  eyebrow: string;
  title: string;
  message: string;
  retryDomain?: string;
}) {
  return (
    <main className="relative min-h-dvh overflow-hidden bg-canvas">
      <div
        aria-hidden
        className="pointer-events-none absolute -right-10 -bottom-32 select-none text-[24rem] font-medium leading-none tracking-tighter text-red/5 sm:text-[32rem]"
      >
        ✕
      </div>
      <section className="relative mx-auto grid w-full max-w-7xl gap-10 px-5 py-16 sm:px-8 sm:py-24">
        <div className="font-mono text-xs uppercase tracking-[0.28em] text-red">
          ◢ {eyebrow}
        </div>
        <h1 className="max-w-3xl text-5xl font-medium tracking-[-0.03em] text-balance text-ink sm:text-7xl">
          {title}
        </h1>
        <p className="max-w-prose text-base/7 text-pretty text-muted sm:text-lg/8">
          {message}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-6 font-mono text-xs uppercase tracking-[0.22em]">
          <Link
            href="/"
            className="border-b-2 border-ink pb-1 text-ink transition hover:border-teal hover:text-teal"
          >
            ◂ back home
          </Link>
          {retryDomain ? (
            <span className="text-muted">
              tried: <span className="text-ink">{retryDomain}</span>
            </span>
          ) : null}
        </div>
        <div className="mt-8 max-w-xl border-t hairline pt-8">
          <AuditForm initialDomain={retryDomain} />
        </div>
      </section>
    </main>
  );
}
