import { normalizeHttpURL } from "../normalize";
import type { PublicationEvidenceType } from "../types";
import {
  createDiscoveryAbortController,
  type DiscoveryFetch,
  withDiscoveryFetchTimeout,
} from "./types";

declare const Zotero: any;
declare const Components: any;

type HostResolver = (
  hostname: string,
  signal?: AbortSignal,
) => Promise<string[]>;

type ResponseWithConnection = Response & {
  remoteAddress?: string;
};

const MAX_OFFICIAL_BODY_BYTES = 200_000;
const MAX_OPENREVIEW_API_BODY_BYTES = 2_000_000;
const MAX_HTML_HEURISTIC_BYTES = 64_000;

function normalizedHostname(value: string) {
  return value
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.+$/g, "");
}

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
  { id: "isca", type: "official_program", domains: ["iscaconf.org"] },
  {
    id: "springer",
    type: "publisher_proceedings",
    domains: ["link.springer.com"],
  },
];

export function classifyOfficialEvidenceURL(urlValue: string) {
  const normalized = normalizeHttpURL(urlValue);
  if (!normalized) return undefined;
  const parsed = new URL(normalized);
  const rawHostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const hostname = normalizedHostname(rawHostname);
  if (!hostname || hostname !== rawHostname || parsed.port) return undefined;
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
  const rawHostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const hostname = normalizedHostname(rawHostname);
  return (
    parsed.protocol === "https:" &&
    parsed.port === "" &&
    Boolean(hostname) &&
    hostname === rawHostname &&
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

function parseIPv6(value: string) {
  let normalized = value.toLowerCase().split("%")[0];
  const dottedTail = normalized.match(/(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (dottedTail) {
    const ipv4 = parseIPv4(dottedTail);
    if (!ipv4) return undefined;
    const [a, b, c, d] = ipv4;
    normalized = `${normalized.slice(0, -dottedTail.length)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  if (!/^[0-9a-f:]+$/.test(normalized) || normalized.split("::").length > 2) {
    return undefined;
  }
  const [leftText, rightText] = normalized.split("::");
  const left = leftText ? leftText.split(":") : [];
  const right = rightText ? rightText.split(":") : [];
  if ([...left, ...right].some((part) => !/^[0-9a-f]{1,4}$/.test(part))) {
    return undefined;
  }
  const missing = 8 - left.length - right.length;
  if (
    (normalized.includes("::") && missing < 1) ||
    (!normalized.includes("::") && missing !== 0)
  ) {
    return undefined;
  }
  return [...left, ...Array(Math.max(0, missing)).fill("0"), ...right].map(
    (part) => Number.parseInt(part, 16),
  );
}

export function isNonPublicIPAddress(value: string) {
  const normalized = value
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .split("%")[0];
  const ipv4 = parseIPv4(normalized);
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
  const words = parseIPv6(normalized);
  if (!words) return true;

  // Fail closed: only globally routable IPv6 unicast (2000::/3) may cross the
  // official-source boundary. Explicitly reject documentation, benchmark,
  // ORCHID, and transition ranges inside that aggregate.
  if (words[0] < 0x2000 || words[0] > 0x3fff) return true;
  if (words[0] === 0x2001) {
    if (words[1] === 0x0000) return true; // Teredo and related special use
    if (words[1] === 0x0002) return true; // benchmarking
    if (words[1] === 0x0db8) return true; // documentation
    if (words[1] >= 0x0010 && words[1] <= 0x002f) return true; // ORCHID
  }
  if (words[0] === 0x2002) {
    const embedded = [
      words[1] >> 8,
      words[1] & 255,
      words[2] >> 8,
      words[2] & 255,
    ].join(".");
    return isNonPublicIPAddress(embedded);
  }
  return false;
}

function isIPAddressLiteral(value: string) {
  const normalized = value
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .split("%")[0];
  return Boolean(parseIPv4(normalized) || parseIPv6(normalized));
}

async function defaultResolveHost(hostname: string, signal?: AbortSignal) {
  if (parseIPv4(hostname) || hostname.includes(":")) return [hostname];
  const services = (globalThis as { Services?: any }).Services;
  if (!services?.dns) {
    throw new Error("Official evidence DNS resolver is unavailable.");
  }
  return new Promise<string[]>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      callback();
    };
    const requestHolder: {
      current?: { cancel?: (status: number) => void };
    } = {};
    const onAbort = () => {
      try {
        requestHolder.current?.cancel?.(Components.results.NS_BINDING_ABORTED);
      } finally {
        finish(() => reject(new Error("Official evidence request cancelled.")));
      }
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
      return;
    }
    requestHolder.current = services.dns.asyncResolve(
      hostname,
      0,
      1,
      services.dns.newAdditionalInfo("", -1),
      {
        onLookupComplete(_request: unknown, record: any, status: number) {
          if (!Components.isSuccessCode(status)) {
            finish(() =>
              reject(new Error("Official evidence DNS resolution failed.")),
            );
            return;
          }
          const addresses: string[] = [];
          try {
            const addressRecord = record.QueryInterface?.(
              Components.interfaces.nsIDNSAddrRecord,
            );
            if (!addressRecord) {
              finish(() =>
                reject(
                  new Error("Official evidence DNS record was unavailable."),
                ),
              );
              return;
            }
            while (addressRecord.hasMore()) {
              addresses.push(addressRecord.getNextAddrAsString());
            }
            finish(() => resolve(addresses));
          } catch (error) {
            finish(() => reject(error));
          }
        },
      },
      services.tm.mainThread,
    );
  });
}

function waitForBoundary<T>(
  operation: Promise<T>,
  params: {
    signal?: AbortSignal;
    deadline: number;
    now: () => number;
    timeoutMessage: string;
    cancelMessage: string;
  },
) {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      params.signal?.removeEventListener("abort", onAbort);
      callback();
    };
    const onAbort = () => finish(() => reject(new Error(params.cancelMessage)));
    const remaining = Math.max(0, params.deadline - params.now());
    const timer = setTimeout(
      () => finish(() => reject(new Error(params.timeoutMessage))),
      remaining,
    );
    params.signal?.addEventListener("abort", onAbort, { once: true });
    if (params.signal?.aborted) {
      onAbort();
      return;
    }
    operation.then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error)),
    );
  });
}

async function assertPublicResolution(
  hostname: string,
  resolver: HostResolver,
  signal: AbortSignal | undefined,
  deadline: number,
  now: () => number,
) {
  const resolutionController = createDiscoveryAbortController();
  const propagateAbort = () => resolutionController.abort(signal?.reason);
  signal?.addEventListener("abort", propagateAbort, { once: true });
  if (signal?.aborted) propagateAbort();
  let addresses: string[];
  try {
    addresses = await waitForBoundary(
      resolver(normalizedHostname(hostname), resolutionController.signal),
      {
        signal,
        deadline,
        now,
        timeoutMessage: "Discovery DNS resolution timed out.",
        cancelMessage: "Official evidence request cancelled.",
      },
    );
  } finally {
    resolutionController.abort();
    signal?.removeEventListener("abort", propagateAbort);
  }
  if (!addresses.length) {
    throw new Error("Official evidence DNS resolution returned no addresses.");
  }
  if (
    addresses.some(
      (address) =>
        !isIPAddressLiteral(address) || isNonPublicIPAddress(address),
    )
  ) {
    throw new Error("Official evidence host resolved to a non-public address.");
  }
}

export function headersFromXHR(
  xhr: Partial<
    Pick<XMLHttpRequest, "getAllResponseHeaders" | "getResponseHeader">
  >,
) {
  const headers = new Headers();
  const raw =
    typeof xhr.getAllResponseHeaders === "function"
      ? xhr.getAllResponseHeaders() || ""
      : "";
  for (const line of raw.trim().split(/[\r\n]+/)) {
    const separator = line.indexOf(":");
    if (separator > 0) {
      const name = line.slice(0, separator).trim();
      const value = line.slice(separator + 1).trim();
      if (/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)) {
        try {
          headers.append(name, value);
        } catch {
          // Ignore malformed response-header lines from the Gecko XHR shim.
        }
      }
    }
  }
  for (const name of ["location", "content-type"]) {
    if (!headers.has(name) && typeof xhr.getResponseHeader === "function") {
      const value = xhr.getResponseHeader(name);
      if (value) headers.set(name, value);
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
  let observedRequest: XMLHttpRequest | undefined;
  let responseIsPDF = false;
  // Gecko resets status to 0 and drops response headers once abort() runs, so
  // the PDF short-circuit must snapshot them before aborting the transfer.
  let pdfResponseSnapshot:
    | { status: number; statusText: string; headers: Headers }
    | undefined;
  const abort = () => cancel?.();
  signal?.addEventListener("abort", abort, { once: true });
  try {
    if (signal?.aborted)
      throw new Error("Official evidence request cancelled.");
    const request = Zotero.HTTP.request("GET", url, {
      anon: true,
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
        observedRequest = request;
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
          if (!isIPAddressLiteral(address) || isNonPublicIPAddress(address)) {
            boundaryError = new Error(
              "Official evidence connection used a non-public address.",
            );
            request.abort();
            return;
          }
          if (
            request.readyState >= 2 &&
            request
              .getResponseHeader("content-type")
              ?.toLowerCase()
              .includes("application/pdf")
          ) {
            responseIsPDF = true;
            pdfResponseSnapshot = {
              status: request.status,
              statusText: request.statusText || "",
              headers: headersFromXHR(request),
            };
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
      if (responseIsPDF && observedRequest) return observedRequest;
      if (signal?.aborted) {
        throw new Error("Official evidence request cancelled.");
      }
      throw error;
    });
    let xhr: XMLHttpRequest;
    try {
      xhr = await waitForBoundary<XMLHttpRequest>(request, {
        signal,
        deadline: Date.now() + Math.max(1, timeoutMs),
        now: Date.now,
        timeoutMessage: "Official evidence request timed out.",
        cancelMessage: "Official evidence request cancelled.",
      });
    } catch (error) {
      cancel?.();
      throw error;
    }
    const finalRemoteAddress =
      observedRemoteAddress || getXHRRemoteAddress(xhr);
    if (!finalRemoteAddress) {
      throw new Error(
        "Official evidence connection address could not be verified.",
      );
    }
    if (
      !isIPAddressLiteral(finalRemoteAddress) ||
      isNonPublicIPAddress(finalRemoteAddress)
    ) {
      throw new Error(
        "Official evidence connection used a non-public address.",
      );
    }
    const response = (
      responseIsPDF && pdfResponseSnapshot
        ? new Response(null, pdfResponseSnapshot)
        : new Response(xhr.responseText || "", {
            status: xhr.status,
            statusText: xhr.statusText || "",
            headers: headersFromXHR(xhr as XMLHttpRequest),
          })
    ) as ResponseWithConnection;
    response.remoteAddress = finalRemoteAddress;
    return response;
  } finally {
    signal?.removeEventListener("abort", abort);
  }
}

function stripHtml(value: string) {
  return value
    .slice(0, MAX_HTML_HEURISTIC_BYTES)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function linkedHostnames(value: string, baseURL: string) {
  const hosts = new Set<string>();
  for (const match of value
    .slice(0, MAX_HTML_HEURISTIC_BYTES)
    .matchAll(
      /<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
    )) {
    const label = stripHtml(match[2]);
    if (
      !/\bofficial\b/i.test(label) ||
      !/\b(?:conference|venue|program(?:me)?|proceedings|website)\b/i.test(
        label,
      )
    ) {
      continue;
    }
    try {
      const linked = new URL(match[1], baseURL);
      if (linked.protocol === "https:") {
        hosts.add(normalizedHostname(linked.hostname));
      }
    } catch {
      // Ignore malformed links from untrusted response bodies.
    }
  }
  return [...hosts];
}

async function readResponseTextBounded(
  response: Response,
  params: {
    maxBytes?: number;
    signal?: AbortSignal;
    deadline: number;
    now: () => number;
  },
) {
  const maxBytes = params.maxBytes ?? MAX_OFFICIAL_BODY_BYTES;
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error(
      `Official evidence response exceeded the ${maxBytes}-byte body limit.`,
    );
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let output = "";
  try {
    while (bytesRead < maxBytes) {
      const { value, done } = await waitForBoundary<
        ReadableStreamReadResult<any>
      >(reader.read(), {
        signal: params.signal,
        deadline: params.deadline,
        now: params.now,
        timeoutMessage: "Official evidence response body timed out.",
        cancelMessage: "Official evidence request cancelled.",
      });
      if (done) break;
      const remaining = maxBytes - bytesRead;
      const chunk =
        value.byteLength > remaining ? value.slice(0, remaining) : value;
      bytesRead += chunk.byteLength;
      output += decoder.decode(chunk, { stream: bytesRead < maxBytes });
      if (chunk.byteLength < value.byteLength) {
        throw new Error(
          `Official evidence response exceeded the ${maxBytes}-byte body limit.`,
        );
      }
    }
    output += decoder.decode();
    return output;
  } finally {
    void reader.cancel().catch(() => undefined);
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
  // An injected fetch is a trusted test boundary and cannot expose its peer
  // address. Production calls use Zotero transport and the Gecko resolver.
  const resolver =
    params.resolveHost ||
    (params.fetch ? async () => ["93.184.216.34"] : defaultResolveHost);
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
    await assertPublicResolution(
      new URL(url).hostname,
      resolver,
      params.signal,
      deadline,
      now,
    );
    response = fetcher
      ? ((await fetcher(url, {
          headers: { Accept: "text/html,application/json" },
          redirect: "manual",
        })) as ResponseWithConnection)
      : await secureZoteroRequest(url, params.signal, requestTimeout());
    if (
      response.remoteAddress &&
      (!isIPAddressLiteral(response.remoteAddress) ||
        isNonPublicIPAddress(response.remoteAddress))
    ) {
      void response.body?.cancel().catch(() => undefined);
      throw new Error(
        "Official evidence connection used a non-public address.",
      );
    }
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    const location = response.headers.get("location");
    void response.body?.cancel().catch(() => undefined);
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
    void response.body?.cancel().catch(() => undefined);
    throw new Error(
      "Official evidence redirect left the public HTTPS boundary.",
    );
  }
  const contentType = response.headers.get("content-type")?.toLowerCase() || "";
  const isPdf = contentType.includes("application/pdf");
  const body = isPdf
    ? ""
    : await readResponseTextBounded(response, {
        signal: params.signal,
        deadline,
        now,
      });
  if (isPdf) void response.body?.cancel().catch(() => undefined);
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
    linkedHostnames: linkedHostnames(body, url),
    contentType: contentType || undefined,
    bodyInspected: !isPdf,
    checkedAt: new Date().toISOString(),
  };
}

const OPENREVIEW_API_HOSTS = ["api2.openreview.net", "api.openreview.net"];

export async function fetchOpenReviewForumNotes(params: {
  forumID: string;
  fetch?: DiscoveryFetch;
  signal?: AbortSignal;
  resolveHost?: HostResolver;
  now?: () => number;
  deadline?: number;
}): Promise<unknown[]> {
  // Forum ids come from untrusted evidence URLs; only a safe identifier may
  // reach the fixed official API hosts.
  if (!/^[A-Za-z0-9_.~-]{1,64}$/.test(params.forumID)) {
    throw new Error("OpenReview forum id is not a safe identifier.");
  }
  const resolver =
    params.resolveHost ||
    (params.fetch ? async () => ["93.184.216.34"] : defaultResolveHost);
  const now = params.now || Date.now;
  const deadline = params.deadline ?? now() + 15_000;
  const requestTimeout = () => Math.max(1, Math.min(15_000, deadline - now()));
  let lastError: unknown;
  let reachedEmptyList = false;
  for (const host of OPENREVIEW_API_HOSTS) {
    const url = `https://${host}/notes?forum=${encodeURIComponent(params.forumID)}`;
    try {
      if (params.signal?.aborted) {
        throw new Error("Official evidence request cancelled.");
      }
      if (now() >= deadline) throw new Error("Discovery request timed out.");
      await assertPublicResolution(
        host,
        resolver,
        params.signal,
        deadline,
        now,
      );
      const fetcher = params.fetch
        ? withDiscoveryFetchTimeout(
            params.fetch,
            requestTimeout(),
            params.signal,
          )
        : undefined;
      const response = fetcher
        ? ((await fetcher(url, {
            headers: { Accept: "application/json" },
            redirect: "manual",
          })) as ResponseWithConnection)
        : await secureZoteroRequest(url, params.signal, requestTimeout());
      if (
        response.remoteAddress &&
        (!isIPAddressLiteral(response.remoteAddress) ||
          isNonPublicIPAddress(response.remoteAddress))
      ) {
        void response.body?.cancel().catch(() => undefined);
        throw new Error(
          "OpenReview status connection used a non-public address.",
        );
      }
      if (!response.ok) {
        void response.body?.cancel().catch(() => undefined);
        throw new Error(
          `OpenReview status request failed (${response.status}).`,
        );
      }
      const body = await readResponseTextBounded(response, {
        maxBytes: MAX_OPENREVIEW_API_BODY_BYTES,
        signal: params.signal,
        deadline,
        now,
      });
      // API v2 wraps notes in an object; legacy API v1 responses may be a
      // bare note array. A forum lives in exactly one API generation, so an
      // empty list means "keep trying the older API", not "no notes exist".
      const parsed = JSON.parse(body) as unknown;
      const notes = Array.isArray(parsed)
        ? parsed
        : parsed &&
            typeof parsed === "object" &&
            Array.isArray((parsed as { notes?: unknown[] }).notes)
          ? (parsed as { notes: unknown[] }).notes
          : undefined;
      if (!notes) {
        throw new Error("OpenReview status response had no notes list.");
      }
      if (notes.length) return notes;
      reachedEmptyList = true;
    } catch (error) {
      if (params.signal?.aborted) throw error;
      lastError = error;
    }
  }
  if (lastError !== undefined) {
    // A host failure after another host reported no notes is a partial
    // outage, not proof that the forum is empty; fail closed instead of
    // silently dropping a possibly legacy forum.
    throw lastError instanceof Error
      ? lastError
      : new Error("OpenReview official status was unavailable.");
  }
  if (reachedEmptyList) return [];
  throw new Error("OpenReview official status was unavailable.");
}

export const OFFICIAL_SOURCE_FAMILIES = SOURCE_FAMILIES.map((entry) => ({
  ...entry,
  domains: [...entry.domains],
}));
