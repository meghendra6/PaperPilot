import { normalizeHttpURL } from "../normalize";
import type { PublicationEvidenceType } from "../types";
import { type DiscoveryFetch, withDiscoveryFetchTimeout } from "./types";

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
  const ipv4 = hostname.split(".").map(Number);
  const isPrivateIPv4 =
    ipv4.length === 4 &&
    ipv4.every((part) => Number.isInteger(part) && part >= 0 && part <= 255) &&
    (ipv4[0] === 0 ||
      ipv4[0] === 10 ||
      ipv4[0] === 127 ||
      (ipv4[0] === 169 && ipv4[1] === 254) ||
      (ipv4[0] === 172 && ipv4[1] >= 16 && ipv4[1] <= 31) ||
      (ipv4[0] === 192 && ipv4[1] === 168));
  const isPrivateIPv6 =
    hostname === "::1" ||
    hostname.startsWith("fc") ||
    hostname.startsWith("fd") ||
    /^fe[89ab]/.test(hostname);
  return (
    parsed.protocol === "https:" &&
    !NON_OFFICIAL_DOMAINS.some(
      (domain) => hostname === domain || hostname.endsWith(`.${domain}`),
    ) &&
    hostname !== "localhost" &&
    !hostname.endsWith(".localhost") &&
    !hostname.endsWith(".local") &&
    !isPrivateIPv4 &&
    !isPrivateIPv6
  );
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

async function readResponseTextBounded(response: Response, maxBytes = 200_000) {
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
}) {
  if (!isPlausibleOfficialEvidenceURL(params.url)) {
    throw new Error("Official evidence URL is not a public HTTPS source.");
  }
  const url = normalizeHttpURL(params.url)!;
  const response = await withDiscoveryFetchTimeout(
    params.fetch,
    15_000,
    params.signal,
  )(url, { headers: { Accept: "text/html,application/json" } });
  if (!response.ok) {
    throw new Error(`Official evidence request failed (${response.status}).`);
  }
  const finalURL = response.url || url;
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
