import { runAudit } from "@/lib/audit";
import type { AuditResult } from "@/lib/audit-types";
import { FetchError } from "@/lib/net/safe-fetch";
import { displayHost, normalizeAuditUrl } from "@/lib/url";

export type PerformAuditResult =
  | { status: "ready"; audit: AuditResult; domain: string }
  | { status: "error"; message: string };

export const INVALID_DOMAIN_MESSAGE = "Enter a valid URL.";

export async function performAudit(
  rawUrl: string,
): Promise<PerformAuditResult> {
  const url = normalizeAuditUrl(rawUrl);
  if (!url) return { status: "error", message: INVALID_DOMAIN_MESSAGE };

  try {
    const audit = await runAudit(url, {
      pageSpeedApiKey: process.env.PAGESPEED_API_KEY || undefined,
    });
    return { status: "ready", audit, domain: displayHost(url) };
  } catch (error) {
    if (error instanceof FetchError) {
      return { status: "error", message: error.message };
    }
    console.error("Audit failed", url, error);
    return { status: "error", message: "Audit failed. Please try again." };
  }
}
