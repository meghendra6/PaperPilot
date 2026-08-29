import type { EvidenceReferenceV2 } from "./evidenceVerification";
import type {
  ResearchWorkspaceArtifact,
  ResearchWorkspaceSourceRecord,
} from "./persistence/contracts";
import type { ResearchWorkspaceProjectDetails } from "./projectController";

export const CONTRADICTION_GAP_DASHBOARD_VERSION =
  "contradiction-gap-dashboard-v1" as const;

type UnknownRecord = Record<string, unknown>;

export type ContradictionGapDimension =
  | "claim"
  | "method"
  | "population"
  | "dataset"
  | "replication"
  | "outcome"
  | "metric"
  | "limitation";

export interface VerifiedFactAtom {
  atomID: string;
  sourceArtifactID: string;
  sourcePath: string;
  sourceID: string;
  statement: string;
  dimension: ContradictionGapDimension;
  evidence: EvidenceReferenceV2[];
}

export type ContradictionClassification =
  | "direct-contradiction"
  | "non-comparable"
  | "uncertain";

export interface ContradictionRelationship {
  relationshipID: string;
  topic: string;
  classification: ContradictionClassification;
  sides: Array<{
    position: string;
    atomIDs: string[];
    sourceIDs: string[];
  }>;
  comparability: {
    status:
      | "comparable"
      | "partially-comparable"
      | "not-comparable"
      | "unknown";
    differences: Array<{
      dimension: "population" | "method" | "dataset" | "outcome" | "metric";
      explanation: string;
      atomIDs: string[];
    }>;
  };
  limitations: string[];
  origin: "deterministic";
  reviewState: "unreviewed" | "confirmed" | "reclassified" | "dismissed";
  userClassification?: ContradictionClassification;
}

export interface EvidenceGap {
  gapID: string;
  kind:
    | "single-source"
    | "missing-verified-evidence"
    | "missing-reporting"
    | "unresolved-comparability";
  statement: string;
  atomIDs: string[];
  sourceIDs: string[];
  basis: "deterministic";
  scopeLabel: "current-project-snapshot";
  nextSearchQuestion?: string;
}

export interface ContradictionGapReviewEvent {
  eventID: string;
  submissionID: string;
  relationshipID: string;
  action: "confirm" | "reclassify" | "dismiss";
  fromClassification: ContradictionClassification;
  toClassification?: ContradictionClassification;
  reason?: string;
  actor: "local-user";
  reviewedAt: string;
}

export interface ContradictionGapDashboard {
  schemaVersion: 1;
  kind: "research-workspace-contradiction-gap-dashboard";
  version: typeof CONTRADICTION_GAP_DASHBOARD_VERSION;
  revision: number;
  projectID: string;
  generatedAt: string;
  scope: {
    membersRevision: number;
    includedSourceIDs: string[];
    excludedSources: Array<{ sourceID: string; reason: string }>;
  };
  inputArtifacts: Array<{
    artifactID: string;
    artifactType: ResearchWorkspaceArtifact["type"];
    version: number;
    updatedAt: string;
    payloadFingerprint: string;
    sourceIDs: string[];
  }>;
  atoms: VerifiedFactAtom[];
  supportGroups: Array<{
    groupID: string;
    statement: string;
    atomIDs: string[];
    sourceIDs: string[];
  }>;
  relationships: ContradictionRelationship[];
  gaps: EvidenceGap[];
  nextSearchQuestions: string[];
  reviewEvents: ContradictionGapReviewEvent[];
  coverage: {
    includedSources: number;
    eligibleArtifacts: number;
    admittedArtifacts: number;
    excludedArtifacts: number;
    verifiedFactAtoms: number;
    multiSourceSupport: number;
    directContradictions: number;
    nonComparable: number;
    uncertain: number;
    gaps: number;
  };
  limitations: string[];
}

export interface ReviewContradictionGapInput {
  relationshipID: string;
  action: "confirm" | "reclassify" | "dismiss";
  toClassification?: ContradictionClassification;
  reason?: string;
  submissionID: string;
  expectedDashboardRevision: number;
}

const ELIGIBLE_ARTIFACT_TYPES = new Set<ResearchWorkspaceArtifact["type"]>([
  "claim-ledger",
  "evidence-matrix",
  "synthesis",
  "methodology-audit",
  "reproducibility",
]);

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
  const object = record(value);
  if (!object) return value;
  return Object.fromEntries(
    Object.keys(object)
      .sort()
      .map((key) => [key, canonicalValue(object[key])]),
  );
}

export function researchWorkspaceArtifactPayloadFingerprint(value: unknown) {
  const serialized = JSON.stringify(canonicalValue(value));
  return `artifact-payload-${stableHash(serialized)}-${serialized.length.toString(16)}`;
}

function normalizedStatement(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function dimensionFromText(value: string): ContradictionGapDimension {
  const normalized = value.toLocaleLowerCase();
  if (/population|participant|cohort|sample/.test(normalized))
    return "population";
  if (/method|design|protocol|procedure|intervention/.test(normalized))
    return "method";
  if (/dataset|corpus|benchmark|data source/.test(normalized)) return "dataset";
  if (/replicat|reproduc/.test(normalized)) return "replication";
  if (/outcome|result|effect|performance|accuracy|mortality/.test(normalized))
    return "outcome";
  if (/metric|measure|score|rate|ratio/.test(normalized)) return "metric";
  if (/limit|bias|risk|caveat/.test(normalized)) return "limitation";
  return "claim";
}

function validVerifiedEvidence(
  value: unknown,
  sourceByID: ReadonlyMap<string, ResearchWorkspaceSourceRecord>,
  allowedSourceIDs: ReadonlySet<string>,
  expectedSourceID?: string,
) {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: EvidenceReferenceV2[] = [];
  for (const candidate of value.slice(0, 200)) {
    const reference = record(candidate);
    const verification = record(reference?.verification);
    const sourceID = cleanText(reference?.sourceID, 512);
    const source = sourceByID.get(sourceID);
    if (
      !reference ||
      verification?.status !== "verified" ||
      !source ||
      !allowedSourceIDs.has(sourceID) ||
      (expectedSourceID && sourceID !== expectedSourceID) ||
      Number(reference.libraryID) !== source.identity.libraryID ||
      reference.attachmentKey !== source.identity.attachmentKey
    ) {
      continue;
    }
    const key = [
      sourceID,
      reference.attachmentKey,
      String(reference.pageIndex ?? ""),
      cleanText(reference.exactQuote),
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(candidate as EvidenceReferenceV2);
  }
  return result;
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
    const input = artifact.lineage.inputs.find(
      (candidate) => candidate.sourceID === sourceID,
    );
    if (!source || !input) return "missing-source-lineage";
    if (source.availability !== "ready") {
      return `source-${source.availability}`;
    }
    if (input.contentFingerprint !== sourceFingerprint(source)) {
      return "source-fingerprint-mismatch";
    }
  }
  return undefined;
}

interface AtomCollector {
  atoms: VerifiedFactAtom[];
  byID: Set<string>;
  sourceByID: ReadonlyMap<string, ResearchWorkspaceSourceRecord>;
  includedSourceIDs: ReadonlySet<string>;
}

function addAtoms(params: {
  collector: AtomCollector;
  artifact: ResearchWorkspaceArtifact;
  sourcePath: string;
  statement: string;
  dimension: ContradictionGapDimension;
  evidence: unknown;
  expectedSourceID?: string;
}) {
  const statement = cleanText(params.statement);
  if (!statement) return [];
  const artifactSourceIDs = new Set(
    params.artifact.sourceIDs.filter((sourceID) =>
      params.collector.includedSourceIDs.has(sourceID),
    ),
  );
  const references = validVerifiedEvidence(
    params.evidence,
    params.collector.sourceByID,
    artifactSourceIDs,
    params.expectedSourceID,
  );
  const referencesBySource = new Map<string, EvidenceReferenceV2[]>();
  for (const reference of references) {
    const group = referencesBySource.get(reference.sourceID) ?? [];
    group.push(reference);
    referencesBySource.set(reference.sourceID, group);
  }
  const created: VerifiedFactAtom[] = [];
  for (const [sourceID, evidence] of [...referencesBySource.entries()].sort(
    ([left], [right]) => left.localeCompare(right),
  )) {
    const atomID = `fact-${stableHash(
      [
        params.artifact.artifactID,
        params.sourcePath,
        sourceID,
        params.dimension,
        normalizedStatement(statement),
      ].join("|"),
    )}`;
    if (params.collector.byID.has(atomID)) continue;
    params.collector.byID.add(atomID);
    const atom = {
      atomID,
      sourceArtifactID: params.artifact.artifactID,
      sourcePath: params.sourcePath,
      sourceID,
      statement,
      dimension: params.dimension,
      evidence,
    } satisfies VerifiedFactAtom;
    params.collector.atoms.push(atom);
    created.push(atom);
  }
  return created;
}

function arrayRecords(value: unknown) {
  return Array.isArray(value)
    ? value
        .map(record)
        .filter((entry): entry is UnknownRecord => Boolean(entry))
    : [];
}

function collectClaimLedger(
  artifact: ResearchWorkspaceArtifact,
  collector: AtomCollector,
  gaps: EvidenceGap[],
) {
  const payload = record(artifact.payload) ?? {};
  const ledger = record(payload.ledger) ?? payload;
  for (const [index, claim] of arrayRecords(ledger.claims).entries()) {
    const statement = cleanText(claim.text ?? claim.statement);
    const dimension = claim.kind === "empirical_result" ? "outcome" : "claim";
    const supported = addAtoms({
      collector,
      artifact,
      sourcePath: `claims[${index}].support`,
      statement,
      dimension,
      evidence: claim.support,
    });
    if (statement && !supported.length) {
      gaps.push(
        createGap({
          kind: "missing-verified-evidence",
          statement: `The current claim ledger contains “${statement}” without a locally verified evidence locator.`,
          sourceIDs: [...artifact.sourceIDs],
        }),
      );
    }
    addAtoms({
      collector,
      artifact,
      sourcePath: `claims[${index}].contradictions`,
      statement: statement ? `Contrary evidence for: ${statement}` : "",
      dimension,
      evidence: claim.contradictions,
    });
  }
}

interface MatrixObservation {
  columnID: string;
  sourceID: string;
  atom?: VerifiedFactAtom;
  rawValue: unknown;
  statement: string;
  dimension: ContradictionGapDimension;
  status: string;
}

function collectMatrix(
  artifact: ResearchWorkspaceArtifact,
  collector: AtomCollector,
  gaps: EvidenceGap[],
) {
  const payload = record(artifact.payload) ?? {};
  const matrix = record(payload.matrix) ?? payload;
  const columns = new Map(
    arrayRecords(matrix.columns).map((column) => {
      const id = cleanText(column.id, 256);
      return [id, cleanText(column.label ?? column.title ?? id, 512)] as const;
    }),
  );
  const observations: MatrixObservation[] = [];
  for (const [index, cell] of arrayRecords(matrix.cells).entries()) {
    const sourceID = cleanText(cell.paperKey ?? cell.sourceID, 512);
    const columnID = cleanText(cell.columnId ?? cell.columnID, 256);
    if (!collector.includedSourceIDs.has(sourceID) || !columnID) continue;
    const columnLabel = columns.get(columnID) ?? columnID;
    const dimension = dimensionFromText(`${columnID} ${columnLabel}`);
    const statement = cleanText(
      cell.displayValue ??
        (typeof cell.value === "string" || typeof cell.value === "number"
          ? cell.value
          : ""),
    );
    const status = cleanText(cell.status, 64) || "unknown";
    const created = addAtoms({
      collector,
      artifact,
      sourcePath: `matrix.cells[${index}]`,
      statement: statement ? `${columnLabel}: ${statement}` : "",
      dimension,
      evidence: cell.evidence,
      expectedSourceID: sourceID,
    });
    observations.push({
      columnID,
      sourceID,
      atom: created[0],
      rawValue: cell.value,
      statement,
      dimension,
      status,
    });
    if (status === "not_reported") {
      gaps.push(
        createGap({
          kind: "missing-reporting",
          statement: `${columnLabel} was not reported for ${
            collector.sourceByID.get(sourceID)?.title ?? sourceID
          } in the current matrix.`,
          sourceIDs: [sourceID],
        }),
      );
    } else if (statement && !created.length) {
      gaps.push(
        createGap({
          kind: "missing-verified-evidence",
          statement: `${columnLabel} has a value for ${
            collector.sourceByID.get(sourceID)?.title ?? sourceID
          }, but no locally verified evidence locator.`,
          sourceIDs: [sourceID],
        }),
      );
    }
  }
  return observations;
}

function collectSynthesis(
  artifact: ResearchWorkspaceArtifact,
  collector: AtomCollector,
  relationships: ContradictionRelationship[],
  gaps: EvidenceGap[],
) {
  const payload = record(artifact.payload) ?? {};
  for (const field of ["claims", "agreements", "contradictions"] as const) {
    for (const [index, entry] of arrayRecords(payload[field]).entries()) {
      const statement = cleanText(entry.statement ?? entry.claim);
      const atoms = addAtoms({
        collector,
        artifact,
        sourcePath: `${field}[${index}]`,
        statement,
        dimension: "claim",
        evidence: entry.evidence,
      });
      if (statement && !atoms.length) {
        gaps.push(
          createGap({
            kind: "missing-verified-evidence",
            statement: `The current synthesis contains “${statement}” without a locally verified evidence locator.`,
            sourceIDs: [...artifact.sourceIDs],
          }),
        );
      }
      if (field !== "contradictions" || atoms.length < 2) continue;
      relationships.push({
        relationshipID: `relationship-${stableHash(
          `${artifact.artifactID}|${field}|${index}|${normalizedStatement(statement)}`,
        )}`,
        topic: statement,
        classification: "uncertain",
        sides: atoms.map((atom) => ({
          position: `Evidence from ${
            collector.sourceByID.get(atom.sourceID)?.title ?? atom.sourceID
          }`,
          atomIDs: [atom.atomID],
          sourceIDs: [atom.sourceID],
        })),
        comparability: { status: "unknown", differences: [] },
        limitations: [
          "The upstream synthesis labels a contrast, but comparable design and opposite outcome direction are not established by the stored verified facts.",
        ],
        origin: "deterministic",
        reviewState: "unreviewed",
      });
    }
  }
}

function collectGenericEvidence(
  artifact: ResearchWorkspaceArtifact,
  collector: AtomCollector,
) {
  let visited = 0;
  const walk = (value: unknown, path: string, depth: number) => {
    if (depth > 8 || visited > 1_500) return;
    visited += 1;
    if (Array.isArray(value)) {
      value
        .slice(0, 200)
        .forEach((entry, index) => walk(entry, `${path}[${index}]`, depth + 1));
      return;
    }
    const object = record(value);
    if (!object) return;
    const statement = cleanText(
      object.statement ??
        object.finding ??
        object.description ??
        object.summary ??
        object.text,
    );
    if (statement && Array.isArray(object.evidence)) {
      addAtoms({
        collector,
        artifact,
        sourcePath: path,
        statement,
        dimension: dimensionFromText(path),
        evidence: object.evidence,
      });
    }
    for (const key of Object.keys(object).sort()) {
      if (key === "evidence") continue;
      walk(object[key], path ? `${path}.${key}` : key, depth + 1);
    }
  };
  walk(artifact.payload, "payload", 0);
}

function direction(
  value: unknown,
): "positive" | "negative" | "neutral" | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 0 ? "positive" : value < 0 ? "negative" : "neutral";
  }
  const text = cleanText(value).toLocaleLowerCase();
  if (!text) return undefined;
  if (/\b(increas|improv|higher|positive|gain|outperform|benefit)/.test(text))
    return "positive";
  if (/\b(decreas|wors|lower|negative|declin|harm|underperform)/.test(text))
    return "negative";
  if (/\b(no (?:effect|difference|change)|neutral|unchanged)\b/.test(text))
    return "neutral";
  return undefined;
}

function comparisonForSources(
  leftSourceID: string,
  rightSourceID: string,
  observations: readonly MatrixObservation[],
) {
  const differences: ContradictionRelationship["comparability"]["differences"] =
    [];
  let matched = 0;
  for (const dimension of ["method", "population", "dataset"] as const) {
    const forSource = (sourceID: string) =>
      [
        ...new Map(
          observations
            .filter(
              (entry) =>
                entry.sourceID === sourceID &&
                entry.dimension === dimension &&
                entry.atom,
            )
            .map((entry) => [normalizedStatement(entry.statement), entry]),
        ).values(),
      ].sort((left, right) => left.statement.localeCompare(right.statement));
    const leftValues = forSource(leftSourceID);
    const rightValues = forSource(rightSourceID);
    if (leftValues.length !== 1 || rightValues.length !== 1) continue;
    const left = leftValues[0];
    const right = rightValues[0];
    if (
      normalizedStatement(left.statement) ===
      normalizedStatement(right.statement)
    ) {
      matched += 1;
    } else {
      differences.push({
        dimension,
        explanation: `${left.statement} differs from ${right.statement}.`,
        atomIDs: [left.atom!.atomID, right.atom!.atomID].sort(),
      });
    }
  }
  if (differences.length) {
    return { status: "not-comparable" as const, differences };
  }
  if (matched >= 2) return { status: "comparable" as const, differences };
  if (matched === 1)
    return { status: "partially-comparable" as const, differences };
  return { status: "unknown" as const, differences };
}

function matrixRelationships(
  observations: readonly MatrixObservation[],
): ContradictionRelationship[] {
  const byColumn = new Map<string, MatrixObservation[]>();
  for (const observation of observations) {
    if (
      !observation.atom ||
      (observation.dimension !== "outcome" &&
        observation.dimension !== "metric")
    ) {
      continue;
    }
    const entries = byColumn.get(observation.columnID) ?? [];
    entries.push(observation);
    byColumn.set(observation.columnID, entries);
  }
  const result: ContradictionRelationship[] = [];
  for (const [columnID, entries] of [...byColumn.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const bySource = new Map<string, MatrixObservation[]>();
    for (const entry of entries) {
      const group = bySource.get(entry.sourceID) ?? [];
      group.push(entry);
      bySource.set(entry.sourceID, group);
    }
    const ordered = [...bySource.entries()]
      .map(([sourceID, sourceEntries]) => {
        const directions = new Set(
          sourceEntries
            .map((entry) => direction(entry.rawValue ?? entry.statement))
            .filter((entry): entry is "positive" | "negative" | "neutral" =>
              Boolean(entry),
            ),
        );
        if (directions.size !== 1) return undefined;
        const candidate = [...sourceEntries].sort((left, right) =>
          left.atom!.atomID.localeCompare(right.atom!.atomID),
        )[0];
        return { ...candidate, sourceID };
      })
      .filter((entry): entry is MatrixObservation => Boolean(entry))
      .sort((left, right) => left.sourceID.localeCompare(right.sourceID));
    for (let leftIndex = 0; leftIndex < ordered.length; leftIndex += 1) {
      for (
        let rightIndex = leftIndex + 1;
        rightIndex < ordered.length;
        rightIndex += 1
      ) {
        const left = ordered[leftIndex];
        const right = ordered[rightIndex];
        const leftDirection = direction(left.rawValue ?? left.statement);
        const rightDirection = direction(right.rawValue ?? right.statement);
        if (
          !leftDirection ||
          !rightDirection ||
          leftDirection === rightDirection ||
          leftDirection === "neutral" ||
          rightDirection === "neutral"
        ) {
          continue;
        }
        const comparability = comparisonForSources(
          left.sourceID,
          right.sourceID,
          observations,
        );
        const classification: ContradictionClassification =
          comparability.status === "comparable"
            ? "direct-contradiction"
            : comparability.status === "not-comparable"
              ? "non-comparable"
              : "uncertain";
        result.push({
          relationshipID: `relationship-${stableHash(
            [columnID, left.sourceID, right.sourceID].join("|"),
          )}`,
          topic: `${columnID}: opposite reported directions`,
          classification,
          sides: [left, right].map((entry) => ({
            position: entry.statement,
            atomIDs: [entry.atom!.atomID],
            sourceIDs: [entry.sourceID],
          })),
          comparability,
          limitations:
            classification === "direct-contradiction"
              ? [
                  "Direct contrast is limited to verified matrix facts with opposite direction and at least two matching design dimensions.",
                ]
              : [
                  "Opposite direction alone is not enough to establish a direct contradiction.",
                ],
          origin: "deterministic",
          reviewState: "unreviewed",
        });
      }
    }
  }
  return result;
}

function createGap(params: {
  kind: EvidenceGap["kind"];
  statement: string;
  atomIDs?: string[];
  sourceIDs: string[];
}): EvidenceGap {
  const statement = cleanText(params.statement);
  const sourceIDs = [...new Set(params.sourceIDs)].sort();
  const atomIDs = [...new Set(params.atomIDs ?? [])].sort();
  return {
    gapID: `gap-${stableHash(
      [
        params.kind,
        normalizedStatement(statement),
        ...sourceIDs,
        ...atomIDs,
      ].join("|"),
    )}`,
    kind: params.kind,
    statement,
    atomIDs,
    sourceIDs,
    basis: "deterministic",
    scopeLabel: "current-project-snapshot",
    nextSearchQuestion:
      params.kind === "single-source"
        ? `Which independent included source could confirm or challenge: ${statement}`
        : params.kind === "unresolved-comparability"
          ? `Which population, method, and dataset details are needed to compare: ${statement}`
          : `Can verified local evidence fill this current-project gap: ${statement}`,
  };
}

function uniqueByID<T extends { gapID: string }>(values: T[]) {
  return [...new Map(values.map((value) => [value.gapID, value])).values()];
}

export function buildContradictionGapDashboard(params: {
  details: ResearchWorkspaceProjectDetails;
  generatedAt: string;
}): ContradictionGapDashboard {
  const includedSourceIDs = params.details.members
    .filter((member) => member.reviewStatus !== "excluded")
    .map((member) => member.sourceID)
    .sort();
  const includedSet = new Set(includedSourceIDs);
  const sourceByID = new Map(
    params.details.sources.map((source) => [source.sourceID, source]),
  );
  const eligible = params.details.artifacts
    .filter((artifact) => ELIGIBLE_ARTIFACT_TYPES.has(artifact.type))
    .sort((left, right) => left.artifactID.localeCompare(right.artifactID));
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
    .map((entry) => entry.artifact)
    .sort((left, right) => left.artifactID.localeCompare(right.artifactID));

  const collector: AtomCollector = {
    atoms: [],
    byID: new Set(),
    sourceByID,
    includedSourceIDs: includedSet,
  };
  const relationships: ContradictionRelationship[] = [];
  const gaps: EvidenceGap[] = [];
  const observations: MatrixObservation[] = [];
  for (const artifact of admitted) {
    if (artifact.type === "claim-ledger") {
      collectClaimLedger(artifact, collector, gaps);
    } else if (artifact.type === "evidence-matrix") {
      observations.push(...collectMatrix(artifact, collector, gaps));
    } else if (artifact.type === "synthesis") {
      collectSynthesis(artifact, collector, relationships, gaps);
    } else {
      collectGenericEvidence(artifact, collector);
    }
  }
  collector.atoms.sort((left, right) =>
    left.atomID.localeCompare(right.atomID),
  );
  for (const sourceID of includedSourceIDs) {
    for (const dimension of [
      "population",
      "method",
      "dataset",
      "replication",
    ] as const) {
      if (
        observations.some(
          (entry) =>
            entry.sourceID === sourceID && entry.dimension === dimension,
        )
      ) {
        continue;
      }
      const label =
        dimension === "method" ? "method or experiment design" : dimension;
      gaps.push(
        createGap({
          kind: "missing-reporting",
          statement: `${label} was not assessed for ${
            sourceByID.get(sourceID)?.title ?? sourceID
          } in the current admitted artifacts.`,
          sourceIDs: [sourceID],
        }),
      );
    }
  }
  relationships.push(...matrixRelationships(observations));
  const relationshipByID = new Map<string, ContradictionRelationship>();
  for (const relationship of relationships) {
    if (!relationshipByID.has(relationship.relationshipID)) {
      relationshipByID.set(relationship.relationshipID, relationship);
    }
  }
  const orderedRelationships = [...relationshipByID.values()].sort(
    (left, right) => left.relationshipID.localeCompare(right.relationshipID),
  );

  const admittedByID = new Map(
    admitted.map((artifact) => [artifact.artifactID, artifact]),
  );
  const statementGroups = new Map<string, VerifiedFactAtom[]>();
  for (const atom of collector.atoms) {
    const origin = admittedByID.get(atom.sourceArtifactID)?.type;
    if (
      origin !== "claim-ledger" &&
      origin !== "synthesis" &&
      !(
        origin === "evidence-matrix" &&
        (atom.dimension === "outcome" || atom.dimension === "metric")
      )
    ) {
      continue;
    }
    const key = `${atom.dimension}|${normalizedStatement(atom.statement)}`;
    const group = statementGroups.get(key) ?? [];
    group.push(atom);
    statementGroups.set(key, group);
  }
  const supportGroups = [...statementGroups.entries()]
    .map(([key, atoms]) => ({
      key,
      atoms,
      sourceIDs: [...new Set(atoms.map((atom) => atom.sourceID))].sort(),
    }))
    .filter((entry) => entry.sourceIDs.length >= 2)
    .map((entry) => ({
      groupID: `support-${stableHash(entry.key)}`,
      statement: entry.atoms[0].statement,
      atomIDs: entry.atoms.map((atom) => atom.atomID).sort(),
      sourceIDs: entry.sourceIDs,
    }))
    .sort((left, right) => left.groupID.localeCompare(right.groupID));

  for (const entry of statementGroups.values()) {
    const sourceIDs = [...new Set(entry.map((atom) => atom.sourceID))].sort();
    if (sourceIDs.length !== 1) continue;
    gaps.push(
      createGap({
        kind: "single-source",
        statement: entry[0].statement,
        atomIDs: entry.map((atom) => atom.atomID),
        sourceIDs,
      }),
    );
  }
  for (const relationship of orderedRelationships) {
    if (relationship.classification !== "uncertain") continue;
    gaps.push(
      createGap({
        kind: "unresolved-comparability",
        statement: relationship.topic,
        atomIDs: relationship.sides.flatMap((side) => side.atomIDs),
        sourceIDs: relationship.sides.flatMap((side) => side.sourceIDs),
      }),
    );
  }
  const orderedGaps = uniqueByID(gaps)
    .sort((left, right) => left.gapID.localeCompare(right.gapID))
    .slice(0, 200);
  const inputArtifacts = admitted.map((artifact) => ({
    artifactID: artifact.artifactID,
    artifactType: artifact.type,
    version: artifact.version,
    updatedAt: artifact.updatedAt,
    payloadFingerprint: researchWorkspaceArtifactPayloadFingerprint(
      artifact.payload,
    ),
    sourceIDs: [...artifact.sourceIDs].sort(),
  }));
  const excludedSources = params.details.members
    .filter((member) => member.reviewStatus === "excluded")
    .map((member) => ({
      sourceID: member.sourceID,
      reason: `review-status-${member.reviewStatus}`,
    }))
    .sort((left, right) => left.sourceID.localeCompare(right.sourceID));
  const directContradictions = orderedRelationships.filter(
    (entry) => entry.classification === "direct-contradiction",
  ).length;
  const nonComparable = orderedRelationships.filter(
    (entry) => entry.classification === "non-comparable",
  ).length;
  const uncertain = orderedRelationships.filter(
    (entry) => entry.classification === "uncertain",
  ).length;
  return {
    schemaVersion: 1,
    kind: "research-workspace-contradiction-gap-dashboard",
    version: CONTRADICTION_GAP_DASHBOARD_VERSION,
    revision: 0,
    projectID: params.details.project.projectID,
    generatedAt: params.generatedAt,
    scope: {
      membersRevision: params.details.membersRevision,
      includedSourceIDs,
      excludedSources,
    },
    inputArtifacts,
    atoms: collector.atoms,
    supportGroups,
    relationships: orderedRelationships,
    gaps: orderedGaps,
    nextSearchQuestions: [
      ...new Set(
        orderedGaps
          .map((gap) => gap.nextSearchQuestion)
          .filter((question): question is string => Boolean(question)),
      ),
    ].slice(0, 20),
    reviewEvents: [],
    coverage: {
      includedSources: includedSourceIDs.length,
      eligibleArtifacts: eligible.length,
      admittedArtifacts: admitted.length,
      excludedArtifacts: admission.filter((entry) => entry.reason).length,
      verifiedFactAtoms: collector.atoms.length,
      multiSourceSupport: supportGroups.length,
      directContradictions,
      nonComparable,
      uncertain,
      gaps: orderedGaps.length,
    },
    limitations: [
      "This dashboard describes only the currently included project sources and current, complete artifacts; it does not establish absence in the wider literature.",
      "Only evidence references with local verification status verified and exact project source identity are admitted as fact atoms.",
      "An opposite result is called a direct contradiction only when different sources have verified evidence and at least two stored design dimensions match exactly.",
      ...admission
        .filter((entry) => entry.reason)
        .slice(0, 20)
        .map(
          (entry) =>
            `${entry.artifact.title} was excluded: ${entry.reason!.replace(/-/g, " ")}.`,
        ),
    ],
  };
}

function reviewMatches(
  event: ContradictionGapReviewEvent,
  input: ReviewContradictionGapInput,
) {
  return (
    event.relationshipID === input.relationshipID &&
    event.action === input.action &&
    (event.toClassification ?? "") === (input.toClassification ?? "") &&
    cleanText(event.reason) === cleanText(input.reason)
  );
}

export function applyContradictionGapReview(params: {
  dashboard: ContradictionGapDashboard;
  input: ReviewContradictionGapInput;
  eventID: string;
  reviewedAt: string;
}) {
  const replay = params.dashboard.reviewEvents.find(
    (event) => event.submissionID === params.input.submissionID,
  );
  if (replay) {
    if (!reviewMatches(replay, params.input)) {
      throw new Error(
        "Dashboard review idempotency conflict: the submission ID has different input.",
      );
    }
    return params.dashboard;
  }
  if (params.dashboard.revision !== params.input.expectedDashboardRevision) {
    throw new Error(
      `Dashboard revision conflict: expected ${params.input.expectedDashboardRevision}, found ${params.dashboard.revision}.`,
    );
  }
  const relationship = params.dashboard.relationships.find(
    (entry) => entry.relationshipID === params.input.relationshipID,
  );
  if (!relationship) throw new Error("Unknown dashboard relationship.");
  const reason = cleanText(params.input.reason, 800);
  if (
    params.input.action === "reclassify" &&
    (!params.input.toClassification || !reason)
  ) {
    throw new Error("Reclassification requires a classification and reason.");
  }
  if (params.input.action === "dismiss" && !reason) {
    throw new Error("Dismissing a relationship requires a reason.");
  }
  const event: ContradictionGapReviewEvent = {
    eventID: params.eventID,
    submissionID: params.input.submissionID,
    relationshipID: params.input.relationshipID,
    action: params.input.action,
    fromClassification:
      relationship.userClassification ?? relationship.classification,
    ...(params.input.toClassification
      ? { toClassification: params.input.toClassification }
      : {}),
    ...(reason ? { reason } : {}),
    actor: "local-user",
    reviewedAt: params.reviewedAt,
  };
  return {
    ...params.dashboard,
    revision: params.dashboard.revision + 1,
    relationships: params.dashboard.relationships.map((entry) =>
      entry.relationshipID !== relationship.relationshipID
        ? entry
        : {
            ...entry,
            reviewState:
              params.input.action === "confirm"
                ? ("confirmed" as const)
                : params.input.action === "dismiss"
                  ? ("dismissed" as const)
                  : ("reclassified" as const),
            ...(params.input.action === "reclassify"
              ? { userClassification: params.input.toClassification }
              : {}),
          },
    ),
    reviewEvents: [...params.dashboard.reviewEvents, event],
  };
}
