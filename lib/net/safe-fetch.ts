/**
 * Fetch a user-supplied URL without letting it reach private networks.
 *
 * - Only http(s) on ports 80/443.
 * - Every redirect hop is re-validated; DNS answers are checked both before
 *   the request and at connect time (guards against DNS rebinding).
 * - Hard timeout and body-size cap.
 *
 * FetchError messages are shown to users as-is.
 */
import { lookup } from "node:dns/promises";
import { isIP, type LookupFunction } from "node:net";

import ipaddr from "ipaddr.js";
import { Agent, fetch as undiciFetch, type Response } from "undici";

export type FetchErrorCode =
  | "invalid-url"
  | "blocked-address"
  | "timeout"
  | "unreachable"
  | "too-large"
  | "too-many-redirects"
  | "blocked"
  | "http-error"
  | "not-html";

export class FetchError extends Error {
  readonly code: FetchErrorCode;

  constructor(code: FetchErrorCode, message: string) {
    super(message);
    this.name = "FetchError";
    this.code = code;
  }
}

export type FetchResult = {
  finalUrl: string;
  status: number;
  contentType: string;
  body: string;
  redirects: number;
};

export type SafeFetchOptions = {
  timeoutMs?: number;
  maxBytes?: number;
  /** Return the first `maxBytes` instead of throwing `too-large`. */
  truncate?: boolean;
  maxRedirects?: number;
  accept?: string;
  /** Tests only: allow loopback/private targets. */
  allowPrivateNetwork?: boolean;
  /** Tests only: allow non-standard ports. */
  allowAnyPort?: boolean;
};

export const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 AEOChecker/1.0";

const BLOCKED_ADDRESS_MESSAGE =
  "That address points to a private or internal network, so it can't be audited.";

export function isPublicAddress(ip: string): boolean {
  if (!ipaddr.isValid(ip)) return false;
  let addr = ipaddr.parse(ip);
  if (addr.kind() === "ipv6") {
    const v6 = addr as ipaddr.IPv6;
    if (v6.isIPv4MappedAddress()) addr = v6.toIPv4Address();
  }
  return addr.range() === "unicast";
}

export async function assertPublicHost(url: URL): Promise<void> {
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(hostname)) {
    if (!isPublicAddress(hostname)) {
      throw new FetchError("blocked-address", BLOCKED_ADDRESS_MESSAGE);
    }
    return;
  }
  let addresses: { address: string }[];
  try {
    addresses = await lookup(hostname, { all: true });
  } catch {
    throw new FetchError(
      "unreachable",
      `We couldn't find ${hostname}. Check the URL is spelled correctly.`,
    );
  }
  if (!addresses.length || addresses.some((a) => !isPublicAddress(a.address))) {
    throw new FetchError("blocked-address", BLOCKED_ADDRESS_MESSAGE);
  }
}

// Connect-time guard: re-checks the addresses the socket will actually use.
function guardedLookup(
  hostname: string,
  options: { all?: boolean },
  callback: (
    error: Error | null,
    address?: string | { address: string; family: number }[],
    family?: number,
  ) => void,
): void {
  lookup(hostname, { all: true }).then(
    (addresses) => {
      if (
        !addresses.length ||
        addresses.some((a) => !isPublicAddress(a.address))
      ) {
        callback(new FetchError("blocked-address", BLOCKED_ADDRESS_MESSAGE));
        return;
      }
      if (options.all) callback(null, addresses);
      else callback(null, addresses[0].address, addresses[0].family);
    },
    (error: Error) => callback(error),
  );
}

const publicAgent = new Agent({
  connect: { lookup: guardedLookup as unknown as LookupFunction },
});

function parseHttpUrl(raw: string, allowAnyPort: boolean): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new FetchError("invalid-url", "Enter a valid http(s) URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new FetchError("invalid-url", "Only http and https URLs can be audited.");
  }
  if (!allowAnyPort && url.port && url.port !== "80" && url.port !== "443") {
    throw new FetchError(
      "invalid-url",
      "Only standard web ports (80 and 443) can be audited.",
    );
  }
  return url;
}

export async function safeFetch(
  rawUrl: string,
  options: SafeFetchOptions = {},
): Promise<FetchResult> {
  const {
    timeoutMs = 10_000,
    maxBytes = 3_000_000,
    truncate = false,
    maxRedirects = 5,
    accept = "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
    allowPrivateNetwork = false,
    allowAnyPort = false,
  } = options;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let current = parseHttpUrl(rawUrl, allowAnyPort);
    for (let redirects = 0; ; redirects++) {
      if (!allowPrivateNetwork) await assertPublicHost(current);

      const response = await undiciFetch(current, {
        redirect: "manual",
        signal: controller.signal,
        dispatcher: allowPrivateNetwork ? undefined : publicAgent,
        headers: {
          "user-agent": USER_AGENT,
          accept,
          "accept-language": "en-US,en;q=0.9",
        },
      });

      const location = response.headers.get("location");
      if (response.status >= 300 && response.status < 400 && location) {
        await response.body?.cancel();
        if (redirects >= maxRedirects) {
          throw new FetchError(
            "too-many-redirects",
            `The page redirects more than ${maxRedirects} times.`,
          );
        }
        current = parseHttpUrl(
          new URL(location, current).toString(),
          allowAnyPort,
        );
        continue;
      }

      const body = await readBody(response, maxBytes, truncate);
      return {
        finalUrl: current.toString(),
        status: response.status,
        contentType: response.headers.get("content-type") ?? "",
        body,
        redirects,
      };
    }
  } catch (error) {
    throw toFetchError(error, controller.signal, timeoutMs);
  } finally {
    clearTimeout(timer);
  }
}

async function readBody(
  response: Response,
  maxBytes: number,
  truncate: boolean,
): Promise<string> {
  const tooLarge = () =>
    new FetchError(
      "too-large",
      `The page is larger than ${Math.round(maxBytes / 1_000_000)} MB, which is beyond what we audit.`,
    );

  const declared = Number(response.headers.get("content-length") ?? 0);
  if (!truncate && declared > maxBytes) {
    await response.body?.cancel();
    throw tooLarge();
  }
  if (!response.body) return "";

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (total + value.byteLength > maxBytes) {
      await reader.cancel();
      if (!truncate) throw tooLarge();
      chunks.push(value.subarray(0, maxBytes - total));
      total = maxBytes;
      break;
    }
    chunks.push(value);
    total += value.byteLength;
  }
  return decode(Buffer.concat(chunks), response.headers.get("content-type"));
}

function decode(bytes: Buffer, contentType: string | null): string {
  const charset = contentType?.match(/charset\s*=\s*"?([\w-]+)/i)?.[1];
  try {
    return new TextDecoder(charset ?? "utf-8").decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

function toFetchError(
  error: unknown,
  signal: AbortSignal,
  timeoutMs: number,
): FetchError {
  if (error instanceof FetchError) return error;
  if (signal.aborted) {
    return new FetchError(
      "timeout",
      `The site took longer than ${timeoutMs / 1000} seconds to respond. Try again, or check the site is up.`,
    );
  }
  // undici wraps connect errors: TypeError("fetch failed", { cause }).
  let cause: unknown = error;
  for (let i = 0; i < 4 && cause; i++) {
    if (cause instanceof FetchError) return cause;
    cause = (cause as { cause?: unknown }).cause;
  }
  return new FetchError(
    "unreachable",
    "We couldn't reach that site. Check the URL is correct and publicly accessible.",
  );
}
