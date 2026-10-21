import { NextRequest, NextResponse } from "next/server";

import type { AuditApiResponse } from "@/lib/audit-types";
import { auditCacheHeaders } from "@/lib/cache-headers";
import { INVALID_DOMAIN_MESSAGE, performAudit } from "@/lib/perform-audit";

export const runtime = "nodejs";
// PageSpeed Insights can take 45 s; 60 s is the Vercel Hobby ceiling.
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const searchParams = req.nextUrl.searchParams;
  return respond(searchParams.get("url") ?? searchParams.get("domain") ?? "");
}

export async function POST(req: NextRequest) {
  let body: { url?: string; domain?: string };
  try {
    body = (await req.json()) as { url?: string; domain?: string };
  } catch {
    return NextResponse.json(
      { status: "error", message: "Invalid JSON body." } satisfies AuditApiResponse,
      { status: 400 },
    );
  }
  return respond(body.url ?? body.domain ?? "");
}

async function respond(rawUrl: string) {
  const result = await performAudit(rawUrl);

  if (result.status === "ready") {
    const payload: AuditApiResponse = { status: "ready", audit: result.audit };
    return NextResponse.json(payload, { headers: auditCacheHeaders(result.audit) });
  }

  const status = result.message === INVALID_DOMAIN_MESSAGE ? 400 : 502;
  const payload: AuditApiResponse = { status: "error", message: result.message };
  return NextResponse.json(payload, { status });
}
