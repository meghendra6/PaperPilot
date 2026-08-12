import { normalizeHttpURL } from "../normalize";
import type { PublicationEvidenceType } from "../types";
import { type DiscoveryFetch, withDiscoveryFetchTimeout } from "./types";

declare const Zotero: any;
declare const Components: any;

type HostResolver = (hostname: string) => Promise<string[]>;

type ResponseWithConnection = Response & {
  remoteAddress?: string;
};

const MAX_OFFICIAL_BODY_BYTES = 200_000;

const SOURCE_FAMILIES: Array<{
  id: string;
  type: PublicationEvidenceType;
  domains: string[];
}> = [
  { id: "openreview", type: "official_decision", domains: ["openreview.net"] },
  {
    id: "acl-anthology",
    type: "official_anthology",
    domains: ["aclanthology.org"],
  },
  {
    id: "pmlr",
    type: "official_proceedings",
    domains: ["proceedings.mlr.press"],
  },
  {
    id: "cvf",
    type: "official_proceedings",
    domains: ["openaccess.thecvf.com"],
  },
  {
    id: "neurips",
    type: "official_proceedings",
    domains: ["proceedings.neurips.cc"],
  },
  { id: "acm", type: "publisher_proceedings", domains: ["dl.acm.org"] },
  {
    id: "ieee",
    type: "publisher_proceedings",
    domains: ["ieeexplore.ieee.org"],
  },
  { id: "usenix", type: "official_proceedings", domains: ["usenix.org"] },
  {
    id: "springer",
    type: "publisher_proceedings",
    domains: ["link.springer.com"],
  },
];

export function classifyOfficialEvidenceURL(urlValue: string) {
  const normalized = normalizeHttpURL(urlValue);
  if (!normalized) return undefined;
  const hostname = new URL(normalized).hostname.toLowerCase();
  const family = SOURCE_FAMILIES.find((entry) =>
    entry.domains.some(
      (domain) => hostname === domain || hostname.endsWith(`.${domain}`),
    ),
  );
  return family ? { ...family, url: normalized } : undefined;
}

const NON_OFFICIAL_DOMAINS = [
  "arxiv.org",
  "semanticscholar.org",
  "dblp.org",
  "scholar.google.com",
  "researchgate.net",
  "openalex.org",
  "crossref.org",
];

export function isPlausibleOfficialEvidenceURL(urlValue: string) {
  const normalized = normalizeHttpURL(urlValue);
  if (!normalized) return false;
  const parsed = new URL(normalized);
  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return (
    parsed.protocol === "https:" &&
    !NON_OFFICIAL_DOMAINS.some(
      (domain) => hostname === domain || hostname.endsWith(`.${domain}`),
    ) &&
    hostname !== "localhost" &&
    !hostname.endsWith(".localhost") &&
    !hostname.endsWith(".local") &&
    !isNonPublicIPAddress(hostname)
  );
}

function parseIPv4(value: string) {
  const parts = value.split(".").map(Number);
  return parts.length === 4 &&
    parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
    ? parts
    : undefined;
}

function mappedIPv4(value: string) {
  const normalized = value.toLowerCase().replace(/^\[|\]$/g, "");
  const dotted = normalized.match(/(?:^|:)ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (dotted) return dotted;
  const hex = normalized.match(/(?:^|:)ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (!hex) return undefined;
  const high = Number.parseInt(hex[1], 16);
  const low = Number.parseInt(hex[2], 16);
  return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
}

export function isNonPublicIPAddress(value: string) {
  const normalized = value
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .split("%")[0];
  const mapped = mappedIPv4(normalized);
  const ipv4 = parseIPv4(mapped || normalized);
  if (ipv4) {
    const [a, b, c] = ipv4;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0 && c === 0) ||
      (a === 192 && b === 0 && c === 2) ||
      (a === 192 && b === 88 && c === 99) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113) ||
      a >= 224
    );
  }
  if (!normalized.includes(":")) return false;
  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    /^fe[89ab]/.test(normalized) ||
    normalized.startsWith("ff") ||
    normalized.startsWith("2001:db8:")
  );
}

async function defaultResolveHost(hostname: string) {
  if (parseIPv4(hostname) || hostname.includes(":")) return [hostname];
  const services = (globalThis as { Services?: any }).Services;
  if (!services?.dns) return [];
  return new Promise<string[]>((resolve, reject) => {
    services.dns.asyncResolve(
      hostname,
      0,
      1,
      services.dns.newAdditionalInfo("", -1),
      {
        onLookupComplete(_request: unknown, record: any, status: number) {
          if (!Components.isSuccessCode(status)) {
            reject(new Error("Official evidence DNS resolution failed."));
            return;
          }
          const addresses: string[] = [];
          try {
            const addressRecord = record.QueryInterface?.(
              Components.interfaces.nsIDNSAddrRecord,
            );
            if (!addressRecord) {
              reject(
                new Error("Official evidence DNS record was unavailable."),
              );
              return;
            }
            while (addressRecord.hasMore()) {
              addresses.push(addressRecord.getNextAddrAsString());
            }
            resolve(addresses);
          } catch (error) {
            reject(error);
          }
        },
      },
      services.tm.mainThread,
    );
  });
}

async function assertPublicResolution(
  hostname: string,
  resolver: HostResolver,
) {
  const addresses = await resolver(hostname);
  if (!addresses.length) {
    // Node/test fetchers do not expose Gecko DNS. Production Zotero always does.
    return;
  }
  if (addresses.some(isNonPublicIPAddress)) {
    throw new Error("Official evidence host resolved to a non-public address.");
  }
}

function headersFromXHR(xhr: XMLHttpRequest) {
  const headers = new Headers();
  for (const line of xhr
    .getAllResponseHeaders()
    .trim()
    .split(/[\r\n]+/)) {
    const separator = line.indexOf(":");
    if (separator > 0) {
      headers.append(
        line.slice(0, separator).trim(),
        line.slice(separator + 1).trim(),
      );
    }
  }
  return headers;
}

function getXHRRemoteAddress(xhr: XMLHttpRequest) {
  const channel = (xhr as XMLHttpRequest & { channel?: any }).channel;
  if (!channel) return undefined;
  try {
    const interfaces = Components?.interfaces;
    if (!interfaces?.nsIHttpChannelInternal) return undefined;
    return channel.QueryInterface?.(interfaces.nsIHttpChannelInternal)
      .remoteAddress;
  } catch {
    return undefined;
  }
}

async function secureZoteroRequest(
  url: string,
  signal?: AbortSignal,
  timeoutMs = 15_000,
) {
  if (typeof Zotero === "undefined" || !Zotero.HTTP?.request) {
    throw new Error("Secure official-evidence transport is unavailable.");
  }
  let cancel: (() => void) | undefined;
  let observedRemoteAddress: string | undefined;
  let boundaryError: Error | undefined;
  const abort = () => cancel?.();
  signal?.addEventListener("abort", abort, { once: true });
  try {
    if (signal?.aborted)
      throw new Error("Official evidence request cancelled.");
    const xhr = await Zotero.HTTP.request("GET", url, {
      headers: {
        Accept: "text/html,application/json",
        Connection: "close",
      },
      followRedirects: false,
      noCache: true,
      timeout: Math.max(1, timeoutMs),
      errorDelayMax: 0,
      successCodes: false,
      cancellerReceiver: (value: () => void) => {
        cancel = value;
        if (signal?.aborted) value();
      },
      requestObserver: (request: XMLHttpRequest) => {
        // A cached response has no observable peer address. Force a new
        // connection so the address checked below is the address that served
        // this evidence body, closing the DNS-rebinding gap.
        try {
          const channel = (request as XMLHttpRequest & { channel?: any })
            .channel;
          const requestFlags = Components?.interfaces?.nsIRequest;
          if (channel && requestFlags) {
            channel.loadFlags |=
              requestFlags.LOAD_BYPASS_CACHE |
              requestFlags.INHIBIT_CACHING |
              requestFlags.LOAD_FRESH_CONNECTION;
          }
        } catch {
          boundaryError = new Error(
            "Official evidence transport could not force a fresh connection.",
          );
          request.abort();
          return;
        }
        const inspectConnection = () => {
          const address = getXHRRemoteAddress(request);
          if (!address) return;
          observedRemoteAddress = address;
          if (isNonPublicIPAddress(address)) {
            boundaryError = new Error(
              "Official evidence connection used a non-public address.",
            );
            request.abort();
          }
        };
        request.addEventListener("readystatechange", inspectConnection);
        request.addEventListener("progress", (event) => {
          inspectConnection();
          if (event.loaded > MAX_OFFICIAL_BODY_BYTES) {
            boundaryError = new Error(
              "Official evidence response exceeded the 200 KB limit.",
            );
            request.abort();
          }
        });
      },
    }).catch((error: unknown) => {
      if (boundaryError) throw boundaryError;
      if (signal?.aborted) {
        throw new Error("Official evidence request cancelled.");
      }
      throw error;
    });
    const finalRemoteAddress =
      observedRemoteAddress || getXHRRemoteAddress(xhr);
    if (!finalRemoteAddress) {
      throw new Error(
        "Official evidence connection address could not be verified.",
      );
    }
    if (isNonPublicIPAddress(finalRemoteAddress)) {
      throw new Error(
        "Official evidence connection used a non-public address.",
      );
    }
    const response = new Response(xhr.responseText || "", {
      status: xhr.status,
      statusText: xhr.statusText,
      headers: headersFromXHR(xhr),
    }) as ResponseWithConnection;
    response.remoteAddress = finalRemoteAddress;
    return response;
  } finally {
    signal?.removeEventListener("abort", abort);
  }
}

function stripHtml(value: string) {
  return value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

async function readResponseTextBounded(
  response: Response,
  maxBytes = MAX_OFFICIAL_BODY_BYTES,
) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let output = "";
  try {
    while (bytesRead < maxBytes) {
      const { value, done } = await reader.read();
      if (done) break;
      const remaining = maxBytes - bytesRead;
      const chunk =
        value.byteLength > remaining ? value.slice(0, remaining) : value;
      bytesRead += chunk.byteLength;
      output += decoder.decode(chunk, { stream: bytesRead < maxBytes });
      if (chunk.byteLength < value.byteLength) break;
    }
    output += decoder.decode();
    return output;
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

export async function inspectOfficialEvidenceURL(params: {
  url: string;
  fetch?: DiscoveryFetch;
  signal?: AbortSignal;
  resolveHost?: HostResolver;
  now?: () => number;
  deadline?: number;
}) {
  if (!isPlausibleOfficialEvidenceURL(params.url)) {
    throw new Error("Official evidence URL is not a public HTTPS source.");
  }
  const resolver = params.resolveHost || defaultResolveHost;
  const now = params.now || Date.now;
  const deadline = params.deadline ?? now() + 15_000;
  const requestTimeout = () => Math.max(1, Math.min(15_000, deadline - now()));
  const fetcher = params.fetch
    ? withDiscoveryFetchTimeout(params.fetch, requestTimeout(), params.signal)
    : undefined;
  let url = normalizeHttpURL(params.url)!;
  let response: ResponseWithConnection | undefined;
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    if (now() >= deadline) throw new Error("Discovery request timed out.");
    if (!isPlausibleOfficialEvidenceURL(url)) {
      throw new Error(
        "Official evidence redirect left the public HTTPS boundary.",
      );
    }
    await assertPublicResolution(new URL(url).hostname, resolver);
    response = fetcher
      ? ((await fetcher(url, {
          headers: { Accept: "text/html,application/json" },
          redirect: "manual",
        })) as ResponseWithConnection)
      : await secureZoteroRequest(url, params.signal, requestTimeout());
    if (
      response.remoteAddress &&
      isNonPublicIPAddress(response.remoteAddress)
    ) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error(
        "Official evidence connection used a non-public address.",
      );
    }
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    const location = response.headers.get("location");
    await response.body?.cancel().catch(() => undefined);
    if (!location)
      throw new Error("Official evidence redirect was incomplete.");
    if (redirects === 5)
      throw new Error("Too many official evidence redirects.");
    url = new URL(location, url).href;
    response = undefined;
  }
  if (!response) throw new Error("Official evidence request did not complete.");
  if (!response.ok) {
    throw new Error(`Official evidence request failed (${response.status}).`);
  }
  const finalURL = url;
  if (!isPlausibleOfficialEvidenceURL(finalURL)) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(
      "Official evidence redirect left the public HTTPS boundary.",
    );
  }
  const contentType = response.headers.get("content-type")?.toLowerCase() || "";
  const isPdf = contentType.includes("application/pdf");
  const body = isPdf ? "" : await readResponseTextBounded(response);
  if (isPdf) await response.body?.cancel().catch(() => undefined);
  const title =
    body
      .match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
      ?.replace(/\s+/g, " ")
      .trim() || undefined;
  return {
    url: finalURL,
    hostname: new URL(finalURL).hostname,
    sourceFamily:
      classifyOfficialEvidenceURL(finalURL)?.id || "generic-official-web",
    pageTitle: title,
    searchableText: stripHtml(body),
    contentType: contentType || undefined,
    bodyInspected: !isPdf,
    checkedAt: new Date().toISOString(),
  };
}

export const OFFICIAL_SOURCE_FAMILIES = SOURCE_FAMILIES.map((entry) => ({
  ...entry,
  domains: [...entry.domains],
}));
