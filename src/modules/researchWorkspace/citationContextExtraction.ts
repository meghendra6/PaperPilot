import type {
  ResearchWorkspacePaper,
  ResearchWorkspaceStructuredChunk,
} from "./paperSource";

export const CITATION_CONTEXT_EXTRACTOR_VERSION =
  "paperpilot-citation-context-v1" as const;

export interface CitationLibraryCandidate {
  id: number;
  libraryID?: number;
  itemKey?: string;
  title?: string;
  year?: number;
  doi?: string;
  authors?: string[];
}

export interface ExtractedCitationReference {
  key: string;
  raw: string;
  numericIndex?: number;
  firstAuthor?: string;
  authors: string[];
  year?: number;
  title?: string;
  doi?: string;
}

export interface CitationIdentityResolution {
  status: "resolved" | "ambiguous" | "unresolved";
  method:
    | "project-doi"
    | "project-title"
    | "project-author-year"
    | "zotero-doi"
    | "zotero-title"
    | "zotero-author-year"
    | "none";
  confidence: number;
  sourceID?: string;
  zoteroItemID?: number;
  zoteroLibraryID?: number;
  zoteroItemKey?: string;
  title?: string;
  doi?: string;
  candidateItemIDs?: number[];
}

export interface ExtractedCitationContext {
  schemaVersion: 1;
  id: string;
  citingPaperKey: string;
  citingSourceID: string;
  citedPaperKey: string;
  context: string;
  exactSentence: string;
  marker: string;
  markerOffset: number;
  pageIndex?: number;
  sectionPath?: string[];
  reference: ExtractedCitationReference;
  resolution: CitationIdentityResolution;
  extraction: {
    extractorVersion: typeof CITATION_CONTEXT_EXTRACTOR_VERSION;
    sourceKind: "structured-pdf" | "text-fallback";
    chunkID: string;
    sentenceOffset: number;
  };
  evidence: Array<Record<string, unknown>>;
}

export interface CitationContextCoverage {
  sourcesAnalyzed: number;
  structuredSources: number;
  fallbackSources: number;
  sourceCharacters: number;
  markersFound: number;
  contextsExtracted: number;
  resolved: number;
  ambiguous: number;
  unresolved: number;
  pageLocated: number;
  skippedMarkers: number;
  limitations: string[];
}

export interface CitationContextExtractionResult {
  schemaVersion: 1;
  extractionID: string;
  revision: 0;
  extractorVersion: typeof CITATION_CONTEXT_EXTRACTOR_VERSION;
  sourceSnapshot: Array<{
    sourceID: string;
    contentFingerprint: string;
  }>;
  contexts: ExtractedCitationContext[];
  coverage: CitationContextCoverage;
}

interface CitationMarker {
  raw: string;
  key: string;
  offset: number;
  numericIndex?: number;
  firstAuthor?: string;
  year?: number;
}

interface SentenceSlice {
  text: string;
  start: number;
}

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeDOI(value: string) {
  return value
    .trim()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
    .replace(/[\s.,;]+$/g, "")
    .toLowerCase();
}

function normalizeTitle(value: string) {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function normalizeAuthor(value: string) {
  return normalizeTitle(value).split(" ").filter(Boolean).at(-1) ?? "";
}

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function sentences(value: string): SentenceSlice[] {
  const protectedValue = value
    .replace(/\b(?:et\s+al|e\.g|i\.e|fig|eq|dr|mr|mrs|prof)\./gi, (match) =>
      match.replace(/\./g, "\uE000"),
    )
    .replace(/(?<=\d)\.(?=\d)/g, "\uE000");
  const result: SentenceSlice[] = [];
  const expression = /[^.!?\n]+(?:[.!?]+(?=\s|$)|$)/g;
  for (const match of protectedValue.matchAll(expression)) {
    const text = normalizeWhitespace(match[0].replace(/\uE000/g, "."));
    if (text) result.push({ text, start: match.index ?? 0 });
  }
  return result;
}

function numericIndexes(value: string) {
  if (/(?:^|[,;\s])0(?:$|[,;\s])/.test(value)) return [];
  const indexes: number[] = [];
  for (const part of value.split(/[,;]/)) {
    const range = part.trim().match(/^(\d+)\s*[-–]\s*(\d+)$/);
    if (range) {
      const start = Number(range[1]);
      const end = Number(range[2]);
      if (start > 0 && end >= start && end - start <= 30) {
        for (let current = start; current <= end; current += 1) {
          indexes.push(current);
        }
      }
      continue;
    }
    const number = Number(part.trim());
    if (Number.isInteger(number) && number > 0) indexes.push(number);
  }
  return [...new Set(indexes)];
}

function citationMarkers(sentence: string): CitationMarker[] {
  const markers: CitationMarker[] = [];
  for (const match of sentence.matchAll(
    /\[((?:\d+\s*(?:[-–]\s*\d+)?\s*[,;]?\s*)+)\]/g,
  )) {
    for (const numericIndex of numericIndexes(match[1])) {
      markers.push({
        raw: match[0],
        key: String(numericIndex),
        offset: match.index ?? 0,
        numericIndex,
      });
    }
  }
  for (const match of sentence.matchAll(/\(([^()]{0,220})\)/g)) {
    const parts = match[1].split(";");
    let localOffset = 1;
    for (const part of parts) {
      const authorYear = part.match(
        /(?:^|\s)([\p{L}][\p{L}'’-]+)(?:\s+et\s+al\.)?[^\d]{0,50}((?:19|20)\d{2})[a-z]?/iu,
      );
      if (authorYear) {
        const firstAuthor = normalizeAuthor(authorYear[1]);
        const year = Number(authorYear[2]);
        markers.push({
          raw: part.trim(),
          key: `${firstAuthor}:${year}`,
          offset: (match.index ?? 0) + localOffset,
          firstAuthor,
          year,
        });
      }
      localOffset += part.length + 1;
    }
  }
  for (const match of sentence.matchAll(
    /\b([\p{Lu}][\p{L}'’-]+)(?:\s+et\s+al\.)?\s*\(((?:19|20)\d{2})[a-z]?\)/gu,
  )) {
    const firstAuthor = normalizeAuthor(match[1]);
    const year = Number(match[2]);
    markers.push({
      raw: match[0],
      key: `${firstAuthor}:${year}`,
      offset: match.index ?? 0,
      firstAuthor,
      year,
    });
  }
  const seen = new Set<string>();
  return markers.filter((marker) => {
    const identity = `${marker.offset}:${marker.key}`;
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

function referenceSection(value: string) {
  const match =
    /(?:^|\n)\s*(references|bibliography|works cited)\s*(?:\n|$)/i.exec(value);
  if (!match) return { body: value, references: "" };
  return {
    body: value.slice(0, match.index),
    references: value.slice(match.index + match[0].length),
  };
}

function referenceLines(value: string) {
  const rawLines = value.split(/\n+/).map(normalizeWhitespace).filter(Boolean);
  const entries: Array<{ key?: string; raw: string }> = [];
  for (const line of rawLines) {
    const numbered = line.match(/^\s*(?:\[(\d+)\]|(\d+)[.)])\s*(.+)$/);
    if (numbered) {
      entries.push({ key: numbered[1] ?? numbered[2], raw: numbered[3] });
    } else if (entries.length && !/^(?:appendix|acknowledg)/i.test(line)) {
      entries[entries.length - 1].raw += ` ${line}`;
    } else {
      entries.push({ raw: line });
    }
  }
  return entries;
}

function parseReference(rawValue: string, key?: string) {
  const raw = normalizeWhitespace(rawValue);
  const doiMatch = raw.match(/\b10\.\d{4,9}\/[\w.()/:;+-]+/i);
  const yearMatch = raw.match(/\b((?:19|20)\d{2})[a-z]?\b/i);
  const year = yearMatch ? Number(yearMatch[1]) : undefined;
  const beforeYear = yearMatch ? raw.slice(0, yearMatch.index).trim() : "";
  const authors = beforeYear
    .replace(/[().]+$/g, "")
    .split(/\s*(?:,|;|\band\b|&)\s*/i)
    .map(normalizeWhitespace)
    .filter(Boolean)
    .slice(0, 12);
  let title: string | undefined;
  if (yearMatch) {
    const afterYear = raw
      .slice((yearMatch.index ?? 0) + yearMatch[0].length)
      .replace(/^[).,:;\s]+/, "");
    const candidate = afterYear.split(/\.\s+/)[0]?.trim();
    if (candidate && candidate.length >= 8) title = candidate;
  }
  if (!title) {
    const segments = raw.split(/\.\s+/).map((entry) => entry.trim());
    const candidate = segments.find(
      (entry, index) =>
        index > 0 && entry.length >= 8 && !/^doi\b/i.test(entry),
    );
    if (candidate) title = candidate;
  }
  const firstAuthor = authors.length
    ? normalizeAuthor(authors[0].replace(/\bet\s+al\.?$/i, ""))
    : undefined;
  return {
    key: key ?? `${firstAuthor || "unknown"}:${year || "unknown"}`,
    raw,
    ...(key && /^\d+$/.test(key) ? { numericIndex: Number(key) } : {}),
    ...(firstAuthor ? { firstAuthor } : {}),
    authors,
    ...(year ? { year } : {}),
    ...(title ? { title } : {}),
    ...(doiMatch ? { doi: normalizeDOI(doiMatch[0]) } : {}),
  } satisfies ExtractedCitationReference;
}

function buildReferenceIndex(paper: ResearchWorkspacePaper) {
  const entries: Array<{ key?: string; raw: string }> = [];
  if (paper.structuredChunks?.length) {
    for (const chunk of paper.structuredChunks) {
      const path = chunk.sectionPath?.join(" / ") ?? chunk.title ?? "";
      if (/\b(references|bibliography|works cited)\b/i.test(path)) {
        entries.push(...referenceLines(chunk.text));
      }
    }
  }
  if (!entries.length) {
    entries.push(...referenceLines(referenceSection(paper.context).references));
  }
  const byKey = new Map<string, ExtractedCitationReference>();
  for (const [index, entry] of entries.entries()) {
    const parsed = parseReference(entry.raw, entry.key);
    byKey.set(entry.key ?? String(index + 1), parsed);
    if (parsed.firstAuthor && parsed.year) {
      byKey.set(`${parsed.firstAuthor}:${parsed.year}`, parsed);
    }
  }
  return byKey;
}

type ResolutionCandidate = {
  kind: "project" | "zotero";
  sourceID?: string;
  itemID?: number;
  libraryID?: number;
  itemKey?: string;
  title?: string;
  year?: number;
  doi?: string;
  authors: string[];
};

function resolveReference(
  reference: ExtractedCitationReference,
  papers: readonly ResearchWorkspacePaper[],
  libraryCandidates: readonly CitationLibraryCandidate[],
): CitationIdentityResolution {
  const candidates: ResolutionCandidate[] = [
    ...papers.map((paper) => ({
      kind: "project" as const,
      sourceID: paper.sourceID,
      itemID: paper.itemID,
      libraryID: paper.libraryID,
      itemKey: paper.itemKey,
      title: paper.title,
      year: paper.year,
      doi: paper.doi,
      authors: paper.creators ?? [],
    })),
    ...libraryCandidates.map((candidate) => ({
      kind: "zotero" as const,
      itemID: candidate.id,
      libraryID: candidate.libraryID,
      itemKey: candidate.itemKey,
      title: candidate.title,
      year: candidate.year,
      doi: candidate.doi,
      authors: candidate.authors ?? [],
    })),
  ];
  const select = (
    matches: ResolutionCandidate[],
    projectMethod: CitationIdentityResolution["method"],
    zoteroMethod: CitationIdentityResolution["method"],
    confidence: number,
  ): CitationIdentityResolution | undefined => {
    const identities = new Map<string, ResolutionCandidate>();
    for (const entry of matches) {
      const identity = Number.isInteger(entry.itemID)
        ? `item:${entry.libraryID ?? "unknown"}:${entry.itemID}`
        : (entry.sourceID ?? "unknown");
      if (!identities.has(identity)) identities.set(identity, entry);
    }
    const unique = [...identities.values()];
    if (!unique.length) return undefined;
    if (unique.length > 1) {
      return {
        status: "ambiguous",
        method: "none",
        confidence: 0,
        candidateItemIDs: unique
          .map((entry) => entry.itemID)
          .filter((value): value is number => Number.isInteger(value)),
      };
    }
    const match = unique[0];
    return {
      status: "resolved",
      method: match.kind === "project" ? projectMethod : zoteroMethod,
      confidence,
      ...(match.sourceID ? { sourceID: match.sourceID } : {}),
      ...(Number.isInteger(match.itemID) ? { zoteroItemID: match.itemID } : {}),
      ...(Number.isInteger(match.libraryID)
        ? { zoteroLibraryID: match.libraryID }
        : {}),
      ...(match.itemKey ? { zoteroItemKey: match.itemKey } : {}),
      ...(match.title ? { title: match.title } : {}),
      ...(match.doi ? { doi: normalizeDOI(match.doi) } : {}),
    };
  };
  if (reference.doi) {
    const doi = normalizeDOI(reference.doi);
    const resolved = select(
      candidates.filter(
        (entry) => entry.doi && normalizeDOI(entry.doi) === doi,
      ),
      "project-doi",
      "zotero-doi",
      1,
    );
    if (resolved) return resolved;
  }
  if (reference.title) {
    const title = normalizeTitle(reference.title);
    const resolved = select(
      candidates.filter((entry) => {
        const candidate = normalizeTitle(entry.title ?? "");
        const referenceTokens = new Set(title.split(" ").filter(Boolean));
        const candidateTokens = new Set(candidate.split(" ").filter(Boolean));
        const shared = [...referenceTokens].filter((token) =>
          candidateTokens.has(token),
        ).length;
        const overlap =
          shared /
          Math.max(1, Math.max(referenceTokens.size, candidateTokens.size));
        return (
          candidate.length >= 8 &&
          (candidate === title ||
            (Boolean(reference.year) &&
              entry.year === reference.year &&
              overlap >= 0.8))
        );
      }),
      "project-title",
      "zotero-title",
      0.9,
    );
    if (resolved) return resolved;
  }
  if (reference.firstAuthor && reference.year) {
    const resolved = select(
      candidates.filter(
        (entry) =>
          entry.year === reference.year &&
          entry.authors.some(
            (author) => normalizeAuthor(author) === reference.firstAuthor,
          ),
      ),
      "project-author-year",
      "zotero-author-year",
      0.75,
    );
    if (resolved) return resolved;
  }
  return { status: "unresolved", method: "none", confidence: 0 };
}

function analyzableChunks(paper: ResearchWorkspacePaper) {
  if (paper.structuredChunks?.length) {
    return paper.structuredChunks.filter((chunk) => {
      const path = chunk.sectionPath?.join(" / ") ?? chunk.title ?? "";
      return !/\b(references|bibliography|works cited)\b/i.test(path);
    });
  }
  const body = referenceSection(paper.context).body;
  return [
    {
      id: `${paper.paperKey}:full-text`,
      text: body,
      attachmentKey: paper.attachmentKey,
      metadata: { paperKey: paper.paperKey },
    } satisfies ResearchWorkspaceStructuredChunk,
  ];
}

export function extractResearchWorkspaceCitationContexts(params: {
  papers: readonly ResearchWorkspacePaper[];
  libraryCandidates?: readonly CitationLibraryCandidate[];
  maxContexts?: number;
}): CitationContextExtractionResult {
  const maxContexts = Math.max(1, Math.min(2_000, params.maxContexts ?? 500));
  const contexts: ExtractedCitationContext[] = [];
  let markersFound = 0;
  let skippedMarkers = 0;
  let sourceCharacters = 0;
  const orderedPapers = [...params.papers].sort((left, right) =>
    left.sourceID.localeCompare(right.sourceID),
  );
  for (const paper of orderedPapers) {
    const references = buildReferenceIndex(paper);
    const chunks = analyzableChunks(paper);
    for (const chunk of chunks) {
      sourceCharacters += chunk.text.length;
      const slices = sentences(chunk.text);
      for (const [sentenceIndex, sentence] of slices.entries()) {
        const markers = citationMarkers(sentence.text);
        markersFound += markers.length;
        for (const marker of markers) {
          if (contexts.length >= maxContexts) {
            skippedMarkers += 1;
            continue;
          }
          const parsedReference =
            references.get(marker.key) ??
            parseReference(
              marker.raw,
              marker.numericIndex ? String(marker.numericIndex) : marker.key,
            );
          const reference = {
            ...parsedReference,
            authors: [...parsedReference.authors],
            ...(!parsedReference.firstAuthor && marker.firstAuthor
              ? {
                  firstAuthor: marker.firstAuthor,
                  authors: [marker.firstAuthor],
                }
              : {}),
            ...(!parsedReference.year && marker.year
              ? { year: marker.year }
              : {}),
          };
          const resolution = resolveReference(
            reference,
            params.papers,
            params.libraryCandidates ?? [],
          );
          const previous = slices[sentenceIndex - 1]?.text;
          const following = slices[sentenceIndex + 1]?.text;
          const context = [previous, sentence.text, following]
            .filter(Boolean)
            .join(" ");
          const markerOffset = sentence.start + marker.offset;
          const id = `citation-context-${stableHash(
            [
              CITATION_CONTEXT_EXTRACTOR_VERSION,
              paper.sourceID,
              paper.contentFingerprint.value,
              chunk.id,
              markerOffset,
              marker.key,
            ].join("|"),
          )}`;
          contexts.push({
            schemaVersion: 1,
            id,
            citingPaperKey: paper.paperKey,
            citingSourceID: paper.sourceID,
            citedPaperKey:
              resolution.sourceID ??
              `reference:${paper.sourceID}:${stableHash(reference.key)}`,
            context,
            exactSentence: sentence.text,
            marker: marker.raw,
            markerOffset,
            ...(chunk.pageIndex !== undefined
              ? { pageIndex: chunk.pageIndex }
              : {}),
            ...(chunk.sectionPath?.length
              ? { sectionPath: [...chunk.sectionPath] }
              : {}),
            reference,
            resolution,
            extraction: {
              extractorVersion: CITATION_CONTEXT_EXTRACTOR_VERSION,
              sourceKind: paper.structuredChunks?.length
                ? "structured-pdf"
                : "text-fallback",
              chunkID: chunk.id,
              sentenceOffset: sentence.start,
            },
            evidence: [
              {
                sourceID: paper.sourceID,
                libraryID: paper.libraryID,
                attachmentKey: paper.attachmentKey,
                exactQuote: sentence.text,
                quote: sentence.text,
                ...(chunk.pageIndex !== undefined
                  ? { pageIndex: chunk.pageIndex }
                  : {}),
                ...(chunk.sectionPath?.length
                  ? { sectionPath: [...chunk.sectionPath] }
                  : {}),
                ...(chunk.metadata.elementId
                  ? { elementId: chunk.metadata.elementId }
                  : {}),
              },
            ],
          });
        }
      }
    }
  }
  const resolved = contexts.filter(
    (context) => context.resolution.status === "resolved",
  ).length;
  const ambiguous = contexts.filter(
    (context) => context.resolution.status === "ambiguous",
  ).length;
  const limitations = new Set<string>();
  if (params.papers.some((paper) => !paper.structuredChunks?.length)) {
    limitations.add(
      "Some sources used text fallback; exact local page numbers are unavailable.",
    );
  }
  if (contexts.some((context) => context.resolution.status !== "resolved")) {
    limitations.add(
      "Some cited works could not be resolved uniquely against the project or local Zotero library.",
    );
  }
  if (skippedMarkers) {
    limitations.add(`The ${maxContexts}-context safety limit was reached.`);
  }
  if (!contexts.length) {
    limitations.add(
      "No supported numeric or author-year citation markers were found in readable local text.",
    );
  }
  const sourceSnapshot = orderedPapers.map((paper) => ({
    sourceID: paper.sourceID,
    contentFingerprint: paper.contentFingerprint.value,
  }));
  return {
    schemaVersion: 1,
    extractionID: `citation-extraction-${stableHash(
      `${CITATION_CONTEXT_EXTRACTOR_VERSION}|${JSON.stringify(sourceSnapshot)}`,
    )}`,
    revision: 0,
    extractorVersion: CITATION_CONTEXT_EXTRACTOR_VERSION,
    sourceSnapshot,
    contexts,
    coverage: {
      sourcesAnalyzed: params.papers.length,
      structuredSources: params.papers.filter(
        (paper) => paper.structuredChunks?.length,
      ).length,
      fallbackSources: params.papers.filter(
        (paper) => !paper.structuredChunks?.length,
      ).length,
      sourceCharacters,
      markersFound,
      contextsExtracted: contexts.length,
      resolved,
      ambiguous,
      unresolved: contexts.length - resolved - ambiguous,
      pageLocated: contexts.filter((context) => context.pageIndex !== undefined)
        .length,
      skippedMarkers,
      limitations: [...limitations],
    },
  };
}
