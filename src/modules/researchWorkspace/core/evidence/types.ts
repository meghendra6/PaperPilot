const EVIDENCE_REFERENCE_SCHEMA_VERSION = 1;
const MAX_LABEL_LENGTH = 64;
const MAX_PATH_SEGMENTS = 12;
const MAX_PATH_SEGMENT_LENGTH = 160;
const MAX_ELEMENT_ID_LENGTH = 128;
const MAX_QUOTE_LENGTH = 1200;
const MAX_HASH_LENGTH = 256;
export interface EvidenceNormalizationOptions {
  allowedAttachmentKeys?: Set<string>;
  pageCountByAttachmentKey?: Map<string, number>;
}

interface EvidenceBoundingBox {
  pageIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface EvidenceReference {
  schemaVersion?: number;
  sourceID?: string;
  libraryID?: number;
  attachmentKey?: string;
  pageIndex?: number;
  pageLabel?: string;
  sectionPath?: string[];
  elementType?: string;
  elementId?: string;
  elementID?: string;
  quote?: string;
  exactQuote?: string;
  quoteHash?: string;
  boundingBox?: EvidenceBoundingBox;
  boundingBoxes?: unknown;
  extractionMethod?: string;
  confidence?: number;
  verification?: { status?: string };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function readString(
  value: unknown,
  maxLength = Number.POSITIVE_INFINITY,
): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (normalized.length === 0) return undefined;
  return normalized.slice(0, maxLength);
}
function readFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}
function readPageIndex(value: unknown): number | undefined {
  const number = readFiniteNumber(value);
  if (number === undefined || !Number.isInteger(number) || number < 0)
    return undefined;
  return number;
}
function readLibraryID(value: unknown): number | undefined {
  const number = readFiniteNumber(value);
  return number !== undefined && Number.isInteger(number) && number > 0
    ? number
    : undefined;
}
function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}
function normalizeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const result = value
    .slice(0, MAX_PATH_SEGMENTS)
    .map((entry) => readString(entry, MAX_PATH_SEGMENT_LENGTH))
    .filter((entry) => entry !== undefined);
  return result.length > 0 ? result : undefined;
}
const ELEMENT_TYPES = new Set([
  "paragraph",
  "figure",
  "table",
  "equation",
  "footnote",
  "appendix",
  "other",
]);
const EXTRACTION_METHODS = new Set([
  "structured",
  "zotero_text",
  "ocr",
  "annotation",
  "external",
]);
function normalizeBoundingBox(
  value: unknown,
  fallbackPageIndex?: number,
): EvidenceBoundingBox | undefined {
  if (!isRecord(value)) return undefined;
  if (
    value.pageIndex !== undefined &&
    readPageIndex(value.pageIndex) === undefined
  )
    return undefined;
  const pageIndex = readPageIndex(value.pageIndex) ?? fallbackPageIndex;
  const rawX = readFiniteNumber(value.x);
  const rawY = readFiniteNumber(value.y);
  const rawWidth = readFiniteNumber(value.width);
  const rawHeight = readFiniteNumber(value.height);
  if (
    pageIndex === undefined ||
    rawX === undefined ||
    rawY === undefined ||
    rawWidth === undefined ||
    rawHeight === undefined ||
    rawWidth <= 0 ||
    rawHeight <= 0
  ) {
    return undefined;
  }
  const x = clamp01(rawX);
  const y = clamp01(rawY);
  const width = Math.min(clamp01(rawWidth), 1 - x);
  const height = Math.min(clamp01(rawHeight), 1 - y);
  if (width <= 0 || height <= 0) return undefined;
  return { pageIndex, x, y, width, height };
}
function pageIsAllowed(
  attachmentKey: string,
  pageIndex: number | undefined,
  options: EvidenceNormalizationOptions,
) {
  if (pageIndex === undefined) return true;
  const pageCount = options.pageCountByAttachmentKey?.get(attachmentKey);
  return pageCount === undefined || pageIndex < pageCount;
}
/**
 * Normalizes untrusted model or persisted data into a stable evidence reference.
 * Invalid optional fields are discarded. A missing or disallowed attachment key
 * invalidates the whole object.
 */
function normalizeEvidenceReference(
  value: unknown,
  options: EvidenceNormalizationOptions = {},
): EvidenceReference | null {
  if (!isRecord(value)) return null;
  const attachmentKey = readString(value.attachmentKey, 256);
  if (
    !attachmentKey ||
    /[\\/\0]/.test(attachmentKey) ||
    attachmentKey === "." ||
    attachmentKey === ".."
  ) {
    return null;
  }
  if (
    options.allowedAttachmentKeys &&
    !options.allowedAttachmentKeys.has(attachmentKey)
  ) {
    return null;
  }
  const rawElementType = readString(value.elementType);
  const rawExtractionMethod = readString(value.extractionMethod);
  const confidence = readFiniteNumber(value.confidence);
  const explicitPageIndex = readPageIndex(value.pageIndex);
  if (value.pageIndex !== undefined && explicitPageIndex === undefined)
    return null;
  const rawBoundingBox = normalizeBoundingBox(
    value.boundingBox,
    explicitPageIndex,
  );
  const pageIndex = explicitPageIndex ?? rawBoundingBox?.pageIndex;
  if (!pageIsAllowed(attachmentKey, pageIndex, options)) return null;
  // A box for a different page is unsafe to navigate to, so preserve the page
  // locator but discard the inconsistent box.
  const boundingBox =
    rawBoundingBox &&
    (explicitPageIndex === undefined ||
      rawBoundingBox.pageIndex === explicitPageIndex)
      ? rawBoundingBox
      : undefined;
  const pageLabel = readString(value.pageLabel, MAX_LABEL_LENGTH);
  const sectionPath = normalizeStringArray(value.sectionPath);
  const elementId = readString(value.elementId, MAX_ELEMENT_ID_LENGTH);
  const sourceID = readString(value.sourceID, 512);
  const libraryID = readLibraryID(value.libraryID);
  const quote = readString(value.quote ?? value.exactQuote, MAX_QUOTE_LENGTH);
  const quoteHash = readString(value.quoteHash, MAX_HASH_LENGTH);
  return {
    schemaVersion: EVIDENCE_REFERENCE_SCHEMA_VERSION,
    ...(sourceID ? { sourceID } : {}),
    ...(libraryID !== undefined ? { libraryID } : {}),
    attachmentKey,
    ...(pageIndex !== undefined ? { pageIndex } : {}),
    ...(pageLabel ? { pageLabel } : {}),
    ...(sectionPath ? { sectionPath } : {}),
    ...(rawElementType && ELEMENT_TYPES.has(rawElementType)
      ? { elementType: rawElementType }
      : {}),
    ...(elementId ? { elementId } : {}),
    ...(quote ? { quote } : {}),
    ...(quoteHash ? { quoteHash } : {}),
    ...(boundingBox ? { boundingBox } : {}),
    ...(rawExtractionMethod && EXTRACTION_METHODS.has(rawExtractionMethod)
      ? { extractionMethod: rawExtractionMethod }
      : {}),
    ...(confidence !== undefined ? { confidence: clamp01(confidence) } : {}),
  };
}
function normalizeEvidenceReferences(
  value: unknown,
  options: EvidenceNormalizationOptions = {},
): EvidenceReference[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: EvidenceReference[] = [];
  for (const candidate of value) {
    const normalized = normalizeEvidenceReference(candidate, options);
    if (!normalized) continue;
    const key = evidenceReferenceKey(normalized);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
}
function evidenceReferenceKey(reference: EvidenceReference) {
  return [
    reference.sourceID ?? "",
    reference.libraryID ?? "",
    reference.attachmentKey,
    reference.pageIndex ?? "",
    reference.pageLabel ?? "",
    reference.sectionPath?.join(" > ") ?? "",
    reference.elementType ?? "",
    reference.elementId ?? "",
    reference.quoteHash ?? reference.quote ?? "",
  ].join("|");
}
function formatEvidenceLocator(reference: EvidenceReference) {
  const parts: string[] = [];
  if (reference.pageLabel) {
    parts.push(`Page ${reference.pageLabel}`);
  } else if (reference.pageIndex !== undefined) {
    parts.push(`Page ${reference.pageIndex + 1}`);
  }
  if (reference.sectionPath?.length) {
    parts.push(reference.sectionPath.join(" › "));
  }
  if (reference.elementType) {
    const elementID = reference.elementID ?? reference.elementId;
    const id = elementID ? ` ${elementID}` : "";
    parts.push(
      `${reference.elementType[0].toUpperCase()}${reference.elementType.slice(1)}${id}`,
    );
  }
  return parts.length > 0 ? parts.join(" · ") : "Source location unavailable";
}
function toPdfNavigationTarget(reference: EvidenceReference) {
  if (reference.verification?.status !== "verified") return null;
  return {
    sourceID: reference.sourceID,
    libraryID: reference.libraryID,
    attachmentKey: reference.attachmentKey,
    ...(reference.pageIndex !== undefined
      ? { pageIndex: reference.pageIndex }
      : {}),
    ...(reference.pageLabel ? { pageLabel: reference.pageLabel } : {}),
    ...(reference.boundingBoxes
      ? { boundingBoxes: reference.boundingBoxes }
      : reference.boundingBox
        ? { boundingBox: reference.boundingBox }
        : {}),
    ...(reference.exactQuote
      ? { exactQuote: reference.exactQuote }
      : reference.quote
        ? { quote: reference.quote }
        : {}),
  };
}

export {
  EVIDENCE_REFERENCE_SCHEMA_VERSION,
  evidenceReferenceKey,
  formatEvidenceLocator,
  normalizeEvidenceReference,
  normalizeEvidenceReferences,
  toPdfNavigationTarget,
};
