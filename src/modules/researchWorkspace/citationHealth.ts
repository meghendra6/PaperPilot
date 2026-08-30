import { researchWorkspaceArtifactPayloadFingerprint } from "./artifactFingerprint";
import type { ResearchWorkspaceProjectDetails } from "./projectController";
import type {
  ResearchWorkspaceArtifact,
  ResearchWorkspaceSourceRecord,
} from "./persistence/contracts";

type UnknownRecord = Record<string, unknown>;

export const CITATION_HEALTH_REPORT_VERSION =
  "citation-reference-health-v1" as const;
export const CITATION_HEALTH_LOCAL_METADATA_VERSION =
  "zotero-citation-health-metadata-v1" as const;

const MAX_LIBRARY_ITEMS = 20_000;
const MAX_DRAFT_CHARACTERS = 120_000;
const MAX_DRAFT_EXCERPT_CHARACTERS = 16_000;
const MAX_DRAFT_STATEMENTS = 200;
const MAX_DRAFT_FINDINGS = 40;
const MAX_FINDINGS = 500;

const ELIGIBLE_ARTIFACT_TYPES = new Set<ResearchWorkspaceArtifact["type"]>([
  "citation-context",
  "citation-stance",
  "methodology-audit",
  "reproducibility",
]);

const CORRECTION_SIGNAL_PATTERNS: Array<{
  kind: CitationHealthMetadataSignal["kind"];
  expression: RegExp;
}> = [
  { kind: "retraction", expression: /\bretract(?:ed|ion)?\b/i },
  {
    kind: "expression-of-concern",
    expression: /\bexpression\s+of\s+concern\b/i,
  },
  { kind: "withdrawal", expression: /\bwithdraw(?:n|al)?\b/i },
  {
    kind: "correction",
    expression: /\b(?:correct(?:ed|ion)|erratum|corrigendum)\b/i,
  },
];

const STOP_WORDS = new Set([
  "about",
  "after",
  "again",
  "against",
  "also",
  "among",
  "because",
  "before",
  "being",
  "between",
  "could",
  "does",
  "from",
  "have",
  "however",
  "into",
  "more",
  "most",
  "other",
  "over",
  "paper",
  "results",
  "should",
  "study",
  "than",
  "that",
  "their",
  "there",
  "these",
  "they",
  "this",
  "those",
  "through",
  "using",
  "were",
  "which",
  "while",
  "with",
  "would",
]);

export type CitationHealthFindingKind =
  | "unresolved-citation-identity"
  | "reference-not-in-local-library"
  | "contrasting-citation-context"
  | "contrasting-citation-stance"
  | "local-correction-retraction-signal"
  | "external-provider-signal"
  | "methodology-risk"
  | "reproducibility-risk"
  | "unsupported-draft-statement";

export type CitationHealthFindingSeverity = "info" | "review" | "high";

export interface CitationHealthMetadataSignal {
  kind: "retraction" | "correction" | "expression-of-concern" | "withdrawal";
  field: "title" | "extra" | "tag";
  excerpt: string;
}

export interface CitationHealthLocalLibraryItem {
  itemID: number;
  libraryID: number;
  itemKey: string;
  title: string;
  year?: number;
  doi?: string;
  authors: string[];
  signals: CitationHealthMetadataSignal[];
}

export interface CitationHealthLocalLibrarySnapshot {
  version: typeof CITATION_HEALTH_LOCAL_METADATA_VERSION;
  observedAt: string;
  libraryIDs: number[];
  items: CitationHealthLocalLibraryItem[];
  truncated: boolean;
  limitations: string[];
}

export interface CitationHealthExternalProviderSnapshot {
  provider: string;
  observedAt: string;
  identifiersChecked: number;
  identifiersCovered: number;
  signals: Array<{
    identity: string;
    kind: string;
    summary: string;
    sourceURL?: string;
  }>;
  limitations: string[];
}

export interface CitationHealthDraftInput {
  name?: string;
  text: string;
}

export interface CitationHealthArtifactInput {
  artifactID: string;
  artifactType: ResearchWorkspaceArtifact["type"];
  version: number;
  updatedAt: string;
  payloadFingerprint: string;
  sourceIDs: string[];
}

export interface CitationHealthFinding {
  findingID: string;
  kind: CitationHealthFindingKind;
  severity: CitationHealthFindingSeverity;
  title: string;
  summary: string;
  sourceIDs: string[];
  contextIDs: string[];
  referenceIdentity?: string;
  localItem?: {
    libraryID: number;
    itemKey: string;
    title: string;
  };
  draftStatement?: {
    excerpt: string;
    offset: number;
  };
  evidence: UnknownRecord[];
  limitations: string[];
}

export interface CitationHealthReport {
  schemaVersion: 1;
  kind: "research-workspace-citation-health";
  version: typeof CITATION_HEALTH_REPORT_VERSION;
  reportID: string;
  projectID: string;
  generatedAt: string;
  scope: {
    membersRevision: number;
    includedSourceIDs: string[];
    excludedSourceIDs: string[];
  };
  inputArtifacts: CitationHealthArtifactInput[];
  localMetadata: {
    version: typeof CITATION_HEALTH_LOCAL_METADATA_VERSION;
    observedAt: string;
    fingerprint: string;
    libraryIDs: number[];
    itemCount: number;
    truncated: boolean;
  };
  externalProvider?: {
    provider: string;
    observedAt: string;
    fingerprint: string;
    identifiersChecked: number;
    identifiersCovered: number;
    signalCount: number;
    limitations: string[];
  };
  findings: CitationHealthFinding[];
  draft?: {
    name?: string;
    fingerprint: string;
    excerpt: string;
    sourceCharacters: number;
    analyzedCharacters: number;
    statementCount: number;
    truncated: boolean;
  };
  coverage: {
    eligibleArtifacts: number;
    admittedArtifacts: number;
    excludedArtifacts: number;
    citationContexts: number;
    citationStances: number;
    localLibraries: number;
    localLibraryItems: number;
    localMetadataSignals: number;
    externalProvider: {
      status: "not-configured" | "provided";
      provider?: string;
      identifiersChecked: number;
      identifiersCovered: number;
      signals: number;
      limitations: string[];
    };
    methodologyArtifacts: number;
    reproducibilityArtifacts: number;
    draftStatements: number;
    unsupportedDraftCandidates: number;
  };
  limitations: string[];
}

export function citationHealthDerivedLineage(report: CitationHealthReport) {
  const parsed = parseCitationHealthReport(report);
  return {
    membersRevision: parsed.scope.membersRevision,
    sourceIDs: [...parsed.scope.includedSourceIDs],
    artifactInputs: parsed.inputArtifacts.map((input) => ({
      artifactID: input.artifactID,
      artifactType: input.artifactType,
      version: input.version,
      updatedAt: input.updatedAt,
      payloadFingerprint: input.payloadFingerprint,
    })),
  };
}

export interface CitationHealthLocalMetadataDependencies {
  getAllItems?: (libraryID: number) => Promise<unknown[]>;
  getAllLibraries?: () => Promise<unknown[]>;
  userLibraryID?: number;
  observedAt?: string;
}

function record(value: unknown): UnknownRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : undefined;
}

function cleanText(value: unknown, maximum = 2_000) {
  return typeof value === "string"
    ? value.replace(/\s+/g, " ").trim().slice(0, maximum)
    : "";
}

function boundedStringList(value: unknown, maximum = 200) {
  return Array.isArray(value)
    ? value
        .map((entry) => cleanText(entry))
        .filter(Boolean)
        .slice(0, maximum)
    : [];
}

function normalizeDOI(value: unknown) {
  return cleanText(value, 512)
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
    .replace(/[\s.,;]+$/g, "")
    .toLocaleLowerCase();
}

function normalizeTitle(value: unknown) {
  return cleanText(value, 2_000)
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function normalizeAuthor(value: unknown) {
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

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  const candidate = record(value);
  if (!candidate) return value;
  return Object.fromEntries(
    Object.keys(candidate)
      .sort()
      .map((key) => [key, canonicalValue(candidate[key])]),
  );
}

function stableFingerprint(prefix: string, value: unknown) {
  const serialized = JSON.stringify(canonicalValue(value));
  return `${prefix}-${stableHash(serialized)}-${serialized.length.toString(16)}`;
}

function optionalYear(value: unknown) {
  const match = cleanText(value, 100).match(/\b(19|20)\d{2}\b/);
  return match ? Number(match[0]) : undefined;
}

function metadataSignals(params: {
  title: string;
  extra: string;
  tags: string[];
}) {
  const result: CitationHealthMetadataSignal[] = [];
  const values: Array<{
    field: CitationHealthMetadataSignal["field"];
    value: string;
  }> = [
    { field: "title", value: params.title },
    { field: "extra", value: params.extra },
    ...params.tags.map((value) => ({ field: "tag" as const, value })),
  ];
  const seen = new Set<string>();
  for (const entry of values) {
    for (const pattern of CORRECTION_SIGNAL_PATTERNS) {
      if (!pattern.expression.test(entry.value)) continue;
      const key = `${pattern.kind}|${entry.field}|${entry.value}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({
        kind: pattern.kind,
        field: entry.field,
        excerpt: cleanText(entry.value, 500),
      });
    }
  }
  return result.sort((left, right) =>
    `${left.kind}|${left.field}|${left.excerpt}`.localeCompare(
      `${right.kind}|${right.field}|${right.excerpt}`,
    ),
  );
}

function runtimeGetAllItems(libraryID: number) {
  const zotero = (
    globalThis as typeof globalThis & {
      Zotero?: {
        Items?: { getAll?: (...args: unknown[]) => Promise<unknown[]> };
      };
    }
  ).Zotero;
  if (typeof zotero?.Items?.getAll !== "function") {
    throw new Error("Zotero library metadata is unavailable.");
  }
  return zotero.Items.getAll(libraryID, true, false, false);
}

async function citationHealthLocalLibraryIDs(
  seedLibraryIDs: readonly number[],
  dependencies: CitationHealthLocalMetadataDependencies,
) {
  const libraryIDs = new Set(
    seedLibraryIDs.filter(
      (libraryID) => Number.isInteger(libraryID) && libraryID > 0,
    ),
  );
  const zotero = (
    globalThis as typeof globalThis & {
      Zotero?: {
        Libraries?: {
          getAll?: () => Promise<unknown[]> | unknown[];
          userLibraryID?: unknown;
        };
      };
    }
  ).Zotero;
  const getAllLibraries =
    dependencies.getAllLibraries ??
    (typeof zotero?.Libraries?.getAll === "function"
      ? async () => Promise.resolve(zotero.Libraries!.getAll!())
      : undefined);
  if (getAllLibraries) {
    try {
      for (const entry of await getAllLibraries()) {
        const library = record(entry);
        const libraryID = Number(library?.libraryID ?? library?.id ?? entry);
        if (Number.isInteger(libraryID) && libraryID > 0) {
          libraryIDs.add(libraryID);
        }
      }
    } catch {
      // Seed project libraries remain available when the library catalog fails.
    }
  }
  const userLibraryID = Number(
    dependencies.userLibraryID ?? zotero?.Libraries?.userLibraryID,
  );
  if (Number.isInteger(userLibraryID) && userLibraryID > 0) {
    libraryIDs.add(userLibraryID);
  }
  return [...libraryIDs].sort((left, right) => left - right);
}

export async function collectCitationHealthLocalLibrarySnapshot(
  libraryIDs: readonly number[],
  dependencies: CitationHealthLocalMetadataDependencies = {},
): Promise<CitationHealthLocalLibrarySnapshot> {
  const getAllItems = dependencies.getAllItems ?? runtimeGetAllItems;
  const orderedLibraryIDs = await citationHealthLocalLibraryIDs(
    libraryIDs,
    dependencies,
  );
  const items: CitationHealthLocalLibraryItem[] = [];
  const limitations = new Set<string>();
  let truncated = false;

  for (const libraryID of orderedLibraryIDs) {
    let rawItems: unknown[];
    try {
      rawItems = await getAllItems(libraryID);
    } catch (error) {
      limitations.add(
        `Library ${libraryID} metadata could not be read: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      continue;
    }
    for (const candidate of rawItems) {
      if (items.length >= MAX_LIBRARY_ITEMS) {
        truncated = true;
        break;
      }
      const item = record(candidate);
      if (!item) continue;
      try {
        const isAttachment =
          typeof item.isAttachment === "function" &&
          Boolean((item.isAttachment as () => unknown)());
        const isNote =
          typeof item.isNote === "function" &&
          Boolean((item.isNote as () => unknown)());
        if (isAttachment || isNote) continue;
        const getField =
          typeof item.getField === "function"
            ? (item.getField as (field: string) => unknown)
            : () => undefined;
        const itemID = Number(item.id);
        const resolvedLibraryID = Number(item.libraryID ?? libraryID);
        const itemKey = cleanText(item.key, 256);
        if (
          !Number.isInteger(itemID) ||
          itemID <= 0 ||
          !Number.isInteger(resolvedLibraryID) ||
          resolvedLibraryID < 0 ||
          !itemKey
        ) {
          continue;
        }
        const title = cleanText(getField("title"), 2_000);
        const extra = cleanText(getField("extra"), 4_000);
        const rawTags =
          typeof item.getTags === "function"
            ? (item.getTags as () => unknown)()
            : [];
        const tags = Array.isArray(rawTags)
          ? rawTags
              .map((entry) => cleanText(record(entry)?.tag ?? entry, 500))
              .filter(Boolean)
              .slice(0, 200)
          : [];
        const rawCreators =
          typeof item.getCreators === "function"
            ? (item.getCreators as () => unknown)()
            : [];
        const authors = Array.isArray(rawCreators)
          ? rawCreators
              .map((entry) => {
                const creator = record(entry);
                return cleanText(
                  [creator?.firstName, creator?.lastName]
                    .map((value) => cleanText(value, 200))
                    .filter(Boolean)
                    .join(" "),
                  300,
                );
              })
              .filter(Boolean)
              .slice(0, 50)
          : [];
        const year = optionalYear(getField("year") || getField("date"));
        items.push({
          itemID,
          libraryID: resolvedLibraryID,
          itemKey,
          title,
          ...(year !== undefined ? { year } : {}),
          ...(normalizeDOI(getField("DOI"))
            ? { doi: normalizeDOI(getField("DOI")) }
            : {}),
          authors,
          signals: metadataSignals({ title, extra, tags }),
        });
      } catch {
        // A malformed item cannot prevent the rest of the local library scan.
      }
    }
    if (truncated) break;
  }
  if (truncated) {
    limitations.add(
      `The local metadata scan stopped at ${MAX_LIBRARY_ITEMS.toLocaleString()} items.`,
    );
  }
  items.sort((left, right) =>
    `${left.libraryID}|${left.itemKey}`.localeCompare(
      `${right.libraryID}|${right.itemKey}`,
    ),
  );
  return {
    version: CITATION_HEALTH_LOCAL_METADATA_VERSION,
    observedAt: dependencies.observedAt ?? new Date().toISOString(),
    libraryIDs: orderedLibraryIDs,
    items,
    truncated,
    limitations: [...limitations],
  };
}

function sourceFingerprint(source: ResearchWorkspaceSourceRecord) {
  return source.contentFingerprint?.value ?? "source-content-unavailable";
}

function artifactAdmissionReason(
  artifact: ResearchWorkspaceArtifact,
  sourceByID: ReadonlyMap<string, ResearchWorkspaceSourceRecord>,
  includedSourceIDs: ReadonlySet<string>,
) {
  if (artifact.status !== "complete") return `status-${artifact.status}`;
  if (!artifact.sourceIDs.length) return "no-source-scope";
  if (artifact.sourceIDs.some((sourceID) => !includedSourceIDs.has(sourceID))) {
    return "outside-included-scope";
  }
  for (const sourceID of artifact.sourceIDs) {
    const source = sourceByID.get(sourceID);
    const lineage = artifact.lineage.inputs.find(
      (input) => input.sourceID === sourceID,
    );
    if (!source || !lineage) return "missing-source-lineage";
    if (source.availability !== "ready") return `source-${source.availability}`;
    if (lineage.contentFingerprint !== sourceFingerprint(source)) {
      return "source-fingerprint-mismatch";
    }
  }
  return undefined;
}

function contextIdentity(context: UnknownRecord) {
  const resolution = record(context.resolution) ?? {};
  const reference = record(context.reference) ?? {};
  const sourceID = cleanText(resolution.sourceID, 512);
  if (sourceID) return `source:${sourceID}`;
  const doi = normalizeDOI(reference.doi ?? resolution.doi);
  if (doi) return `doi:${doi}`;
  const title = normalizeTitle(reference.title ?? resolution.title);
  const year = optionalYear(reference.year);
  if (title) return `title:${title}:${year ?? "unknown"}`;
  const author = normalizeAuthor(reference.firstAuthor);
  if (author && year) return `author-year:${author}:${year}`;
  const raw = cleanText(reference.raw ?? context.citedPaperKey, 1_000);
  return `unresolved:${stableHash(raw || cleanText(context.id, 256))}`;
}

function localLibraryMatches(
  context: UnknownRecord,
  items: readonly CitationHealthLocalLibraryItem[],
) {
  const resolution = record(context.resolution) ?? {};
  const reference = record(context.reference) ?? {};
  const resolvedLibraryID = Number(resolution.zoteroLibraryID);
  const resolvedItemKey = cleanText(resolution.zoteroItemKey, 256);
  if (Number.isInteger(resolvedLibraryID) && resolvedItemKey) {
    return items.filter(
      (item) =>
        item.libraryID === resolvedLibraryID &&
        item.itemKey === resolvedItemKey,
    );
  }
  const doi = normalizeDOI(reference.doi ?? resolution.doi);
  if (doi) return items.filter((item) => item.doi === doi);
  const title = normalizeTitle(reference.title ?? resolution.title);
  const year = optionalYear(reference.year);
  if (title) {
    return items.filter(
      (item) =>
        normalizeTitle(item.title) === title &&
        (year === undefined || item.year === undefined || item.year === year),
    );
  }
  if (year !== undefined) {
    const firstAuthor = normalizeAuthor(reference.firstAuthor);
    if (firstAuthor) {
      return items.filter(
        (item) =>
          item.year === year &&
          item.authors.some(
            (author) => normalizeAuthor(author) === firstAuthor,
          ),
      );
    }
  }
  return [];
}

function contextEvidence(context: UnknownRecord) {
  return Array.isArray(context.evidence)
    ? context.evidence
        .map((entry) => record(entry))
        .filter((entry): entry is UnknownRecord => Boolean(entry))
        .slice(0, 20)
    : [];
}

function finding(params: Omit<CitationHealthFinding, "findingID">) {
  const semantic = {
    kind: params.kind,
    title: params.title,
    summary: params.summary,
    sourceIDs: [...params.sourceIDs].sort(),
    contextIDs: [...params.contextIDs].sort(),
    referenceIdentity: params.referenceIdentity,
    localItem: params.localItem,
    draftStatement: params.draftStatement,
  };
  return {
    findingID: `citation-health-${stableHash(JSON.stringify(semantic))}`,
    ...params,
    sourceIDs: [...new Set(params.sourceIDs)].sort(),
    contextIDs: [...new Set(params.contextIDs)].sort(),
  } satisfies CitationHealthFinding;
}

function uniqueFindings(findings: CitationHealthFinding[]) {
  const byID = new Map<string, CitationHealthFinding>();
  for (const entry of findings) {
    if (!byID.has(entry.findingID)) byID.set(entry.findingID, entry);
  }
  return [...byID.values()]
    .sort((left, right) => left.findingID.localeCompare(right.findingID))
    .slice(0, MAX_FINDINGS);
}

function tokens(value: string) {
  return new Set(
    value
      .normalize("NFKC")
      .toLocaleLowerCase()
      .match(/[\p{L}\p{N}]{3,}/gu)
      ?.filter((token) => !STOP_WORDS.has(token)) ?? [],
  );
}

function draftStatements(value: string) {
  const result: Array<{ excerpt: string; offset: number }> = [];
  const expression = /[^.!?\n]+(?:[.!?]+(?=\s|$)|$)/g;
  for (const match of value.matchAll(expression)) {
    const excerpt = cleanText(match[0], 600);
    if (excerpt.length < 35) continue;
    const empirical =
      /\[[0-9,;\s–-]+\]|\((?:[^()]*(?:19|20)\d{2}[^()]*)\)|\b(?:significant|improv|outperform|reduce|increase|decrease|demonstrat|show|found|achiev|accuracy|latency|throughput|risk|effect)\b|\b\d+(?:\.\d+)?%/i.test(
        excerpt,
      );
    if (!empirical) continue;
    result.push({ excerpt, offset: match.index ?? 0 });
    if (result.length >= MAX_DRAFT_STATEMENTS) break;
  }
  return result;
}

function hasArtifactSupport(
  statement: string,
  supportCorpus: readonly string[],
) {
  const statementTokens = tokens(statement);
  if (statementTokens.size < 3) return true;
  for (const candidate of supportCorpus) {
    const candidateTokens = tokens(candidate);
    let shared = 0;
    for (const token of statementTokens) {
      if (candidateTokens.has(token)) shared += 1;
    }
    const ratio = shared / statementTokens.size;
    if (shared >= 4 && ratio >= 0.42) return true;
  }
  return false;
}

function prepareDraft(input: CitationHealthDraftInput | undefined) {
  const source = typeof input?.text === "string" ? input.text : "";
  if (!source.trim()) return undefined;
  const bounded = source.slice(0, MAX_DRAFT_CHARACTERS);
  const excerpt = bounded.slice(0, MAX_DRAFT_EXCERPT_CHARACTERS);
  const statements = draftStatements(excerpt);
  return {
    name: cleanText(input?.name, 300) || undefined,
    fingerprint: stableFingerprint("draft", bounded),
    excerpt,
    sourceCharacters: source.length,
    analyzedCharacters: excerpt.length,
    statementCount: statements.length,
    truncated:
      source.length > MAX_DRAFT_CHARACTERS ||
      bounded.length > MAX_DRAFT_EXCERPT_CHARACTERS,
    statements,
  };
}

function supportStringsFromArtifact(artifact: ResearchWorkspaceArtifact) {
  const payload = record(artifact.payload) ?? {};
  const result: string[] = [];
  const push = (value: unknown) => {
    const text = cleanText(value, 4_000);
    if (text) result.push(text);
  };
  if (
    artifact.type === "citation-context" ||
    artifact.type === "citation-stance"
  ) {
    for (const candidate of Array.isArray(payload.contexts)
      ? payload.contexts
      : []) {
      const context = record(candidate);
      push(context?.exactSentence);
      push(context?.context);
      push(record(context?.reference)?.title);
    }
    for (const candidate of Array.isArray(payload.results)
      ? payload.results
      : []) {
      const stance = record(candidate);
      push(stance?.claim);
      push(stance?.rationale);
    }
  }
  if (artifact.type === "methodology-audit") {
    const report = record(payload.report) ?? payload;
    push(report.executiveSummary);
    for (const candidate of Array.isArray(report.checks) ? report.checks : []) {
      const check = record(candidate);
      push(check?.finding);
      push(check?.implication);
    }
  }
  if (artifact.type === "reproducibility") {
    push(payload.summary);
    for (const candidate of Array.isArray(payload.blockers)
      ? payload.blockers
      : []) {
      const blocker = record(candidate);
      push(blocker?.description);
      push(blocker?.mitigation);
    }
    for (const candidate of Array.isArray(payload.artifacts)
      ? payload.artifacts
      : []) {
      const entry = record(candidate);
      push(entry?.label);
      push(entry?.notes);
    }
  }
  return result;
}

function methodologyFindings(artifact: ResearchWorkspaceArtifact) {
  const payload = record(artifact.payload) ?? {};
  const report = record(payload.report) ?? payload;
  const result: CitationHealthFinding[] = [];
  for (const candidate of Array.isArray(report.checks) ? report.checks : []) {
    const check = record(candidate);
    if (!check) continue;
    const status = cleanText(check.status, 80);
    const severity = cleanText(check.severity, 80);
    if (
      !["partial", "unsupported", "unclear"].includes(status) &&
      !["major", "critical"].includes(severity)
    ) {
      continue;
    }
    result.push(
      finding({
        kind: "methodology-risk",
        severity: severity === "critical" ? "high" : "review",
        title: `Methodology review: ${cleanText(check.checkId, 200) || "unlabelled check"}`,
        summary:
          cleanText(check.finding, 1_000) ||
          `The saved methodology audit marked this check ${status || severity}.`,
        sourceIDs: artifact.sourceIDs,
        contextIDs: [],
        evidence: Array.isArray(check.evidence)
          ? check.evidence
              .map((entry) => record(entry))
              .filter((entry): entry is UnknownRecord => Boolean(entry))
              .slice(0, 20)
          : [],
        limitations: [
          cleanText(check.implication, 1_000) ||
            "Review the underlying study design and evidence before relying on this method signal.",
        ],
      }),
    );
  }
  return result;
}

function reproducibilityFindings(artifact: ResearchWorkspaceArtifact) {
  const payload = record(artifact.payload) ?? {};
  const result: CitationHealthFinding[] = [];
  for (const candidate of Array.isArray(payload.blockers)
    ? payload.blockers
    : []) {
    const blocker = record(candidate);
    if (!blocker) continue;
    const severity = cleanText(blocker.severity, 80) || "major";
    result.push(
      finding({
        kind: "reproducibility-risk",
        severity: severity === "critical" ? "high" : "review",
        title: `Reproducibility blocker: ${severity}`,
        summary:
          cleanText(blocker.description, 1_000) ||
          "A saved reproducibility audit reported an unspecified blocker.",
        sourceIDs: artifact.sourceIDs,
        contextIDs: [],
        evidence: Array.isArray(blocker.evidence)
          ? blocker.evidence
              .map((entry) => record(entry))
              .filter((entry): entry is UnknownRecord => Boolean(entry))
              .slice(0, 20)
          : [],
        limitations: [
          cleanText(blocker.mitigation, 1_000) ||
            "Confirm the missing reproduction material or document a substitute.",
        ],
      }),
    );
  }
  for (const candidate of Array.isArray(payload.artifacts)
    ? payload.artifacts
    : []) {
    const item = record(candidate);
    if (!item) continue;
    const availability = cleanText(item.availability ?? item.status, 80);
    if (!["missing", "partial", "unclear"].includes(availability)) continue;
    result.push(
      finding({
        kind: "reproducibility-risk",
        severity: availability === "missing" ? "high" : "review",
        title: `Reproduction material ${availability}`,
        summary: `${cleanText(item.label, 300) || "Unlabelled material"} is recorded as ${availability}.`,
        sourceIDs: artifact.sourceIDs,
        contextIDs: [],
        evidence: Array.isArray(item.evidence)
          ? item.evidence
              .map((entry) => record(entry))
              .filter((entry): entry is UnknownRecord => Boolean(entry))
              .slice(0, 20)
          : [],
        limitations: [
          cleanText(item.notes, 1_000) ||
            "Availability is derived from the saved audit and should be checked against the current local project.",
        ],
      }),
    );
  }
  return result;
}

export function buildCitationHealthReport(params: {
  details: ResearchWorkspaceProjectDetails;
  localLibrary: CitationHealthLocalLibrarySnapshot;
  generatedAt: string;
  draft?: CitationHealthDraftInput;
  externalProvider?: CitationHealthExternalProviderSnapshot;
}): CitationHealthReport {
  if (Number.isNaN(Date.parse(params.generatedAt))) {
    throw new Error("Citation Health generatedAt must be an ISO date.");
  }
  const sourceByID = new Map(
    params.details.sources.map((source) => [source.sourceID, source]),
  );
  const nonExcludedMemberSourceIDs = params.details.members
    .filter((member) => member.reviewStatus !== "excluded")
    .map((member) => member.sourceID)
    .sort();
  const includedSourceIDs = nonExcludedMemberSourceIDs.filter((sourceID) =>
    sourceByID.has(sourceID),
  );
  const missingMemberSourceIDs = nonExcludedMemberSourceIDs.filter(
    (sourceID) => !sourceByID.has(sourceID),
  );
  const includedSet = new Set(includedSourceIDs);
  const localLibraryItems = [...params.localLibrary.items].sort((left, right) =>
    `${left.libraryID}|${left.itemKey}`.localeCompare(
      `${right.libraryID}|${right.itemKey}`,
    ),
  );
  const eligible = params.details.artifacts
    .filter((artifact) => ELIGIBLE_ARTIFACT_TYPES.has(artifact.type))
    .sort((left, right) => {
      if (left.updatedAt !== right.updatedAt) {
        return left.updatedAt > right.updatedAt ? -1 : 1;
      }
      return left.artifactID.localeCompare(right.artifactID);
    });
  const admission = eligible.map((artifact) => ({
    artifact,
    reason: artifactAdmissionReason(artifact, sourceByID, includedSet),
  }));
  const admitted = admission
    .filter(
      (
        entry,
      ): entry is { artifact: ResearchWorkspaceArtifact; reason: undefined } =>
        entry.reason === undefined,
    )
    .map((entry) => entry.artifact);
  const inputArtifacts: CitationHealthArtifactInput[] = admitted
    .map((artifact) => ({
      artifactID: artifact.artifactID,
      artifactType: artifact.type,
      version: artifact.version,
      updatedAt: artifact.updatedAt,
      payloadFingerprint: researchWorkspaceArtifactPayloadFingerprint(
        artifact.payload,
      ),
      sourceIDs: [...artifact.sourceIDs].sort(),
    }))
    .sort((left, right) => left.artifactID.localeCompare(right.artifactID));

  const contexts = new Map<string, UnknownRecord>();
  const stances = new Map<string, UnknownRecord>();
  for (const artifact of admitted) {
    const payload = record(artifact.payload) ?? {};
    if (
      artifact.type === "citation-context" ||
      artifact.type === "citation-stance"
    ) {
      for (const candidate of Array.isArray(payload.contexts)
        ? payload.contexts
        : []) {
        const context = record(candidate);
        const contextID = cleanText(context?.id, 256);
        if (context && contextID && !contexts.has(contextID)) {
          contexts.set(contextID, context);
        }
      }
    }
    if (artifact.type === "citation-stance") {
      for (const candidate of Array.isArray(payload.results)
        ? payload.results
        : []) {
        const stance = record(candidate);
        const contextID = cleanText(stance?.contextId, 256);
        if (stance && contextID && !stances.has(contextID)) {
          stances.set(contextID, stance);
        }
      }
    }
  }

  const findings: CitationHealthFinding[] = [];
  const contextsByIdentity = new Map<string, UnknownRecord[]>();
  const matchedLocalItemKeys = new Set<string>();
  const localItemProvenance = new Map<
    string,
    { sourceIDs: Set<string>; contextIDs: Set<string>; identities: Set<string> }
  >();
  for (const [contextID, context] of contexts) {
    const identity = contextIdentity(context);
    const grouped = contextsByIdentity.get(identity) ?? [];
    grouped.push(context);
    contextsByIdentity.set(identity, grouped);
    const resolution = record(context.resolution) ?? {};
    const resolutionStatus = cleanText(resolution.status, 80) || "unresolved";
    const localMatches = localLibraryMatches(context, localLibraryItems);
    for (const item of localMatches) {
      const itemKey = `${item.libraryID}:${item.itemKey}`;
      matchedLocalItemKeys.add(itemKey);
      const provenance = localItemProvenance.get(itemKey) ?? {
        sourceIDs: new Set<string>(),
        contextIDs: new Set<string>(),
        identities: new Set<string>(),
      };
      const citingSourceID = cleanText(context.citingSourceID, 512);
      if (citingSourceID) provenance.sourceIDs.add(citingSourceID);
      provenance.contextIDs.add(contextID);
      provenance.identities.add(identity);
      localItemProvenance.set(itemKey, provenance);
    }
    const sourceID = cleanText(context.citingSourceID, 512);
    if (resolutionStatus !== "resolved" || localMatches.length > 1) {
      findings.push(
        finding({
          kind: "unresolved-citation-identity",
          severity: "review",
          title:
            localMatches.length > 1
              ? "Citation identity is ambiguous"
              : "Citation identity is unresolved",
          summary: cleanText(
            record(context.reference)?.raw ??
              record(context.reference)?.title ??
              context.citedPaperKey,
            1_000,
          ),
          sourceIDs: sourceID ? [sourceID] : [],
          contextIDs: [contextID],
          referenceIdentity: identity,
          evidence: contextEvidence(context),
          limitations: [
            localMatches.length > 1
              ? "Multiple current local Zotero items match this bounded identity; no item was selected automatically."
              : "No unique project or local Zotero identity was established from the saved citation metadata.",
          ],
        }),
      );
    }
    const reference = record(context.reference) ?? {};
    const hasPortableIdentity = Boolean(
      normalizeDOI(reference.doi) ||
        (normalizeTitle(reference.title) && optionalYear(reference.year)),
    );
    const resolvesToProjectSource = Boolean(
      cleanText(resolution.sourceID, 512),
    );
    if (
      hasPortableIdentity &&
      !resolvesToProjectSource &&
      localMatches.length === 0
    ) {
      findings.push(
        finding({
          kind: "reference-not-in-local-library",
          severity: "info",
          title: "Reference is not present in the scanned local Zotero library",
          summary: cleanText(
            reference.title ?? reference.raw ?? context.citedPaperKey,
            1_000,
          ),
          sourceIDs: sourceID ? [sourceID] : [],
          contextIDs: [contextID],
          referenceIdentity: identity,
          evidence: contextEvidence(context),
          limitations: [
            "This is an additive local-library coverage check; absence does not mean the reference does not exist outside the scanned Zotero libraries.",
          ],
        }),
      );
    }
    const stance = cleanText(stances.get(contextID)?.stance, 80);
    if (stance === "contrasting") {
      findings.push(
        finding({
          kind: "contrasting-citation-stance",
          severity: "review",
          title: "Saved citation stance is contrasting",
          summary:
            cleanText(stances.get(contextID)?.rationale, 1_000) ||
            cleanText(context.exactSentence ?? context.context, 1_000),
          sourceIDs: sourceID ? [sourceID] : [],
          contextIDs: [contextID],
          referenceIdentity: identity,
          evidence: contextEvidence(context),
          limitations: [
            "Citation stance is a review signal about the local citing sentence, not a verdict about the cited work or claim.",
          ],
        }),
      );
    }
  }

  for (const [identity, groupedContexts] of contextsByIdentity) {
    const stanceValues = new Set(
      groupedContexts
        .map((context) =>
          cleanText(stances.get(cleanText(context.id, 256))?.stance, 80),
        )
        .filter((value) => value && value !== "uncertain"),
    );
    if (!stanceValues.has("contrasting") || stanceValues.size < 2) continue;
    const contextIDs = groupedContexts
      .map((context) => cleanText(context.id, 256))
      .filter(Boolean)
      .sort();
    const sourceIDs = groupedContexts
      .map((context) => cleanText(context.citingSourceID, 512))
      .filter(Boolean);
    findings.push(
      finding({
        kind: "contrasting-citation-context",
        severity: "review",
        title: "The same cited identity appears in contrasting contexts",
        summary: `Saved contexts use the stances ${[...stanceValues].sort().join(", ")}.`,
        sourceIDs,
        contextIDs,
        referenceIdentity: identity,
        evidence: groupedContexts.flatMap(contextEvidence).slice(0, 40),
        limitations: [
          "Different citation purposes may be legitimate. Review the exact local sentences and study designs before interpreting the contrast.",
        ],
      }),
    );
  }

  const sourceIdentityKeys = new Set<string>();
  const sourceIDsByIdentity = new Map<string, Set<string>>();
  for (const source of params.details.sources) {
    if (!includedSet.has(source.sourceID)) continue;
    const identities = [
      ...(source.doi ? [`doi:${normalizeDOI(source.doi)}`] : []),
      `title:${normalizeTitle(source.title)}:${source.year ?? "unknown"}`,
    ];
    for (const identity of identities) {
      sourceIdentityKeys.add(identity);
      const sourceIDs = sourceIDsByIdentity.get(identity) ?? new Set<string>();
      sourceIDs.add(source.sourceID);
      sourceIDsByIdentity.set(identity, sourceIDs);
    }
  }
  for (const item of localLibraryItems) {
    const itemKey = `${item.libraryID}:${item.itemKey}`;
    const identities = [
      ...(item.doi ? [`doi:${item.doi}`] : []),
      `title:${normalizeTitle(item.title)}:${item.year ?? "unknown"}`,
    ];
    const relevant =
      matchedLocalItemKeys.has(itemKey) ||
      identities.some((identity) => sourceIdentityKeys.has(identity));
    if (!relevant) continue;
    const provenance = localItemProvenance.get(itemKey);
    const sourceIDs = new Set(provenance?.sourceIDs ?? []);
    for (const identity of identities) {
      for (const sourceID of sourceIDsByIdentity.get(identity) ?? []) {
        sourceIDs.add(sourceID);
      }
    }
    const contextIDs = [...(provenance?.contextIDs ?? [])];
    const referenceIdentity =
      [...(provenance?.identities ?? [])].sort()[0] ?? identities[0];
    for (const signal of item.signals) {
      findings.push(
        finding({
          kind: "local-correction-retraction-signal",
          severity:
            signal.kind === "retraction" || signal.kind === "withdrawal"
              ? "high"
              : "review",
          title: `Local Zotero metadata contains a ${signal.kind.replace(/-/g, " ")} signal`,
          summary: signal.excerpt,
          sourceIDs: [...sourceIDs],
          contextIDs,
          referenceIdentity,
          localItem: {
            libraryID: item.libraryID,
            itemKey: item.itemKey,
            title: item.title,
          },
          evidence: [],
          limitations: [
            `This signal comes from the local Zotero ${signal.field} field. Paper Pilot has not independently verified the publisher record.`,
          ],
        }),
      );
    }
  }

  for (const artifact of admitted) {
    if (artifact.type === "methodology-audit") {
      findings.push(...methodologyFindings(artifact));
    } else if (artifact.type === "reproducibility") {
      findings.push(...reproducibilityFindings(artifact));
    }
  }

  if (params.externalProvider) {
    for (const signal of params.externalProvider.signals.slice(0, 100)) {
      const matchingContexts = contextsByIdentity.get(signal.identity) ?? [];
      const sourceIDs = new Set(
        matchingContexts
          .map((context) => cleanText(context.citingSourceID, 512))
          .filter(Boolean),
      );
      for (const sourceID of sourceIDsByIdentity.get(signal.identity) ?? []) {
        sourceIDs.add(sourceID);
      }
      findings.push(
        finding({
          kind: "external-provider-signal",
          severity: "review",
          title: `${cleanText(params.externalProvider.provider, 200)} signal: ${cleanText(signal.kind, 200)}`,
          summary: cleanText(signal.summary, 1_000),
          sourceIDs: [...sourceIDs],
          contextIDs: matchingContexts
            .map((context) => cleanText(context.id, 256))
            .filter(Boolean),
          referenceIdentity: cleanText(signal.identity, 512),
          evidence: [],
          limitations: [
            "This optional external-provider signal is not treated as a sole source of truth and requires review against local and primary metadata.",
            ...params.externalProvider.limitations.slice(0, 10),
          ],
        }),
      );
    }
  }

  const draft = prepareDraft(params.draft);
  if (draft) {
    const supportCorpus = admitted.flatMap(supportStringsFromArtifact);
    let unsupported = 0;
    for (const statement of draft.statements) {
      if (hasArtifactSupport(statement.excerpt, supportCorpus)) continue;
      unsupported += 1;
      if (unsupported > MAX_DRAFT_FINDINGS) continue;
      findings.push(
        finding({
          kind: "unsupported-draft-statement",
          severity: "review",
          title:
            "No matching support was found in the admitted saved artifacts",
          summary: statement.excerpt,
          sourceIDs: [],
          contextIDs: [],
          draftStatement: statement,
          evidence: [],
          limitations: [
            "This is a bounded lexical coverage check, not an entailment or truth judgment. Rephrase, add a citation, or inspect the underlying sources manually.",
          ],
        }),
      );
    }
  }

  const methodologyArtifacts = admitted.filter(
    (artifact) => artifact.type === "methodology-audit",
  ).length;
  const reproducibilityArtifacts = admitted.filter(
    (artifact) => artifact.type === "reproducibility",
  ).length;
  const limitations = new Set<string>([
    "Citation and reference health is a deterministic review checklist, not an aggregate quality or truth score.",
    "Local citation identity and library-absence checks cover only the current project sources and scanned Zotero libraries.",
    "Correction and retraction terms in local metadata are signals requiring primary-source verification; they are not authoritative status determinations.",
    "Methodology and reproducibility findings are inherited from current saved audits and retain those artifacts' evidence and coverage limits.",
    ...params.localLibrary.limitations,
    ...admission
      .filter((entry) => entry.reason)
      .slice(0, 30)
      .map(
        (entry) =>
          `${entry.artifact.title} v${entry.artifact.version} was excluded: ${entry.reason}.`,
      ),
  ]);
  if (!contexts.size) {
    limitations.add(
      "No current Citation Context artifact was admitted, so citation identity and local-library reference coverage could not be assessed.",
    );
  }
  if (missingMemberSourceIDs.length) {
    limitations.add(
      `${missingMemberSourceIDs.length} non-excluded project source record${missingMemberSourceIDs.length === 1 ? " is" : "s are"} unavailable and were omitted from the derived lineage: ${missingMemberSourceIDs.slice(0, 20).join(", ")}.`,
    );
  }
  if (!stances.size) {
    limitations.add(
      "No current Citation Stance result was admitted; context contrast is limited to saved local citation metadata.",
    );
  }
  if (!methodologyArtifacts) {
    limitations.add(
      "No current Methodology Audit was admitted, so method-risk coverage is absent.",
    );
  }
  if (!reproducibilityArtifacts) {
    limitations.add(
      "No current Reproducibility Audit was admitted, so reproduction-risk coverage is absent.",
    );
  }
  if (!params.externalProvider) {
    limitations.add(
      "No optional external citation-status provider was configured; the report relies on saved local artifacts and local Zotero metadata only.",
    );
  }
  if (draft?.truncated) {
    limitations.add(
      `The imported draft was bounded to ${MAX_DRAFT_CHARACTERS.toLocaleString()} source characters and a ${MAX_DRAFT_EXCERPT_CHARACTERS.toLocaleString()}-character persisted excerpt.`,
    );
  }

  const orderedFindings = uniqueFindings(findings);
  const localMetadataFingerprint = stableFingerprint(
    "citation-health-local-metadata",
    {
      version: params.localLibrary.version,
      libraryIDs: params.localLibrary.libraryIDs,
      items: localLibraryItems.map((item) => ({
        libraryID: item.libraryID,
        itemKey: item.itemKey,
        title: item.title,
        year: item.year,
        doi: item.doi,
        authors: item.authors,
        signals: item.signals,
      })),
      truncated: params.localLibrary.truncated,
    },
  );
  const externalProviderProvenance = params.externalProvider
    ? {
        provider: cleanText(params.externalProvider.provider, 200),
        observedAt: params.externalProvider.observedAt,
        fingerprint: stableFingerprint("citation-health-external-provider", {
          provider: params.externalProvider.provider,
          identifiersChecked: params.externalProvider.identifiersChecked,
          identifiersCovered: params.externalProvider.identifiersCovered,
          signals: params.externalProvider.signals,
          limitations: params.externalProvider.limitations,
        }),
        identifiersChecked: Math.max(
          0,
          Math.floor(params.externalProvider.identifiersChecked),
        ),
        identifiersCovered: Math.max(
          0,
          Math.floor(params.externalProvider.identifiersCovered),
        ),
        signalCount: params.externalProvider.signals.length,
        limitations: params.externalProvider.limitations.slice(0, 20),
      }
    : undefined;
  const semanticInputs = {
    projectID: params.details.project.projectID,
    membersRevision: params.details.membersRevision,
    inputArtifacts,
    localMetadataFingerprint,
    externalProviderFingerprint: externalProviderProvenance?.fingerprint,
    draftFingerprint: draft?.fingerprint,
  };
  const report: CitationHealthReport = {
    schemaVersion: 1,
    kind: "research-workspace-citation-health",
    version: CITATION_HEALTH_REPORT_VERSION,
    reportID: `citation-health-report-${stableHash(JSON.stringify(canonicalValue(semanticInputs)))}`,
    projectID: params.details.project.projectID,
    generatedAt: params.generatedAt,
    scope: {
      membersRevision: params.details.membersRevision,
      includedSourceIDs,
      excludedSourceIDs: params.details.members
        .filter((member) => member.reviewStatus === "excluded")
        .map((member) => member.sourceID)
        .sort(),
    },
    inputArtifacts,
    localMetadata: {
      version: params.localLibrary.version,
      observedAt: params.localLibrary.observedAt,
      fingerprint: localMetadataFingerprint,
      libraryIDs: [...params.localLibrary.libraryIDs],
      itemCount: localLibraryItems.length,
      truncated: params.localLibrary.truncated,
    },
    ...(externalProviderProvenance
      ? { externalProvider: externalProviderProvenance }
      : {}),
    findings: orderedFindings,
    ...(draft
      ? {
          draft: {
            ...(draft.name ? { name: draft.name } : {}),
            fingerprint: draft.fingerprint,
            excerpt: draft.excerpt,
            sourceCharacters: draft.sourceCharacters,
            analyzedCharacters: draft.analyzedCharacters,
            statementCount: draft.statementCount,
            truncated: draft.truncated,
          },
        }
      : {}),
    coverage: {
      eligibleArtifacts: eligible.length,
      admittedArtifacts: admitted.length,
      excludedArtifacts: admission.filter((entry) => entry.reason).length,
      citationContexts: contexts.size,
      citationStances: stances.size,
      localLibraries: params.localLibrary.libraryIDs.length,
      localLibraryItems: localLibraryItems.length,
      localMetadataSignals: orderedFindings.filter(
        (entry) => entry.kind === "local-correction-retraction-signal",
      ).length,
      externalProvider: params.externalProvider
        ? {
            status: "provided",
            provider: cleanText(params.externalProvider.provider, 200),
            identifiersChecked: Math.max(
              0,
              Math.floor(params.externalProvider.identifiersChecked),
            ),
            identifiersCovered: Math.max(
              0,
              Math.floor(params.externalProvider.identifiersCovered),
            ),
            signals: params.externalProvider.signals.length,
            limitations: params.externalProvider.limitations.slice(0, 20),
          }
        : {
            status: "not-configured",
            identifiersChecked: 0,
            identifiersCovered: 0,
            signals: 0,
            limitations: [
              "No external provider was called. Optional providers must remain supplementary to local and primary metadata.",
            ],
          },
      methodologyArtifacts,
      reproducibilityArtifacts,
      draftStatements: draft?.statementCount ?? 0,
      unsupportedDraftCandidates: orderedFindings.filter(
        (entry) => entry.kind === "unsupported-draft-statement",
      ).length,
    },
    limitations: [...limitations],
  };
  return parseCitationHealthReport(report);
}

function requireRecord(value: unknown, label: string) {
  const candidate = record(value);
  if (!candidate) throw new Error(`${label} must be an object.`);
  return candidate;
}

function requireText(value: unknown, label: string, maximum = 2_000) {
  const candidate = cleanText(value, maximum + 1);
  if (!candidate) throw new Error(`${label} is required.`);
  if (candidate.length > maximum) throw new Error(`${label} is too long.`);
  return candidate;
}

function requireInteger(value: unknown, label: string, maximum = 1_000_000) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number > maximum) {
    throw new Error(`${label} must be a bounded non-negative integer.`);
  }
  return number;
}

export function parseCitationHealthReport(
  value: unknown,
): CitationHealthReport {
  const root = requireRecord(value, "Citation Health report");
  if (
    "truthScore" in root ||
    "aggregateTruthScore" in root ||
    "qualityScore" in root
  ) {
    throw new Error(
      "Citation Health must not contain an aggregate truth score.",
    );
  }
  if (root.schemaVersion !== 1) {
    throw new Error("Citation Health schemaVersion is unsupported.");
  }
  if (root.kind !== "research-workspace-citation-health") {
    throw new Error("Citation Health kind is unsupported.");
  }
  if (root.version !== CITATION_HEALTH_REPORT_VERSION) {
    throw new Error("Citation Health report version is unsupported.");
  }
  requireText(root.reportID, "Citation Health reportID", 256);
  requireText(root.projectID, "Citation Health projectID", 256);
  const generatedAt = requireText(
    root.generatedAt,
    "Citation Health generatedAt",
    100,
  );
  if (Number.isNaN(Date.parse(generatedAt))) {
    throw new Error("Citation Health generatedAt must be an ISO date.");
  }
  const scope = requireRecord(root.scope, "Citation Health scope");
  requireInteger(scope.membersRevision, "Citation Health membersRevision");
  for (const key of ["includedSourceIDs", "excludedSourceIDs"] as const) {
    if (!Array.isArray(scope[key]) || scope[key].length > 10_000) {
      throw new Error(`Citation Health ${key} must be a bounded array.`);
    }
    const normalized = scope[key].map((entry) =>
      requireText(entry, `Citation Health ${key} entry`, 512),
    );
    if (new Set(normalized).size !== normalized.length) {
      throw new Error(`Citation Health ${key} must be unique.`);
    }
  }
  if (!Array.isArray(root.inputArtifacts) || root.inputArtifacts.length > 500) {
    throw new Error("Citation Health inputArtifacts must be a bounded array.");
  }
  const artifactIDs = new Set<string>();
  for (const [index, candidate] of root.inputArtifacts.entries()) {
    const input = requireRecord(
      candidate,
      `Citation Health input artifact ${index + 1}`,
    );
    const artifactID = requireText(
      input.artifactID,
      "Citation Health artifactID",
      256,
    );
    if (artifactIDs.has(artifactID)) {
      throw new Error(`Duplicate Citation Health artifact ${artifactID}.`);
    }
    artifactIDs.add(artifactID);
    if (!ELIGIBLE_ARTIFACT_TYPES.has(input.artifactType as never)) {
      throw new Error("Citation Health input artifact type is unsupported.");
    }
    if (requireInteger(input.version, "Citation Health artifact version") < 1) {
      throw new Error("Citation Health artifact version must be positive.");
    }
    requireText(input.updatedAt, "Citation Health artifact updatedAt", 100);
    requireText(
      input.payloadFingerprint,
      "Citation Health artifact payloadFingerprint",
      512,
    );
    if (!Array.isArray(input.sourceIDs) || input.sourceIDs.length > 10_000) {
      throw new Error("Citation Health artifact sourceIDs must be bounded.");
    }
    const sourceIDs = input.sourceIDs.map((entry) =>
      requireText(entry, "Citation Health artifact sourceID", 512),
    );
    if (new Set(sourceIDs).size !== sourceIDs.length) {
      throw new Error("Citation Health artifact sourceIDs must be unique.");
    }
  }
  const localMetadata = requireRecord(
    root.localMetadata,
    "Citation Health local metadata provenance",
  );
  if (localMetadata.version !== CITATION_HEALTH_LOCAL_METADATA_VERSION) {
    throw new Error("Citation Health local metadata version is unsupported.");
  }
  const localObservedAt = requireText(
    localMetadata.observedAt,
    "Citation Health local metadata observedAt",
    100,
  );
  if (Number.isNaN(Date.parse(localObservedAt))) {
    throw new Error(
      "Citation Health local metadata observedAt must be an ISO date.",
    );
  }
  requireText(
    localMetadata.fingerprint,
    "Citation Health local metadata fingerprint",
    512,
  );
  if (
    !Array.isArray(localMetadata.libraryIDs) ||
    localMetadata.libraryIDs.length > 10_000
  ) {
    throw new Error(
      "Citation Health local libraryIDs must be a bounded array.",
    );
  }
  const libraryIDs = localMetadata.libraryIDs.map((entry) =>
    requireInteger(entry, "Citation Health local libraryID", 1_000_000_000),
  );
  if (new Set(libraryIDs).size !== libraryIDs.length) {
    throw new Error("Citation Health local libraryIDs must be unique.");
  }
  requireInteger(
    localMetadata.itemCount,
    "Citation Health local metadata itemCount",
    MAX_LIBRARY_ITEMS,
  );
  if (typeof localMetadata.truncated !== "boolean") {
    throw new Error(
      "Citation Health local metadata truncated must be boolean.",
    );
  }
  if (root.externalProvider !== undefined) {
    const provider = requireRecord(
      root.externalProvider,
      "Citation Health external provider provenance",
    );
    requireText(provider.provider, "Citation Health external provider", 200);
    const observedAt = requireText(
      provider.observedAt,
      "Citation Health external provider observedAt",
      100,
    );
    if (Number.isNaN(Date.parse(observedAt))) {
      throw new Error(
        "Citation Health external provider observedAt must be an ISO date.",
      );
    }
    requireText(
      provider.fingerprint,
      "Citation Health external provider fingerprint",
      512,
    );
    const identifiersChecked = requireInteger(
      provider.identifiersChecked,
      "Citation Health external identifiersChecked",
      10_000_000,
    );
    const identifiersCovered = requireInteger(
      provider.identifiersCovered,
      "Citation Health external identifiersCovered",
      10_000_000,
    );
    if (identifiersCovered > identifiersChecked) {
      throw new Error(
        "Citation Health external identifiersCovered cannot exceed identifiersChecked.",
      );
    }
    requireInteger(
      provider.signalCount,
      "Citation Health external signalCount",
      10_000_000,
    );
    if (
      !Array.isArray(provider.limitations) ||
      provider.limitations.length > 100
    ) {
      throw new Error(
        "Citation Health external provider limitations must be bounded.",
      );
    }
    for (const entry of provider.limitations) {
      requireText(entry, "Citation Health external provider limitation", 2_000);
    }
  }
  if (!Array.isArray(root.findings) || root.findings.length > MAX_FINDINGS) {
    throw new Error("Citation Health findings must be a bounded array.");
  }
  const findingIDs = new Set<string>();
  const findingKinds = new Set<CitationHealthFindingKind>([
    "unresolved-citation-identity",
    "reference-not-in-local-library",
    "contrasting-citation-context",
    "contrasting-citation-stance",
    "local-correction-retraction-signal",
    "external-provider-signal",
    "methodology-risk",
    "reproducibility-risk",
    "unsupported-draft-statement",
  ]);
  for (const [index, candidate] of root.findings.entries()) {
    const item = requireRecord(
      candidate,
      `Citation Health finding ${index + 1}`,
    );
    const findingID = requireText(
      item.findingID,
      "Citation Health findingID",
      256,
    );
    if (findingIDs.has(findingID)) {
      throw new Error(`Duplicate Citation Health finding ${findingID}.`);
    }
    findingIDs.add(findingID);
    if (!findingKinds.has(item.kind as CitationHealthFindingKind)) {
      throw new Error("Citation Health finding kind is unsupported.");
    }
    if (
      typeof item.severity !== "string" ||
      !new Set(["info", "review", "high"]).has(item.severity)
    ) {
      throw new Error("Citation Health finding severity is unsupported.");
    }
    requireText(item.title, "Citation Health finding title", 500);
    requireText(item.summary, "Citation Health finding summary", 2_000);
    if (
      !Array.isArray(item.sourceIDs) ||
      item.sourceIDs.length > 10_000 ||
      !Array.isArray(item.contextIDs) ||
      item.contextIDs.length > 10_000 ||
      !Array.isArray(item.evidence) ||
      item.evidence.length > 200 ||
      !Array.isArray(item.limitations) ||
      item.limitations.length > 100
    ) {
      throw new Error("Citation Health finding provenance is not bounded.");
    }
    const sourceIDs = item.sourceIDs.map((entry) =>
      requireText(entry, "Citation Health finding sourceID", 512),
    );
    const contextIDs = item.contextIDs.map((entry) =>
      requireText(entry, "Citation Health finding contextID", 256),
    );
    if (
      new Set(sourceIDs).size !== sourceIDs.length ||
      new Set(contextIDs).size !== contextIDs.length
    ) {
      throw new Error(
        "Citation Health finding sourceIDs and contextIDs must be unique.",
      );
    }
    for (const entry of item.limitations) {
      requireText(entry, "Citation Health finding limitation", 2_000);
    }
    if (item.referenceIdentity !== undefined) {
      requireText(
        item.referenceIdentity,
        "Citation Health reference identity",
        512,
      );
    }
    if (item.localItem !== undefined) {
      const localItem = requireRecord(
        item.localItem,
        "Citation Health local item",
      );
      requireInteger(
        localItem.libraryID,
        "Citation Health local item libraryID",
        1_000_000_000,
      );
      requireText(localItem.itemKey, "Citation Health local item itemKey", 256);
      requireText(localItem.title, "Citation Health local item title", 2_000);
    }
    for (const evidence of item.evidence) {
      requireRecord(evidence, "Citation Health finding evidence");
    }
    if (item.draftStatement !== undefined) {
      const draftStatement = requireRecord(
        item.draftStatement,
        "Citation Health draft statement",
      );
      requireText(
        draftStatement.excerpt,
        "Citation Health draft statement excerpt",
        600,
      );
      requireInteger(
        draftStatement.offset,
        "Citation Health draft statement offset",
        MAX_DRAFT_CHARACTERS,
      );
    }
  }
  if (root.draft !== undefined) {
    const draft = requireRecord(root.draft, "Citation Health draft");
    if (draft.name !== undefined) {
      requireText(draft.name, "Citation Health draft name", 300);
    }
    requireText(draft.fingerprint, "Citation Health draft fingerprint", 512);
    if (typeof draft.excerpt !== "string") {
      throw new Error("Citation Health draft excerpt must be a string.");
    }
    if (draft.excerpt.length > MAX_DRAFT_EXCERPT_CHARACTERS) {
      throw new Error(
        "Citation Health draft excerpt exceeds the safety limit.",
      );
    }
    const sourceCharacters = requireInteger(
      draft.sourceCharacters,
      "Citation Health draft sourceCharacters",
      100_000_000,
    );
    const analyzedCharacters = requireInteger(
      draft.analyzedCharacters,
      "Citation Health draft analyzedCharacters",
      MAX_DRAFT_EXCERPT_CHARACTERS,
    );
    requireInteger(
      draft.statementCount,
      "Citation Health draft statementCount",
      MAX_DRAFT_STATEMENTS,
    );
    if (typeof draft.truncated !== "boolean") {
      throw new Error("Citation Health draft truncated must be boolean.");
    }
    if (analyzedCharacters > sourceCharacters) {
      throw new Error(
        "Citation Health draft analyzedCharacters cannot exceed sourceCharacters.",
      );
    }
  }
  const coverage = requireRecord(root.coverage, "Citation Health coverage");
  for (const key of [
    "eligibleArtifacts",
    "admittedArtifacts",
    "excludedArtifacts",
    "citationContexts",
    "citationStances",
    "localLibraries",
    "localLibraryItems",
    "localMetadataSignals",
    "methodologyArtifacts",
    "reproducibilityArtifacts",
    "draftStatements",
    "unsupportedDraftCandidates",
  ]) {
    requireInteger(
      coverage[key],
      `Citation Health coverage ${key}`,
      10_000_000,
    );
  }
  const external = requireRecord(
    coverage.externalProvider,
    "Citation Health external provider coverage",
  );
  if (
    typeof external.status !== "string" ||
    !new Set(["not-configured", "provided"]).has(external.status)
  ) {
    throw new Error("Citation Health external provider status is unsupported.");
  }
  requireInteger(
    external.identifiersChecked,
    "Citation Health external identifiersChecked",
    10_000_000,
  );
  requireInteger(
    external.identifiersCovered,
    "Citation Health external identifiersCovered",
    10_000_000,
  );
  requireInteger(
    external.signals,
    "Citation Health external signals",
    10_000_000,
  );
  if (
    !Array.isArray(external.limitations) ||
    external.limitations.length > 100
  ) {
    throw new Error("Citation Health external limitations must be bounded.");
  }
  for (const entry of external.limitations) {
    requireText(entry, "Citation Health external limitation", 2_000);
  }
  if (!Array.isArray(root.limitations) || root.limitations.length > 200) {
    throw new Error("Citation Health limitations must be a bounded array.");
  }
  for (const entry of root.limitations) {
    requireText(entry, "Citation Health limitation", 2_000);
  }
  return value as CitationHealthReport;
}
