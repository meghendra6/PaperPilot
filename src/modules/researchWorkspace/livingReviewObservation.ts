import { buildPaperContentFingerprint } from "../tools/paperWorkspaceContent";
import type {
  ResearchWorkspaceAnnotationFingerprint,
  ResearchWorkspaceLivingReviewSnapshot,
  ResearchWorkspaceSourceRecord,
} from "./persistence/contracts";

interface ZoteroLivingReviewItems {
  getByLibraryAndKeyAsync?: (
    libraryID: number,
    key: string,
  ) => Promise<unknown>;
  getByLibraryAndKey?: (libraryID: number, key: string) => unknown;
  getAsync?: (id: number | string) => Promise<unknown>;
  get?: (id: number | string) => unknown;
}

interface ZoteroLivingReviewAttachment {
  libraryID?: unknown;
  key?: unknown;
  version?: unknown;
  dateModified?: unknown;
  getField?: (field: string) => unknown;
  getFilePathAsync?: () => Promise<unknown>;
  getAnnotations?: (includeEmbedded: boolean) => unknown;
}

interface ZoteroLivingReviewAnnotation {
  key?: unknown;
  version?: unknown;
  dateModified?: unknown;
  getField?: (field: string) => unknown;
}

export interface ZoteroLivingReviewObserverDependencies {
  items?: ZoteroLivingReviewItems;
  fileExists?: (path: string) => Promise<boolean>;
  statFile?: (path: string) => Promise<unknown>;
  buildContentFingerprint?: typeof buildPaperContentFingerprint;
}

export type ZoteroLivingReviewObserver = (
  source: ResearchWorkspaceSourceRecord,
  observedAt: string,
) => Promise<ResearchWorkspaceLivingReviewSnapshot>;

function runtimeItems(): ZoteroLivingReviewItems | undefined {
  return (
    globalThis as typeof globalThis & {
      Zotero?: { Items?: ZoteroLivingReviewItems };
    }
  ).Zotero?.Items;
}

function runtimeIOUtils() {
  return (
    globalThis as typeof globalThis & {
      IOUtils?: {
        exists?: (path: string) => Promise<boolean>;
        stat?: (path: string) => Promise<unknown>;
      };
    }
  ).IOUtils;
}

async function resolveStableAttachment(
  items: ZoteroLivingReviewItems | undefined,
  libraryID: number,
  attachmentKey: string,
): Promise<ZoteroLivingReviewAttachment | undefined> {
  if (!items) return undefined;

  let candidate: unknown;
  if (items.getByLibraryAndKeyAsync) {
    try {
      candidate = await items.getByLibraryAndKeyAsync(libraryID, attachmentKey);
    } catch {
      // Older Zotero versions may only expose the synchronous lookup.
    }
  }
  if (!candidate && items.getByLibraryAndKey) {
    try {
      candidate = items.getByLibraryAndKey(libraryID, attachmentKey);
    } catch {
      return undefined;
    }
  }
  if (!candidate || typeof candidate !== "object") return undefined;

  const attachment = candidate as ZoteroLivingReviewAttachment;
  if (
    Number(attachment.libraryID) !== libraryID ||
    String(attachment.key ?? "").trim() !== attachmentKey
  ) {
    return undefined;
  }
  return attachment;
}

function firstItem(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value;
}

async function resolveAnnotation(
  candidate: unknown,
  items: ZoteroLivingReviewItems | undefined,
): Promise<ZoteroLivingReviewAnnotation | undefined> {
  if (candidate && typeof candidate === "object") {
    return candidate as ZoteroLivingReviewAnnotation;
  }
  if (
    (typeof candidate !== "number" && typeof candidate !== "string") ||
    candidate === ""
  ) {
    return undefined;
  }

  let resolved: unknown;
  if (items?.getAsync) {
    try {
      resolved = firstItem(await items.getAsync(candidate));
    } catch {
      // Fall through to the synchronous compatibility API.
    }
  }
  if (!resolved && items?.get) {
    resolved = firstItem(items.get(candidate));
  }
  return resolved && typeof resolved === "object"
    ? (resolved as ZoteroLivingReviewAnnotation)
    : undefined;
}

function annotationDateModified(annotation: ZoteroLivingReviewAnnotation) {
  const direct = String(annotation.dateModified ?? "").trim();
  if (direct) return direct;
  return String(annotation.getField?.("dateModified") ?? "").trim();
}

function fingerprint(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a32:${value.length}:${(hash >>> 0)
    .toString(16)
    .padStart(8, "0")}`;
}

async function observeAnnotations(
  attachment: ZoteroLivingReviewAttachment,
  items: ZoteroLivingReviewItems | undefined,
): Promise<ResearchWorkspaceAnnotationFingerprint | undefined> {
  if (!attachment.getAnnotations) return undefined;

  let candidates: unknown;
  try {
    candidates = await Promise.resolve(attachment.getAnnotations(false));
  } catch {
    return undefined;
  }
  if (!Array.isArray(candidates)) return undefined;

  const entries: string[] = [];
  for (const candidate of candidates) {
    let annotation: ZoteroLivingReviewAnnotation | undefined;
    try {
      annotation = await resolveAnnotation(candidate, items);
    } catch {
      continue;
    }
    if (!annotation) continue;
    try {
      const key = String(annotation.key ?? "").trim();
      if (!key) continue;
      const rawVersion = Number(annotation.version);
      const version =
        Number.isFinite(rawVersion) && rawVersion >= 0
          ? String(rawVersion)
          : "unknown";
      entries.push(
        JSON.stringify([key, version, annotationDateModified(annotation)]),
      );
    } catch {
      // An unreadable annotation record must not make the PDF look unreadable.
    }
  }

  const canonicalEntries = [...new Set(entries)].sort();
  const canonical = JSON.stringify(canonicalEntries);
  return {
    algorithm: "zotero-annotation-keys-version-date-v1",
    value: fingerprint(canonical),
    count: canonicalEntries.length,
  };
}

function snapshot(
  sourceID: string,
  observedAt: string,
  availability: ResearchWorkspaceLivingReviewSnapshot["availability"],
  annotation?: ResearchWorkspaceAnnotationFingerprint,
  contentFingerprint?: string,
): ResearchWorkspaceLivingReviewSnapshot {
  return {
    sourceID,
    observedAt,
    availability,
    ...(contentFingerprint ? { contentFingerprint } : {}),
    ...(annotation
      ? { annotation, annotationFingerprint: annotation.value }
      : {}),
  };
}

/**
 * Creates a metadata-only Zotero observer for Living Review.
 *
 * The observer deliberately uses stable library/attachment keys and never reads
 * PDF bytes, attachment text, annotation text/comments, or annotation position.
 */
export function createZoteroLivingReviewObserver(
  dependencies: ZoteroLivingReviewObserverDependencies = {},
): ZoteroLivingReviewObserver {
  const items = dependencies.items ?? runtimeItems();
  const ioUtils = runtimeIOUtils();
  const fileExists =
    dependencies.fileExists ??
    (async (path: string) => (ioUtils?.exists ? ioUtils.exists(path) : true));
  const statFile =
    dependencies.statFile ??
    (async (path: string) => {
      if (!ioUtils?.stat) throw new Error("IOUtils.stat is unavailable");
      return ioUtils.stat(path);
    });
  const buildContentFingerprint =
    dependencies.buildContentFingerprint ?? buildPaperContentFingerprint;

  return async (source, observedAt) => {
    const attachment = await resolveStableAttachment(
      items,
      source.identity.libraryID,
      source.identity.attachmentKey,
    );
    if (!attachment) {
      return snapshot(source.sourceID, observedAt, "detached");
    }

    const annotation = await observeAnnotations(attachment, items);
    let filePath: unknown;
    try {
      filePath = await attachment.getFilePathAsync?.();
    } catch {
      return snapshot(source.sourceID, observedAt, "unreadable", annotation);
    }
    if (typeof filePath !== "string" || !filePath.trim()) {
      return snapshot(source.sourceID, observedAt, "missing-file", annotation);
    }

    try {
      if (!(await fileExists(filePath))) {
        return snapshot(
          source.sourceID,
          observedAt,
          "missing-file",
          annotation,
        );
      }
      await statFile(filePath);
      const content = await buildContentFingerprint(attachment, filePath);
      return snapshot(
        source.sourceID,
        observedAt,
        "ready",
        annotation,
        content.value,
      );
    } catch {
      return snapshot(source.sourceID, observedAt, "unreadable", annotation);
    }
  };
}
