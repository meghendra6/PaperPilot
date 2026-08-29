import { formatEvidenceLocator } from "./core/evidence/types";
import type {
  ResearchWorkspaceArtifactType,
  ResearchWorkspaceArtifact,
} from "./persistence/contracts";

const HTML_NS = "http://www.w3.org/1999/xhtml";

type UnknownRecord = Record<string, unknown>;

export interface ResearchWorkspaceEvidenceView {
  reference: UnknownRecord;
  locator: string;
  status: string;
}

export interface ResearchWorkspaceMatrixCellView {
  columnID: string;
  value: string;
  status: string;
  confidence?: number;
  evidence: ResearchWorkspaceEvidenceView[];
}

export interface ResearchWorkspaceMatrixView {
  kind: "matrix";
  columns: Array<{ id: string; label: string }>;
  rows: Array<{
    sourceID: string;
    title: string;
    cells: ResearchWorkspaceMatrixCellView[];
  }>;
  coverage?: {
    extraction?: number;
    evidence?: number;
    requiredEvidence?: number;
  };
}

export interface ResearchWorkspaceGraphView {
  kind: "graph";
  nodeCount: number;
  edgeCount: number;
  verifiedEdgeCount: number;
  inferredEdgeCount: number;
  edges: Array<{
    id: string;
    source: string;
    target: string;
    relationship: string;
    provenance: string;
    confidence?: number;
    evidence: ResearchWorkspaceEvidenceView[];
  }>;
}

export interface ResearchWorkspaceSynthesisView {
  kind: "synthesis";
  answer: string;
  groups: Array<{
    title: string;
    entries: Array<{
      statement: string;
      support: string;
      sourceIDs: string[];
      uncertainty?: string;
      evidence: ResearchWorkspaceEvidenceView[];
    }>;
  }>;
  unresolvedUncertainty: string[];
  freshnessWarnings: string[];
  coverage?: {
    analyzedSources?: number;
    totalProjectSources?: number;
    excludedSources?: number;
    insufficient?: boolean;
  };
}

export interface ResearchWorkspaceMasteryView {
  kind: "mastery";
  state: string;
  revision?: number;
  sourceCount: number;
  currentQuestion?: {
    prompt: string;
    mode: string;
    difficulty: string;
    sourceCount: number;
  };
  attempts: Array<{
    question: string;
    answer: string;
    learnerConfidence?: number;
    graderConfidence?: number;
    score?: number;
    maxScore?: number;
    grades: Array<{
      criterion: string;
      score?: number;
      maxScore?: number;
      feedback: string;
      evidence: ResearchWorkspaceEvidenceView[];
    }>;
    misconceptions: string[];
  }>;
  summary: {
    answerQuality?: number;
    calibration?: number;
    conceptCoverage?: number;
    questionCoverage?: number;
    nextReviewAt?: string;
    openMisconceptions: string[];
  };
}

export interface ResearchWorkspaceCitationView {
  kind: "citation";
  rows: Array<{
    contextID: string;
    exactSentence: string;
    localContext: string;
    marker: string;
    pageIndex?: number;
    reference: string;
    resolvedTitle?: string;
    resolutionStatus: string;
    resolutionMethod: string;
    stance: string;
    modelStance?: string;
    confidence?: number;
    rationale?: string;
    limitations: string[];
    corrected: boolean;
    evidence: ResearchWorkspaceEvidenceView[];
  }>;
  coverage: {
    sources?: number;
    detected?: number;
    resolved?: number;
    ambiguous?: number;
    unresolved?: number;
    pageLocated?: number;
    submitted?: number;
    analyzed?: number;
    truncated?: number;
    analysisCoverage?: number;
    limitations: string[];
  };
  correctionCount: number;
}

export interface ResearchWorkspaceReviewLogView {
  kind: "review-log";
  rows: Array<{
    sourceID: string;
    title: string;
    decision: string;
    stage: string;
    reason: string;
    decidedAt: string;
    legacy: boolean;
    issues: string[];
    historyCount: number;
  }>;
  summary: {
    total?: number;
    unreviewed?: number;
    include?: number;
    exclude?: number;
    maybe?: number;
    decisions?: number;
    duplicateSignals?: number;
    missingPDFSignals?: number;
  };
  limitations: string[];
}

export interface ResearchWorkspaceContradictionGapView {
  kind: "contradiction-gap";
  coverage: {
    includedSources: number;
    admittedArtifacts: number;
    verifiedFactAtoms: number;
    multiSourceSupport: number;
    directContradictions: number;
    nonComparable: number;
    uncertain: number;
    gaps: number;
  };
  supportGroups: Array<{
    statement: string;
    sourceIDs: string[];
    evidence: ResearchWorkspaceEvidenceView[];
  }>;
  relationships: Array<{
    relationshipID: string;
    topic: string;
    deterministicClassification: string;
    effectiveClassification: string;
    reviewState: string;
    comparability: string;
    sides: string[];
    limitations: string[];
    evidence: ResearchWorkspaceEvidenceView[];
  }>;
  gaps: Array<{
    kind: string;
    statement: string;
    sourceIDs: string[];
    nextSearchQuestion?: string;
  }>;
  nextSearchQuestions: string[];
  limitations: string[];
}

export interface ResearchWorkspaceGenericView {
  kind: "generic";
  value: unknown;
}

export type ResearchWorkspaceArtifactView =
  | ResearchWorkspaceMatrixView
  | ResearchWorkspaceGraphView
  | ResearchWorkspaceSynthesisView
  | ResearchWorkspaceMasteryView
  | ResearchWorkspaceCitationView
  | ResearchWorkspaceReviewLogView
  | ResearchWorkspaceContradictionGapView
  | ResearchWorkspaceGenericView;

export interface ResearchWorkspaceArtifactRendererOptions {
  artifactType?: ResearchWorkspaceArtifactType;
  onOpenEvidence?: (reference: UnknownRecord) => void | Promise<void>;
}

function record(value: unknown): UnknownRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : undefined;
}

function finite(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function text(value: unknown, fallback = "—"): string {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value))
    return value.map((entry) => text(entry, "")).join("; ");
  if (typeof value === "object") return fallback;
  return String(value);
}

function humanize(value: string) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/^./, (character) => character.toUpperCase());
}

function isEvidence(value: unknown): value is UnknownRecord {
  const candidate = record(value);
  return Boolean(
    candidate &&
      typeof candidate.attachmentKey === "string" &&
      (candidate.pageIndex !== undefined ||
        candidate.pageLabel !== undefined ||
        candidate.sectionPath !== undefined ||
        candidate.quote !== undefined ||
        candidate.exactQuote !== undefined ||
        candidate.elementId !== undefined),
  );
}

function evidenceViews(value: unknown): ResearchWorkspaceEvidenceView[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isEvidence).map((reference) => ({
    reference,
    locator: formatEvidenceLocator(reference),
    status: text(record(reference.verification)?.status, "unverified"),
  }));
}

function stringList(value: unknown) {
  return Array.isArray(value)
    ? value
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter(Boolean)
    : [];
}

function masteryView(
  value: UnknownRecord,
): ResearchWorkspaceMasteryView | undefined {
  const session = record(value.session);
  if (!session || !Array.isArray(session.questions)) return undefined;
  const attempts = Array.isArray(session.attempts) ? session.attempts : [];
  const questions = session.questions
    .map((entry) => record(entry))
    .filter((entry): entry is UnknownRecord => Boolean(entry));
  const attemptedQuestionIDs = new Set(
    attempts
      .map((entry) => record(entry))
      .map((entry) => text(entry?.questionId, ""))
      .filter(Boolean),
  );
  const suppliedQuestion = record(value.question);
  const currentQuestion =
    suppliedQuestion ??
    [...questions]
      .reverse()
      .find((entry) => !attemptedQuestionIDs.has(text(entry.id, "")));
  const summary = record(value.summary) ?? {};
  return {
    kind: "mastery",
    state: text(session.state, currentQuestion ? "awaiting-answer" : "active"),
    revision: finite(session.revision),
    sourceCount: Array.isArray(session.sourceSnapshot)
      ? session.sourceSnapshot.length
      : Array.isArray(currentQuestion?.paperKeys)
        ? currentQuestion.paperKeys.length
        : 0,
    ...(currentQuestion
      ? {
          currentQuestion: {
            prompt: text(
              currentQuestion.prompt,
              "Compare the selected papers.",
            ),
            mode: text(currentQuestion.mode, "compare"),
            difficulty: text(currentQuestion.difficulty, "advanced"),
            sourceCount: Array.isArray(currentQuestion.paperKeys)
              ? currentQuestion.paperKeys.length
              : 0,
          },
        }
      : {}),
    attempts: attempts
      .map((entry) => record(entry))
      .filter((entry): entry is UnknownRecord => Boolean(entry))
      .map((attempt) => {
        const question = questions.find(
          (entry) => text(entry.id, "") === text(attempt.questionId, ""),
        );
        const grades = (Array.isArray(attempt.grades) ? attempt.grades : [])
          .map((entry) => record(entry))
          .filter((entry): entry is UnknownRecord => Boolean(entry));
        return {
          question: text(question?.prompt, "Previous mastery question"),
          answer: text(attempt.answer, "No answer retained"),
          learnerConfidence: finite(attempt.learnerConfidence),
          graderConfidence: finite(attempt.graderConfidence),
          score: grades.length
            ? grades.reduce((sum, grade) => sum + (finite(grade.score) ?? 0), 0)
            : undefined,
          maxScore: grades.length
            ? grades.reduce(
                (sum, grade) => sum + (finite(grade.maxScore) ?? 0),
                0,
              )
            : undefined,
          grades: grades.map((grade) => ({
            criterion: humanize(text(grade.criterionId, "criterion")),
            score: finite(grade.score),
            maxScore: finite(grade.maxScore),
            feedback: text(grade.feedback, "No criterion feedback"),
            evidence: evidenceViews(grade.evidence),
          })),
          misconceptions: stringList(attempt.misconceptions),
        };
      }),
    summary: {
      answerQuality: finite(summary.answerQuality),
      calibration: finite(summary.calibration),
      conceptCoverage: finite(summary.conceptCoverage),
      questionCoverage: finite(summary.questionCoverage),
      nextReviewAt:
        typeof summary.nextReviewAt === "string"
          ? summary.nextReviewAt
          : undefined,
      openMisconceptions: stringList(summary.openMisconceptions),
    },
  };
}

function citationView(
  value: UnknownRecord,
): ResearchWorkspaceCitationView | undefined {
  if (!Array.isArray(value.contexts)) return undefined;
  const results = new Map(
    (Array.isArray(value.results) ? value.results : [])
      .map((entry) => record(entry))
      .filter((entry): entry is UnknownRecord => Boolean(entry))
      .map((entry) => [text(entry.contextId, ""), entry]),
  );
  const rows = value.contexts
    .map((entry) => record(entry))
    .filter((entry): entry is UnknownRecord => Boolean(entry))
    .map((context) => {
      const result = results.get(text(context.id, ""));
      const resolution = record(context.resolution) ?? {};
      const reference = record(context.reference) ?? {};
      return {
        contextID: text(context.id, ""),
        exactSentence: text(
          context.exactSentence ?? context.context,
          "Citation sentence unavailable",
        ),
        localContext: text(context.context),
        marker: text(context.marker, "citation"),
        pageIndex: finite(context.pageIndex),
        reference: text(
          reference.raw ?? reference.title ?? context.citedPaperKey,
          "Unresolved reference",
        ),
        resolvedTitle:
          typeof resolution.title === "string" && resolution.title.trim()
            ? resolution.title.trim()
            : undefined,
        resolutionStatus: text(resolution.status, "unresolved"),
        resolutionMethod: text(resolution.method, "none"),
        stance: text(result?.stance, "not-analyzed"),
        modelStance:
          typeof result?.modelStance === "string"
            ? result.modelStance
            : undefined,
        confidence: finite(result?.confidence),
        rationale:
          typeof result?.rationale === "string" && result.rationale.trim()
            ? result.rationale.trim()
            : undefined,
        limitations: stringList(result?.limitations),
        corrected: result?.correctedBy === "user",
        evidence: evidenceViews(context.evidence),
      };
    });
  const coverage = record(value.coverage) ?? {};
  return {
    kind: "citation",
    rows,
    coverage: {
      sources: finite(coverage.sourcesAnalyzed),
      detected: finite(coverage.contextsExtracted ?? coverage.markersFound),
      resolved: finite(coverage.resolved),
      ambiguous: finite(coverage.ambiguous),
      unresolved: finite(coverage.unresolved),
      pageLocated: finite(coverage.pageLocated),
      submitted: finite(coverage.submittedToModel),
      analyzed: finite(coverage.analyzedContexts),
      truncated: finite(coverage.truncatedContexts),
      analysisCoverage: finite(coverage.analysisCoverage),
      limitations: stringList(coverage.limitations),
    },
    correctionCount: Array.isArray(value.corrections)
      ? value.corrections.length
      : 0,
  };
}

function reviewLogView(
  value: UnknownRecord,
): ResearchWorkspaceReviewLogView | undefined {
  if (
    value.kind !== "research-workspace-review-log" ||
    !Array.isArray(value.rows)
  ) {
    return undefined;
  }
  const summary = record(value.summary) ?? {};
  return {
    kind: "review-log",
    rows: value.rows
      .map((entry) => record(entry))
      .filter((entry): entry is UnknownRecord => Boolean(entry))
      .map((row) => {
        const current = record(row.current);
        const issues = (Array.isArray(row.issues) ? row.issues : [])
          .map((entry) => record(entry))
          .filter((entry): entry is UnknownRecord => Boolean(entry))
          .map((issue) => text(issue.kind, "review issue"));
        return {
          sourceID: text(row.sourceID, ""),
          title: text(row.title, row.sourceID ? String(row.sourceID) : "Paper"),
          decision: text(current?.decision ?? row.legacyDecision, "unreviewed"),
          stage: text(current?.stage, "not recorded"),
          reason: text(record(current?.reason)?.text, "—"),
          decidedAt: text(current?.decidedAt, "—"),
          legacy: !current && Boolean(row.legacyDecision),
          issues,
          historyCount: Array.isArray(row.history) ? row.history.length : 0,
        };
      }),
    summary: {
      total: finite(summary.total),
      unreviewed: finite(summary.unreviewed),
      include: finite(summary.include),
      exclude: finite(summary.exclude),
      maybe: finite(summary.maybe),
      decisions: finite(summary.decisions),
      duplicateSignals: finite(summary.duplicateSignals),
      missingPDFSignals: finite(summary.missingPDFSignals),
    },
    limitations: stringList(value.limitations),
  };
}

/**
 * Produces a user-facing projection without exposing an unanswered question's
 * hidden grading rubric. The full rubric remains in the private persisted
 * session so an interrupted attempt can still be resumed and graded.
 */
export function createResearchWorkspacePublicPayload(
  value: unknown,
  artifactType?: ResearchWorkspaceArtifactType,
): unknown {
  if (artifactType !== "cross-paper-mastery") return value;
  const root = record(value);
  const session = record(root?.session);
  if (!root || !session || !Array.isArray(session.questions)) return value;
  const attemptedQuestionIDs = new Set(
    (Array.isArray(session.attempts) ? session.attempts : [])
      .map((entry) => record(entry))
      .map((entry) => text(entry?.questionId, ""))
      .filter(Boolean),
  );
  const projectQuestion = (questionValue: unknown) => {
    const question = record(questionValue);
    if (!question) return questionValue;
    if (attemptedQuestionIDs.has(text(question.id, ""))) return questionValue;
    const {
      rubric: _rubric,
      criteria: _criteria,
      ...publicQuestion
    } = question;
    return publicQuestion;
  };
  return {
    ...root,
    ...(root.question ? { question: projectQuestion(root.question) } : {}),
    session: {
      ...session,
      questions: session.questions.map(projectQuestion),
    },
  };
}

function matrixView(
  value: UnknownRecord,
): ResearchWorkspaceMatrixView | undefined {
  const matrix = record(value.matrix) ?? value;
  if (!Array.isArray(matrix.columns) || !Array.isArray(matrix.rows)) {
    return undefined;
  }
  const columns = matrix.columns
    .map((entry) => record(entry))
    .filter((entry): entry is UnknownRecord => Boolean(entry))
    .map((entry) => ({
      id: text(entry.id, ""),
      label: text(entry.label ?? entry.id, "Column"),
    }))
    .filter((entry) => entry.id);
  if (!columns.length) return undefined;
  const rows = matrix.rows
    .map((entry) => record(entry))
    .filter((entry): entry is UnknownRecord => Boolean(entry))
    .map((entry) => ({
      sourceID: text(entry.paperKey ?? entry.sourceID, ""),
      title: text(entry.title, text(entry.paperKey, "Paper")),
      cells: (Array.isArray(entry.cells) ? entry.cells : [])
        .map((cell) => record(cell))
        .filter((cell): cell is UnknownRecord => Boolean(cell))
        .map((cell) => ({
          columnID: text(cell.columnId ?? cell.columnID, ""),
          value: text(cell.displayValue ?? cell.value),
          status: text(cell.status, "unknown"),
          confidence: finite(cell.confidence),
          evidence: evidenceViews(cell.evidence),
        })),
    }));
  const coverage = record(value.coverage);
  return {
    kind: "matrix",
    columns,
    rows,
    ...(coverage
      ? {
          coverage: {
            extraction: finite(
              coverage.extractionCoverage ?? coverage.coverage,
            ),
            evidence: finite(coverage.evidenceCoverage),
            requiredEvidence: finite(coverage.requiredEvidenceCoverage),
          },
        }
      : {}),
  };
}

function graphView(
  value: UnknownRecord,
): ResearchWorkspaceGraphView | undefined {
  if (!Array.isArray(value.nodes) || !Array.isArray(value.edges)) {
    return undefined;
  }
  const labels = new Map<string, string>();
  for (const candidate of value.nodes) {
    const node = record(candidate);
    if (!node) continue;
    labels.set(text(node.id, ""), text(node.label ?? node.id, "Unknown node"));
  }
  const edges = value.edges
    .map((entry) => record(entry))
    .filter((entry): entry is UnknownRecord => Boolean(entry))
    .map((entry) => ({
      id: text(entry.id, ""),
      source: labels.get(text(entry.source, "")) ?? text(entry.source),
      target: labels.get(text(entry.target, "")) ?? text(entry.target),
      relationship: text(entry.kind ?? entry.type, "related"),
      provenance: text(
        entry.provenance ??
          entry.verificationState ??
          (entry.verified === true ? "verified" : "inferred"),
        "inferred",
      ),
      confidence: finite(entry.confidence),
      evidence: evidenceViews(entry.evidence),
    }));
  const verifiedEdgeCount = edges.filter((edge) =>
    ["verified", "local-evidence", "bibliographic"].includes(edge.provenance),
  ).length;
  return {
    kind: "graph",
    nodeCount: labels.size,
    edgeCount: edges.length,
    verifiedEdgeCount,
    inferredEdgeCount: edges.length - verifiedEdgeCount,
    edges,
  };
}

function synthesisEntries(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => record(entry))
    .filter((entry): entry is UnknownRecord => Boolean(entry))
    .map((entry) => ({
      statement: text(entry.statement ?? entry.claim, "Unlabelled statement"),
      support: text(
        entry.support ??
          (entry.paperSupported === true ? "verified" : "inferred"),
        "inferred",
      ),
      sourceIDs: Array.isArray(entry.sourceIDs)
        ? entry.sourceIDs.map((sourceID) => text(sourceID, "")).filter(Boolean)
        : [],
      ...(typeof entry.uncertainty === "string" && entry.uncertainty.trim()
        ? { uncertainty: entry.uncertainty.trim() }
        : {}),
      evidence: evidenceViews(entry.evidence),
    }));
}

function synthesisView(
  value: UnknownRecord,
): ResearchWorkspaceSynthesisView | undefined {
  if (typeof value.answer !== "string" || !Array.isArray(value.claims)) {
    return undefined;
  }
  const coverage = record(value.coverage);
  const contextCoverage = record(coverage?.contextPlan);
  const excludedSources = Array.isArray(coverage?.excludedSources)
    ? coverage.excludedSources.length
    : undefined;
  return {
    kind: "synthesis",
    answer: value.answer.trim(),
    groups: [
      { title: "Claims", entries: synthesisEntries(value.claims) },
      { title: "Agreements", entries: synthesisEntries(value.agreements) },
      {
        title: "Contradictions",
        entries: synthesisEntries(value.contradictions),
      },
    ].filter((group) => group.entries.length),
    unresolvedUncertainty: Array.isArray(value.unresolvedUncertainty)
      ? value.unresolvedUncertainty
          .map((entry) => text(entry, ""))
          .filter(Boolean)
      : [],
    freshnessWarnings: Array.isArray(value.freshnessWarnings)
      ? value.freshnessWarnings.map((entry) => text(entry, "")).filter(Boolean)
      : [],
    ...(coverage
      ? {
          coverage: {
            analyzedSources: finite(coverage.analyzedSources),
            totalProjectSources: finite(coverage.totalProjectSources),
            excludedSources,
            insufficient:
              contextCoverage?.insufficientCoverage === true ||
              coverage.insufficientCoverage === true,
          },
        }
      : {}),
  };
}

function contradictionGapView(
  value: UnknownRecord,
): ResearchWorkspaceContradictionGapView | undefined {
  if (
    value.kind !== "research-workspace-contradiction-gap-dashboard" ||
    !Array.isArray(value.relationships) ||
    !Array.isArray(value.gaps)
  ) {
    return undefined;
  }
  const atoms = new Map<string, UnknownRecord>();
  if (Array.isArray(value.atoms)) {
    for (const candidate of value.atoms) {
      const atom = record(candidate);
      const atomID = text(atom?.atomID, "");
      if (atom && atomID) atoms.set(atomID, atom);
    }
  }
  const evidenceForAtomIDs = (atomIDs: unknown) => {
    if (!Array.isArray(atomIDs)) return [];
    const seen = new Set<string>();
    const evidence: ResearchWorkspaceEvidenceView[] = [];
    for (const atomID of atomIDs.map((entry) => text(entry, ""))) {
      for (const item of evidenceViews(atoms.get(atomID)?.evidence)) {
        const key = `${item.locator}|${text(item.reference.sourceID, "")}`;
        if (seen.has(key)) continue;
        seen.add(key);
        evidence.push(item);
      }
    }
    return evidence;
  };
  const coverage = record(value.coverage) ?? {};
  const supportGroups = Array.isArray(value.supportGroups)
    ? value.supportGroups
        .map((candidate) => record(candidate))
        .filter((candidate): candidate is UnknownRecord => Boolean(candidate))
        .map((group) => ({
          statement: text(group.statement, "Unlabelled support"),
          sourceIDs: Array.isArray(group.sourceIDs)
            ? group.sourceIDs.map((entry) => text(entry, "")).filter(Boolean)
            : [],
          evidence: evidenceForAtomIDs(group.atomIDs),
        }))
    : [];
  const relationships = value.relationships
    .map((candidate) => record(candidate))
    .filter((candidate): candidate is UnknownRecord => Boolean(candidate))
    .map((relationship) => {
      const comparability = record(relationship.comparability);
      const sides = Array.isArray(relationship.sides)
        ? relationship.sides
            .map((candidate) => record(candidate))
            .filter((candidate): candidate is UnknownRecord =>
              Boolean(candidate),
            )
        : [];
      const atomIDs = sides.flatMap((side) =>
        Array.isArray(side.atomIDs) ? side.atomIDs : [],
      );
      return {
        relationshipID: text(relationship.relationshipID, ""),
        topic: text(relationship.topic, "Unlabelled comparison"),
        deterministicClassification: text(
          relationship.classification,
          "uncertain",
        ),
        effectiveClassification: text(
          relationship.userClassification ?? relationship.classification,
          "uncertain",
        ),
        reviewState: text(relationship.reviewState, "unreviewed"),
        comparability: text(comparability?.status, "unknown"),
        sides: sides.map((side) => text(side.position, "Unlabelled side")),
        limitations: Array.isArray(relationship.limitations)
          ? relationship.limitations
              .map((entry) => text(entry, ""))
              .filter(Boolean)
          : [],
        evidence: evidenceForAtomIDs(atomIDs),
      };
    });
  const gaps = value.gaps
    .map((candidate) => record(candidate))
    .filter((candidate): candidate is UnknownRecord => Boolean(candidate))
    .map((gap) => ({
      kind: text(gap.kind, "unknown"),
      statement: text(gap.statement, "Unlabelled evidence gap"),
      sourceIDs: Array.isArray(gap.sourceIDs)
        ? gap.sourceIDs.map((entry) => text(entry, "")).filter(Boolean)
        : [],
      ...(typeof gap.nextSearchQuestion === "string" &&
      gap.nextSearchQuestion.trim()
        ? { nextSearchQuestion: gap.nextSearchQuestion.trim() }
        : {}),
    }));
  return {
    kind: "contradiction-gap",
    coverage: {
      includedSources: finite(coverage.includedSources) ?? 0,
      admittedArtifacts: finite(coverage.admittedArtifacts) ?? 0,
      verifiedFactAtoms: finite(coverage.verifiedFactAtoms) ?? 0,
      multiSourceSupport: finite(coverage.multiSourceSupport) ?? 0,
      directContradictions: finite(coverage.directContradictions) ?? 0,
      nonComparable: finite(coverage.nonComparable) ?? 0,
      uncertain: finite(coverage.uncertain) ?? 0,
      gaps: finite(coverage.gaps) ?? gaps.length,
    },
    supportGroups,
    relationships,
    gaps,
    nextSearchQuestions: Array.isArray(value.nextSearchQuestions)
      ? value.nextSearchQuestions
          .map((entry) => text(entry, ""))
          .filter(Boolean)
      : [],
    limitations: Array.isArray(value.limitations)
      ? value.limitations.map((entry) => text(entry, "")).filter(Boolean)
      : [],
  };
}

export function createResearchWorkspaceArtifactView(
  value: unknown,
  artifactType?: ResearchWorkspaceArtifactType,
): ResearchWorkspaceArtifactView {
  const candidate = record(value);
  if (!candidate) return { kind: "generic", value };
  if (
    artifactType === "contradiction-gap-dashboard" ||
    candidate.kind === "research-workspace-contradiction-gap-dashboard"
  ) {
    const dashboard = contradictionGapView(candidate);
    if (dashboard) return dashboard;
  }
  if (
    artifactType === "review-log" ||
    candidate.kind === "research-workspace-review-log"
  ) {
    const reviewLog = reviewLogView(candidate);
    if (reviewLog) return reviewLog;
  }
  if (artifactType === "evidence-matrix" || candidate.matrix) {
    const matrix = matrixView(candidate);
    if (matrix) return matrix;
  }
  if (
    artifactType === "relationship-graph" ||
    (candidate.nodes && candidate.edges)
  ) {
    const graph = graphView(candidate);
    if (graph) return graph;
  }
  if (artifactType === "synthesis" || (candidate.answer && candidate.claims)) {
    const synthesis = synthesisView(candidate);
    if (synthesis) return synthesis;
  }
  if (artifactType === "cross-paper-mastery" || candidate.session) {
    const mastery = masteryView(candidate);
    if (mastery) return mastery;
  }
  if (
    artifactType === "citation-context" ||
    artifactType === "citation-stance" ||
    candidate.contexts
  ) {
    const citation = citationView(candidate);
    if (citation) return citation;
  }
  return { kind: "generic", value };
}

function element<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  className = "",
  contents?: string,
) {
  const node = doc.createElementNS(HTML_NS, tag) as HTMLElementTagNameMap[K];
  if (className) node.className = className;
  if (contents !== undefined) node.textContent = contents;
  return node;
}

function percentage(value: number | undefined) {
  return value === undefined ? "—" : `${Math.round(value * 100)}%`;
}

function badge(doc: Document, label: string, tone = "") {
  return element(
    doc,
    "span",
    `pprw-render-badge${tone ? ` pprw-render-badge--${tone}` : ""}`,
    label,
  );
}

function renderEvidence(
  doc: Document,
  evidence: ResearchWorkspaceEvidenceView[],
  options: ResearchWorkspaceArtifactRendererOptions,
) {
  const group = element(doc, "div", "pprw-render-evidence");
  for (const item of evidence) {
    const verified = item.status === "verified";
    if (verified && options.onOpenEvidence) {
      const control = element(
        doc,
        "button",
        "pprw-render-evidence-link",
        `Verified · ${item.locator}`,
      );
      control.type = "button";
      control.addEventListener("click", () => {
        void options.onOpenEvidence?.(item.reference);
      });
      group.append(control);
    } else {
      group.append(
        element(
          doc,
          "span",
          `pprw-render-evidence-link pprw-render-evidence-link--${
            verified ? "verified" : "unverified"
          }`,
          `${humanize(item.status)} · ${item.locator}`,
        ),
      );
    }
  }
  return group;
}

function metric(doc: Document, label: string, value: string) {
  const node = element(doc, "div", "pprw-render-metric");
  node.append(
    element(doc, "strong", "", value),
    element(doc, "span", "", label),
  );
  return node;
}

function renderMatrix(
  doc: Document,
  view: ResearchWorkspaceMatrixView,
  options: ResearchWorkspaceArtifactRendererOptions,
) {
  const root = element(doc, "div", "pprw-render pprw-render--matrix");
  if (view.coverage) {
    const metrics = element(doc, "div", "pprw-render-metrics");
    metrics.append(
      metric(doc, "Extraction", percentage(view.coverage.extraction)),
      metric(doc, "Evidence", percentage(view.coverage.evidence)),
      metric(
        doc,
        "Required evidence",
        percentage(view.coverage.requiredEvidence),
      ),
      metric(doc, "Papers", String(view.rows.length)),
    );
    root.append(metrics);
  }
  const scroller = element(doc, "div", "pprw-matrix-scroll");
  const table = element(doc, "table", "pprw-matrix-table");
  table.append(element(doc, "caption", "", "Evidence Matrix"));
  const head = element(doc, "thead");
  const headRow = element(doc, "tr");
  headRow.append(element(doc, "th", "", "Paper"));
  for (const column of view.columns) {
    headRow.append(element(doc, "th", "", column.label));
  }
  head.append(headRow);
  table.append(head);
  const body = element(doc, "tbody");
  for (const row of view.rows) {
    const tableRow = element(doc, "tr");
    const paperCell = element(doc, "th", "pprw-matrix-paper", row.title);
    paperCell.scope = "row";
    tableRow.append(paperCell);
    const cells = new Map(row.cells.map((cell) => [cell.columnID, cell]));
    for (const column of view.columns) {
      const cell = cells.get(column.id);
      const tableCell = element(doc, "td");
      if (!cell) {
        tableCell.append(badge(doc, "Pending", "warning"));
      } else {
        const value = element(doc, "div", "pprw-matrix-value", cell.value);
        const meta = element(doc, "div", "pprw-render-inline");
        meta.append(
          badge(
            doc,
            humanize(cell.status),
            cell.status === "extracted" ? "success" : "warning",
          ),
        );
        if (cell.confidence !== undefined) {
          meta.append(badge(doc, `Confidence ${percentage(cell.confidence)}`));
        }
        tableCell.append(value, meta);
        if (cell.evidence.length) {
          tableCell.append(renderEvidence(doc, cell.evidence, options));
        }
      }
      tableRow.append(tableCell);
    }
    body.append(tableRow);
  }
  table.append(body);
  scroller.append(table);
  root.append(scroller);
  return root;
}

function renderGraph(
  doc: Document,
  view: ResearchWorkspaceGraphView,
  options: ResearchWorkspaceArtifactRendererOptions,
) {
  const root = element(doc, "div", "pprw-render pprw-render--graph");
  const metrics = element(doc, "div", "pprw-render-metrics");
  metrics.append(
    metric(doc, "Nodes", String(view.nodeCount)),
    metric(doc, "Relationships", String(view.edgeCount)),
    metric(doc, "Verified", String(view.verifiedEdgeCount)),
    metric(doc, "Inferred", String(view.inferredEdgeCount)),
  );
  root.append(metrics);
  const list = element(doc, "div", "pprw-graph-list");
  for (const edge of view.edges) {
    const card = element(doc, "article", "pprw-render-card");
    const relationship = element(doc, "div", "pprw-graph-relationship");
    relationship.append(
      element(doc, "strong", "", edge.source),
      badge(doc, humanize(edge.relationship), "accent"),
      element(doc, "strong", "", edge.target),
    );
    const metadata = element(doc, "div", "pprw-render-inline");
    metadata.append(
      badge(
        doc,
        humanize(edge.provenance),
        edge.provenance === "inferred" ? "warning" : "success",
      ),
    );
    if (edge.confidence !== undefined) {
      metadata.append(badge(doc, `Confidence ${percentage(edge.confidence)}`));
    }
    card.append(relationship, metadata);
    if (edge.evidence.length) {
      card.append(renderEvidence(doc, edge.evidence, options));
    }
    list.append(card);
  }
  if (!view.edges.length) {
    list.append(
      element(doc, "p", "pprw-muted", "No relationships were produced."),
    );
  }
  root.append(list);
  return root;
}

function renderStringList(doc: Document, title: string, entries: string[]) {
  const section = element(doc, "section", "pprw-render-section");
  section.append(element(doc, "h4", "", title));
  const list = element(doc, "ul", "pprw-render-list");
  for (const entry of entries) list.append(element(doc, "li", "", entry));
  section.append(list);
  return section;
}

function renderSynthesis(
  doc: Document,
  view: ResearchWorkspaceSynthesisView,
  options: ResearchWorkspaceArtifactRendererOptions,
) {
  const root = element(doc, "div", "pprw-render pprw-render--synthesis");
  root.append(element(doc, "p", "pprw-synthesis-answer", view.answer));
  if (view.coverage) {
    const metrics = element(doc, "div", "pprw-render-metrics");
    metrics.append(
      metric(doc, "Analyzed", String(view.coverage.analyzedSources ?? "—")),
      metric(
        doc,
        "Project sources",
        String(view.coverage.totalProjectSources ?? "—"),
      ),
      metric(doc, "Excluded", String(view.coverage.excludedSources ?? "—")),
      metric(
        doc,
        "Coverage",
        view.coverage.insufficient ? "Limited" : "Sufficient",
      ),
    );
    root.append(metrics);
  }
  for (const group of view.groups) {
    const section = element(doc, "section", "pprw-render-section");
    section.append(element(doc, "h4", "", group.title));
    const list = element(doc, "div", "pprw-render-card-list");
    for (const entry of group.entries) {
      const card = element(doc, "article", "pprw-render-card");
      card.append(element(doc, "p", "pprw-render-statement", entry.statement));
      const metadata = element(doc, "div", "pprw-render-inline");
      metadata.append(
        badge(
          doc,
          humanize(entry.support),
          entry.support === "verified" ? "success" : "warning",
        ),
        badge(
          doc,
          `${entry.sourceIDs.length} source${
            entry.sourceIDs.length === 1 ? "" : "s"
          }`,
        ),
      );
      card.append(metadata);
      if (entry.uncertainty) {
        card.append(
          element(
            doc,
            "p",
            "pprw-render-note",
            `Uncertainty: ${entry.uncertainty}`,
          ),
        );
      }
      if (entry.evidence.length) {
        card.append(renderEvidence(doc, entry.evidence, options));
      }
      list.append(card);
    }
    section.append(list);
    root.append(section);
  }
  if (view.unresolvedUncertainty.length) {
    root.append(
      renderStringList(
        doc,
        "Unresolved uncertainty",
        view.unresolvedUncertainty,
      ),
    );
  }
  if (view.freshnessWarnings.length) {
    const warnings = renderStringList(
      doc,
      "Freshness and coverage warnings",
      view.freshnessWarnings,
    );
    warnings.classList.add("pprw-render-section--warning");
    root.append(warnings);
  }
  return root;
}

function renderContradictionGap(
  doc: Document,
  view: ResearchWorkspaceContradictionGapView,
  options: ResearchWorkspaceArtifactRendererOptions,
) {
  const root = element(
    doc,
    "div",
    "pprw-render pprw-render--contradiction-gap",
  );
  const metrics = element(doc, "div", "pprw-render-metrics");
  metrics.append(
    metric(doc, "Project sources", String(view.coverage.includedSources)),
    metric(doc, "Current inputs", String(view.coverage.admittedArtifacts)),
    metric(
      doc,
      "Verified evidence-linked assertions",
      String(view.coverage.verifiedFactAtoms),
    ),
    metric(
      doc,
      "Multi-source support",
      String(view.coverage.multiSourceSupport),
    ),
    metric(
      doc,
      "Rule-detected contradiction candidates",
      String(view.coverage.directContradictions),
    ),
    metric(doc, "Evidence gaps", String(view.coverage.gaps)),
  );
  root.append(metrics);

  if (view.supportGroups.length) {
    const section = element(doc, "section", "pprw-render-section");
    section.append(element(doc, "h4", "", "Supported by multiple sources"));
    const list = element(doc, "div", "pprw-render-card-list");
    for (const group of view.supportGroups) {
      const card = element(doc, "article", "pprw-render-card");
      card.append(element(doc, "p", "pprw-render-statement", group.statement));
      const metadata = element(doc, "div", "pprw-render-inline");
      metadata.append(
        badge(doc, `${group.sourceIDs.length} verified sources`, "success"),
      );
      card.append(metadata);
      if (group.evidence.length) {
        card.append(renderEvidence(doc, group.evidence, options));
      }
      list.append(card);
    }
    section.append(list);
    root.append(section);
  }

  const relationshipGroups = [
    ["direct-contradiction", "Contradiction candidates"],
    ["non-comparable", "Non-comparable designs"],
    ["uncertain", "Uncertain comparisons"],
  ] as const;
  for (const [classification, title] of relationshipGroups) {
    const entries = view.relationships.filter(
      (relationship) => relationship.effectiveClassification === classification,
    );
    if (!entries.length) continue;
    const section = element(doc, "section", "pprw-render-section");
    section.append(element(doc, "h4", "", title));
    const list = element(doc, "div", "pprw-render-card-list");
    for (const relationship of entries) {
      const card = element(doc, "article", "pprw-render-card");
      card.dataset.relationshipId = relationship.relationshipID;
      card.append(
        element(doc, "p", "pprw-render-statement", relationship.topic),
      );
      const metadata = element(doc, "div", "pprw-render-inline");
      metadata.append(
        badge(doc, humanize(relationship.effectiveClassification), "accent"),
        badge(doc, `Comparability: ${humanize(relationship.comparability)}`),
        badge(doc, humanize(relationship.reviewState)),
      );
      if (
        relationship.effectiveClassification !==
        relationship.deterministicClassification
      ) {
        metadata.append(
          badge(
            doc,
            `Rule result: ${humanize(
              relationship.deterministicClassification,
            )}`,
            "warning",
          ),
        );
      }
      card.append(metadata);
      if (relationship.sides.length) {
        const sides = element(doc, "ul", "pprw-render-list");
        for (const side of relationship.sides) {
          sides.append(element(doc, "li", "", side));
        }
        card.append(sides);
      }
      if (relationship.evidence.length) {
        card.append(renderEvidence(doc, relationship.evidence, options));
      }
      if (relationship.limitations.length) {
        card.append(
          element(
            doc,
            "p",
            "pprw-render-note",
            relationship.limitations.join(" "),
          ),
        );
      }
      list.append(card);
    }
    section.append(list);
    root.append(section);
  }

  if (view.gaps.length) {
    const section = element(doc, "section", "pprw-render-section");
    section.append(element(doc, "h4", "", "Evidence gaps"));
    const list = element(doc, "div", "pprw-render-card-list");
    for (const gap of view.gaps) {
      const card = element(doc, "article", "pprw-render-card");
      const metadata = element(doc, "div", "pprw-render-inline");
      metadata.append(badge(doc, humanize(gap.kind), "warning"));
      card.append(
        metadata,
        element(doc, "p", "pprw-render-statement", gap.statement),
      );
      if (gap.nextSearchQuestion) {
        card.append(
          element(
            doc,
            "p",
            "pprw-render-note",
            `Next search: ${gap.nextSearchQuestion}`,
          ),
        );
      }
      list.append(card);
    }
    section.append(list);
    root.append(section);
  }
  if (view.nextSearchQuestions.length) {
    root.append(
      renderStringList(doc, "Next search questions", view.nextSearchQuestions),
    );
  }
  if (view.limitations.length) {
    const limitations = renderStringList(
      doc,
      "Coverage and limits",
      view.limitations,
    );
    limitations.classList.add("pprw-render-section--warning");
    root.append(limitations);
  }
  return root;
}

function renderMastery(
  doc: Document,
  view: ResearchWorkspaceMasteryView,
  options: ResearchWorkspaceArtifactRendererOptions,
) {
  const root = element(doc, "div", "pprw-render pprw-render--mastery");
  const metrics = element(doc, "div", "pprw-render-metrics");
  metrics.append(
    metric(doc, "Answer quality", percentage(view.summary.answerQuality)),
    metric(doc, "Calibration", percentage(view.summary.calibration)),
    metric(doc, "Concept coverage", percentage(view.summary.conceptCoverage)),
    metric(doc, "Sources", String(view.sourceCount)),
  );
  root.append(metrics);

  if (view.currentQuestion) {
    const section = element(doc, "section", "pprw-render-section");
    section.append(element(doc, "h4", "", "Current question"));
    const card = element(doc, "article", "pprw-render-card");
    card.append(
      element(doc, "p", "pprw-render-statement", view.currentQuestion.prompt),
    );
    const metadata = element(doc, "div", "pprw-render-inline");
    metadata.append(
      badge(doc, humanize(view.currentQuestion.mode), "accent"),
      badge(doc, humanize(view.currentQuestion.difficulty)),
      badge(
        doc,
        `${view.currentQuestion.sourceCount} source${
          view.currentQuestion.sourceCount === 1 ? "" : "s"
        }`,
      ),
    );
    card.append(metadata);
    section.append(card);
    root.append(section);
  }

  if (view.attempts.length) {
    const section = element(doc, "section", "pprw-render-section");
    section.append(element(doc, "h4", "", "Attempt history"));
    const list = element(doc, "div", "pprw-render-card-list");
    for (const attempt of view.attempts) {
      const card = element(doc, "article", "pprw-render-card");
      card.append(
        element(doc, "h5", "", attempt.question),
        element(doc, "p", "pprw-render-statement", attempt.answer),
      );
      const metadata = element(doc, "div", "pprw-render-inline");
      if (attempt.score !== undefined && attempt.maxScore !== undefined) {
        metadata.append(
          badge(doc, `Score ${attempt.score}/${attempt.maxScore}`),
        );
      }
      if (attempt.learnerConfidence !== undefined) {
        metadata.append(
          badge(
            doc,
            `Learner confidence ${percentage(attempt.learnerConfidence)}`,
          ),
        );
      }
      if (attempt.graderConfidence !== undefined) {
        metadata.append(
          badge(
            doc,
            `Grader confidence ${percentage(attempt.graderConfidence)}`,
          ),
        );
      }
      card.append(metadata);
      for (const grade of attempt.grades) {
        const gradeCard = element(doc, "div", "pprw-render-note");
        gradeCard.append(
          element(
            doc,
            "strong",
            "",
            `${grade.criterion} · ${text(grade.score)}/${text(grade.maxScore)}`,
          ),
          element(doc, "span", "", ` ${grade.feedback}`),
        );
        card.append(gradeCard);
        if (grade.evidence.length) {
          card.append(renderEvidence(doc, grade.evidence, options));
        }
      }
      if (attempt.misconceptions.length) {
        card.append(
          renderStringList(doc, "Misconceptions", attempt.misconceptions),
        );
      }
      list.append(card);
    }
    section.append(list);
    root.append(section);
  }

  if (view.summary.openMisconceptions.length) {
    root.append(
      renderStringList(
        doc,
        "Open misconceptions",
        view.summary.openMisconceptions,
      ),
    );
  }
  if (view.summary.nextReviewAt) {
    root.append(
      element(
        doc,
        "p",
        "pprw-render-note",
        `Next review: ${view.summary.nextReviewAt}`,
      ),
    );
  }
  return root;
}

function renderCitation(
  doc: Document,
  view: ResearchWorkspaceCitationView,
  options: ResearchWorkspaceArtifactRendererOptions,
) {
  const root = element(doc, "div", "pprw-render pprw-render--citation");
  const metrics = element(doc, "div", "pprw-render-metrics");
  metrics.append(
    metric(doc, "Sources", text(view.coverage.sources)),
    metric(doc, "Detected contexts", text(view.coverage.detected)),
    metric(
      doc,
      "Resolved",
      view.coverage.detected
        ? `${view.coverage.resolved ?? 0}/${view.coverage.detected}`
        : "Not applicable",
    ),
    metric(
      doc,
      "Analyzed",
      view.coverage.analyzed !== undefined
        ? `${view.coverage.analyzed}/${view.coverage.submitted ?? 0}`
        : "Not sent",
    ),
  );
  root.append(metrics);
  root.append(
    element(
      doc,
      "p",
      "pprw-render-note",
      "Citation stance is a review signal, not a verdict about whether the cited claim is true.",
    ),
  );
  if (view.coverage.limitations.length) {
    const warnings = renderStringList(
      doc,
      "Coverage limitations",
      view.coverage.limitations,
    );
    warnings.classList.add("pprw-render-section--warning");
    root.append(warnings);
  }
  const list = element(doc, "div", "pprw-render-card-list");
  for (const row of view.rows) {
    const card = element(doc, "article", "pprw-render-card");
    const metadata = element(doc, "div", "pprw-render-inline");
    metadata.append(
      badge(
        doc,
        humanize(row.stance),
        row.stance === "contrasting" ? "warning" : "accent",
      ),
      badge(
        doc,
        humanize(row.resolutionStatus),
        row.resolutionStatus === "resolved" ? "success" : "warning",
      ),
      badge(
        doc,
        row.pageIndex === undefined
          ? "Page unavailable"
          : `Page ${row.pageIndex + 1}`,
      ),
    );
    if (row.confidence !== undefined) {
      metadata.append(badge(doc, `Confidence ${percentage(row.confidence)}`));
    }
    if (row.corrected) metadata.append(badge(doc, "User corrected", "success"));
    card.append(
      metadata,
      element(doc, "p", "pprw-render-statement", row.exactSentence),
      element(
        doc,
        "p",
        "pprw-render-note",
        `Reference ${row.marker}: ${row.resolvedTitle ?? row.reference}`,
      ),
    );
    if (row.rationale) {
      card.append(
        element(doc, "p", "pprw-render-note", `Rationale: ${row.rationale}`),
      );
    }
    if (row.modelStance && row.modelStance !== row.stance) {
      card.append(
        element(
          doc,
          "p",
          "pprw-render-note",
          `Original model signal: ${humanize(row.modelStance)}`,
        ),
      );
    }
    if (row.limitations.length) {
      card.append(renderStringList(doc, "Limitations", row.limitations));
    }
    if (row.evidence.length) {
      card.append(renderEvidence(doc, row.evidence, options));
    }
    list.append(card);
  }
  if (!view.rows.length) {
    list.append(
      element(
        doc,
        "p",
        "pprw-muted",
        "No supported citation marker was automatically detected. This does not prove that the paper has no citations.",
      ),
    );
  }
  root.append(list);
  return root;
}

function renderReviewLog(doc: Document, view: ResearchWorkspaceReviewLogView) {
  const root = element(doc, "div", "pprw-render pprw-render--review-log");
  const metrics = element(doc, "div", "pprw-render-metrics");
  metrics.append(
    metric(doc, "Papers", text(view.summary.total)),
    metric(doc, "Included", text(view.summary.include)),
    metric(doc, "Excluded", text(view.summary.exclude)),
    metric(doc, "Maybe", text(view.summary.maybe)),
    metric(doc, "Unreviewed", text(view.summary.unreviewed)),
    metric(doc, "Decision events", text(view.summary.decisions)),
  );
  root.append(metrics);
  const issueCount =
    (view.summary.duplicateSignals ?? 0) +
    (view.summary.missingPDFSignals ?? 0);
  if (issueCount) {
    root.append(
      element(
        doc,
        "p",
        "pprw-render-note pprw-render-note--warning",
        `${issueCount} local duplicate or missing-PDF signal${issueCount === 1 ? "" : "s"} require review. Signals never change decisions automatically.`,
      ),
    );
  }
  const scroll = element(doc, "div", "pprw-matrix-scroll");
  const table = element(doc, "table", "pprw-matrix-table");
  const head = element(doc, "thead");
  const heading = element(doc, "tr");
  for (const label of ["Paper", "Stage", "Decision", "Reason", "History"]) {
    heading.append(element(doc, "th", "", label));
  }
  head.append(heading);
  table.append(head);
  const body = element(doc, "tbody");
  for (const row of view.rows) {
    const line = element(doc, "tr");
    const paper = element(doc, "td");
    paper.append(element(doc, "strong", "", row.title));
    if (row.issues.length) {
      const flags = element(doc, "div", "pprw-render-inline");
      for (const issue of row.issues) {
        flags.append(badge(doc, humanize(issue), "warning"));
      }
      paper.append(flags);
    }
    line.append(
      paper,
      element(doc, "td", "", humanize(row.stage)),
      element(doc, "td", "", humanize(row.decision)),
      element(doc, "td", "", row.reason),
      element(
        doc,
        "td",
        "",
        row.legacy
          ? "Legacy current state · no event history"
          : `${row.historyCount} event${row.historyCount === 1 ? "" : "s"}`,
      ),
    );
    body.append(line);
  }
  table.append(body);
  scroll.append(table);
  root.append(scroll);
  if (view.limitations.length) {
    root.append(renderStringList(doc, "Audit boundary", view.limitations));
  }
  return root;
}

const HIDDEN_TECHNICAL_FIELDS = new Set([
  "id",
  "schemaVersion",
  "createdAt",
  "updatedAt",
  "contentFingerprint",
  "projectionFingerprint",
]);

function renderContextPlan(doc: Document, value: UnknownRecord) {
  const section = element(doc, "section", "pprw-render-section");
  section.append(element(doc, "h4", "", "Context coverage"));
  const metrics = element(doc, "div", "pprw-render-metrics");
  metrics.append(
    metric(doc, "Budget", text(value.requestedBudget)),
    metric(doc, "Used", text(value.usedCharacters)),
    metric(doc, "Omitted", text(value.omittedCharacters)),
    metric(
      doc,
      "Sources",
      String(Array.isArray(value.projections) ? value.projections.length : "—"),
    ),
  );
  section.append(metrics);
  if (value.insufficientCoverage === true) {
    section.append(
      element(
        doc,
        "p",
        "pprw-render-note pprw-render-note--warning",
        "One or more sources had limited bounded coverage.",
      ),
    );
  }
  return section;
}

function renderGenericValue(
  doc: Document,
  value: unknown,
  options: ResearchWorkspaceArtifactRendererOptions,
  depth = 0,
  label?: string,
): HTMLElement {
  if (isEvidence(value)) {
    return renderEvidence(doc, evidenceViews([value]), options);
  }
  if (value === null || value === undefined) {
    return element(doc, "span", "pprw-render-empty", "Not reported");
  }
  if (typeof value !== "object") {
    return element(doc, "span", "pprw-render-scalar", text(value));
  }
  if (depth >= 5) {
    return element(
      doc,
      "span",
      "pprw-render-empty",
      "Additional detail hidden",
    );
  }
  if (Array.isArray(value)) {
    if (!value.length) return element(doc, "span", "pprw-render-empty", "None");
    const list = element(doc, "div", "pprw-render-card-list");
    for (const entry of value.slice(0, 80)) {
      const item = element(doc, "article", "pprw-render-card");
      item.append(renderGenericValue(doc, entry, options, depth + 1));
      list.append(item);
    }
    return list;
  }
  const candidate = value as UnknownRecord;
  if (label === "contextPlan") return renderContextPlan(doc, candidate);
  const container = element(doc, "div", "pprw-render-fields");
  for (const [key, entry] of Object.entries(candidate)) {
    if (HIDDEN_TECHNICAL_FIELDS.has(key)) continue;
    if (key === "evidence") {
      const evidence = evidenceViews(entry);
      if (evidence.length)
        container.append(renderEvidence(doc, evidence, options));
      continue;
    }
    if (key === "contextPlan" && record(entry)) {
      container.append(renderContextPlan(doc, record(entry)!));
      continue;
    }
    const field = element(doc, "section", "pprw-render-field");
    field.append(element(doc, "h5", "", humanize(key)));
    field.append(renderGenericValue(doc, entry, options, depth + 1, key));
    container.append(field);
  }
  if (!container.childElementCount) {
    container.append(element(doc, "span", "pprw-render-empty", "No details"));
  }
  return container;
}

export function renderResearchWorkspaceArtifactValue(
  doc: Document,
  value: unknown,
  options: ResearchWorkspaceArtifactRendererOptions = {},
) {
  const view = createResearchWorkspaceArtifactView(value, options.artifactType);
  if (view.kind === "matrix") return renderMatrix(doc, view, options);
  if (view.kind === "graph") return renderGraph(doc, view, options);
  if (view.kind === "synthesis") return renderSynthesis(doc, view, options);
  if (view.kind === "mastery") return renderMastery(doc, view, options);
  if (view.kind === "citation") return renderCitation(doc, view, options);
  if (view.kind === "review-log") return renderReviewLog(doc, view);
  if (view.kind === "contradiction-gap") {
    return renderContradictionGap(doc, view, options);
  }
  const root = element(doc, "div", "pprw-render pprw-render--generic");
  root.append(renderGenericValue(doc, view.value, options));
  return root;
}

export function renderResearchWorkspaceArtifactEnvelope(
  doc: Document,
  artifact: ResearchWorkspaceArtifact,
  options: Omit<ResearchWorkspaceArtifactRendererOptions, "artifactType"> = {},
) {
  const root = element(doc, "div", "pprw-render-envelope");
  const lineage = element(doc, "div", "pprw-render-inline");
  lineage.append(
    badge(doc, humanize(artifact.lineage.operation), "accent"),
    badge(doc, artifact.lineage.operationVersion),
    badge(doc, humanize(artifact.lineage.providerMode)),
    badge(
      doc,
      `${artifact.sourceIDs.length} source${
        artifact.sourceIDs.length === 1 ? "" : "s"
      }`,
    ),
  );
  root.append(lineage);
  if (artifact.checkpoint) {
    const progress = element(doc, "div", "pprw-render-metrics");
    progress.append(
      metric(
        doc,
        "Completed",
        String(artifact.checkpoint.completedUnits.length),
      ),
      metric(doc, "Failed", String(artifact.checkpoint.failedUnits.length)),
      metric(doc, "Pending", String(artifact.checkpoint.pendingUnits.length)),
    );
    root.append(progress);
  }
  root.append(
    renderResearchWorkspaceArtifactValue(doc, artifact.payload, {
      ...options,
      artifactType: artifact.type,
    }),
  );
  return root;
}
