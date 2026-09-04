import {
  extractPdfTextPages,
  matchQuoteInPages,
} from "../autoHighlight/pdfMatch";
import type { PDFPageText } from "../autoHighlight/types";
import { normalizeEvidenceReference } from "./core/evidence/types";

export const EVIDENCE_VERIFIER_VERSION = "paperpilot-evidence-v2";

export type EvidenceVerificationStatus =
  | "verified"
  | "unverified"
  | "not-found"
  | "source-unavailable";

export type EvidenceVerificationMethod =
  | "pdf-exact-quote"
  | "structured-element"
  | "zotero-annotation"
  | "metadata-only"
  | "none";

export interface EvidenceReferenceV2 {
  schemaVersion: 2;
  sourceID: string;
  libraryID: number;
  attachmentKey: string;
  pageIndex?: number;
  pageLabel?: string;
  sectionPath?: string[];
  elementID?: string;
  elementType?: string;
  exactQuote?: string;
  boundingBoxes?: Array<{
    pageIndex: number;
    rect: [number, number, number, number];
  }>;
  confidence?: number;
  verification: {
    status: EvidenceVerificationStatus;
    method: EvidenceVerificationMethod;
    verifiedAt?: string;
    verifierVersion: string;
    detail?: string;
  };
}

export interface AdmittedEvidenceSource {
  sourceID: string;
  libraryID: number;
  attachmentKey: string;
  attachmentID: number;
  contentFingerprint?: { value?: string } | string;
  structuredChunks?: Array<{
    text?: string;
    pageIndex?: number;
    sectionPath?: string[];
    metadata?: { elementId?: string; elementType?: string };
  }>;
}

interface ResolvedAttachment {
  id?: number;
  libraryID?: number;
  key?: string;
  getFilePathAsync?: () => Promise<string | undefined>;
}

export interface EvidenceVerificationDependencies {
  resolveAttachment?: (
    source: AdmittedEvidenceSource,
  ) => Promise<ResolvedAttachment | undefined>;
  extractPages?: (filePath: string) => Promise<PDFPageText[]>;
  now?: () => string;
}

const DROP_EVIDENCE = Symbol("drop-evidence");

function readString(value: unknown, maxLength = 1_200) {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, maxLength) : undefined;
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isEvidenceCandidate(value: Record<string, any>) {
  return (
    typeof value.attachmentKey === "string" &&
    (value.pageIndex !== undefined ||
      value.sectionPath ||
      value.quote ||
      value.exactQuote ||
      value.elementId ||
      value.elementID ||
      value.boundingBox ||
      value.boundingBoxes ||
      value.verification)
  );
}

async function resolveAttachmentFromZotero(source: AdmittedEvidenceSource) {
  const items = (globalThis as typeof globalThis & { Zotero?: any }).Zotero
    ?.Items;
  const byLibraryKey = items?.getByLibraryAndKey?.(
    source.libraryID,
    source.attachmentKey,
  );
  const attachment =
    (await Promise.resolve(byLibraryKey)) ??
    (await Promise.resolve(items?.getAsync?.(source.attachmentID))) ??
    items?.get?.(source.attachmentID);
  if (
    !attachment ||
    Number(attachment.libraryID) !== source.libraryID ||
    String(attachment.key || "") !== source.attachmentKey
  ) {
    return undefined;
  }
  return attachment as ResolvedAttachment;
}

function findSource(
  candidate: Record<string, any>,
  sources: AdmittedEvidenceSource[],
) {
  const attachmentKey = readString(candidate.attachmentKey, 256);
  if (!attachmentKey) return undefined;
  let matches = sources.filter(
    (source) => source.attachmentKey === attachmentKey,
  );
  const claimedSourceID = readString(candidate.sourceID, 512);
  if (claimedSourceID) {
    matches = matches.filter((source) => source.sourceID === claimedSourceID);
  }
  const claimedLibraryID = Number(candidate.libraryID);
  if (Number.isInteger(claimedLibraryID) && claimedLibraryID > 0) {
    matches = matches.filter((source) => source.libraryID === claimedLibraryID);
  }
  return matches.length === 1 ? matches[0] : undefined;
}

function baseReference(
  normalized: Record<string, any>,
  candidate: Record<string, any>,
  source: AdmittedEvidenceSource,
): Omit<EvidenceReferenceV2, "verification"> {
  const exactQuote =
    readString(candidate.exactQuote) ?? readString(normalized.quote);
  const elementID =
    readString(candidate.elementID, 128) ??
    readString(normalized.elementId, 128);
  return {
    schemaVersion: 2,
    sourceID: source.sourceID,
    libraryID: source.libraryID,
    attachmentKey: source.attachmentKey,
    ...(normalized.pageIndex !== undefined
      ? { pageIndex: normalized.pageIndex }
      : {}),
    ...(normalized.pageLabel ? { pageLabel: normalized.pageLabel } : {}),
    ...(normalized.sectionPath ? { sectionPath: normalized.sectionPath } : {}),
    ...(elementID ? { elementID } : {}),
    ...(normalized.elementType ? { elementType: normalized.elementType } : {}),
    ...(exactQuote ? { exactQuote } : {}),
    ...(normalized.confidence !== undefined
      ? { confidence: normalized.confidence }
      : {}),
  };
}

function verification(
  status: EvidenceVerificationStatus,
  method: EvidenceVerificationMethod,
  now: () => string,
  detail?: string,
) {
  return {
    status,
    method,
    ...(status === "verified" ? { verifiedAt: now() } : {}),
    verifierVersion: EVIDENCE_VERIFIER_VERSION,
    ...(detail ? { detail } : {}),
  };
}

export class ResearchWorkspaceEvidenceVerifier {
  private readonly pageCache = new Map<string, Promise<PDFPageText[]>>();

  constructor(
    private readonly sources: AdmittedEvidenceSource[],
    private readonly dependencies: EvidenceVerificationDependencies = {},
  ) {}

  private async loadPages(source: AdmittedEvidenceSource) {
    const fingerprint =
      typeof source.contentFingerprint === "string"
        ? source.contentFingerprint
        : source.contentFingerprint?.value || "unknown";
    const cacheKey = `${source.sourceID}:${fingerprint}`;
    const cached = this.pageCache.get(cacheKey);
    if (cached) return cached;
    const pending = (async () => {
      const resolver =
        this.dependencies.resolveAttachment ?? resolveAttachmentFromZotero;
      const attachment = await resolver(source);
      if (
        !attachment ||
        Number(attachment.libraryID) !== source.libraryID ||
        String(attachment.key || "") !== source.attachmentKey
      ) {
        throw new Error("The exact Zotero source is unavailable.");
      }
      const filePath = await attachment.getFilePathAsync?.();
      if (!filePath) throw new Error("The local PDF file is unavailable.");
      return (this.dependencies.extractPages ?? extractPdfTextPages)(filePath);
    })();
    this.pageCache.set(cacheKey, pending);
    return pending;
  }

  async verify(candidate: unknown): Promise<EvidenceReferenceV2 | null> {
    if (!isRecord(candidate) || !isEvidenceCandidate(candidate)) return null;
    const source = findSource(candidate, this.sources);
    if (!source) return null;
    const normalized = normalizeEvidenceReference(candidate, {
      allowedAttachmentKeys: new Set([source.attachmentKey]),
    }) as Record<string, any> | null;
    if (!normalized) return null;
    const base = baseReference(normalized, candidate, source);
    const now = this.dependencies.now ?? (() => new Date().toISOString());

    if (!base.exactQuote) {
      const chunk = base.elementID
        ? source.structuredChunks?.find(
            (entry) => entry.metadata?.elementId === base.elementID,
          )
        : undefined;
      if (chunk) {
        return {
          ...base,
          ...(chunk.pageIndex !== undefined
            ? { pageIndex: chunk.pageIndex }
            : {}),
          ...(chunk.sectionPath?.length
            ? { sectionPath: [...chunk.sectionPath] }
            : {}),
          ...(chunk.metadata?.elementType
            ? { elementType: chunk.metadata.elementType }
            : {}),
          verification: verification(
            "unverified",
            "structured-element",
            now,
            "The structured element exists locally, but no matching quote was supplied.",
          ),
        };
      }
      return {
        ...base,
        verification: verification(
          "unverified",
          "metadata-only",
          now,
          "No exact quote or trusted structured element was supplied.",
        ),
      };
    }

    let pages: PDFPageText[];
    try {
      pages = await this.loadPages(source);
    } catch {
      return {
        ...base,
        verification: verification(
          "source-unavailable",
          "pdf-exact-quote",
          now,
          "The exact local PDF source could not be loaded.",
        ),
      };
    }
    if (
      base.pageIndex !== undefined &&
      (base.pageIndex < 0 || base.pageIndex >= pages.length)
    ) {
      return {
        ...base,
        verification: verification(
          "not-found",
          "pdf-exact-quote",
          now,
          "The claimed page is outside the local PDF page range.",
        ),
      };
    }
    const match = matchQuoteInPages(base.exactQuote, pages);
    if (
      !match ||
      (base.pageIndex !== undefined && match.pageIndex !== base.pageIndex)
    ) {
      return {
        ...base,
        verification: verification(
          "not-found",
          "pdf-exact-quote",
          now,
          "The exact quote was not found at the claimed local PDF location.",
        ),
      };
    }
    return {
      ...base,
      pageIndex: match.pageIndex,
      pageLabel: match.pageLabel,
      exactQuote: match.quote,
      boundingBoxes: match.rects.map((rect) => ({
        pageIndex: match.pageIndex,
        rect: rect.slice(0, 4) as [number, number, number, number],
      })),
      verification: verification("verified", "pdf-exact-quote", now),
    };
  }

  async verifyTree(value: unknown): Promise<unknown> {
    const walk = async (
      entry: unknown,
    ): Promise<unknown | typeof DROP_EVIDENCE> => {
      if (Array.isArray(entry)) {
        const values = await Promise.all(entry.map((item) => walk(item)));
        return values.filter((item) => item !== DROP_EVIDENCE);
      }
      if (!isRecord(entry)) return entry;
      if (isEvidenceCandidate(entry)) {
        return (await this.verify(entry)) ?? DROP_EVIDENCE;
      }
      const result: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(entry)) {
        const verified = await walk(item);
        if (verified !== DROP_EVIDENCE) result[key] = verified;
      }
      return result;
    };
    const result = await walk(value);
    return result === DROP_EVIDENCE ? null : result;
  }
}

export async function verifyResearchWorkspaceEvidence(
  value: unknown,
  sources: AdmittedEvidenceSource[],
  dependencies: EvidenceVerificationDependencies = {},
) {
  return new ResearchWorkspaceEvidenceVerifier(
    sources,
    dependencies,
  ).verifyTree(value);
}
