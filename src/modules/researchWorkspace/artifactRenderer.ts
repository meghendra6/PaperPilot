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
  quote?: string;
  detail?: string;
}

export type ResearchWorkspaceClaimReviewStatus =
  | "ready"
  | "needs-review"
  | "conflicting";

export interface ResearchWorkspaceClaimLedgerView {
  kind: "claim-ledger";
  summary: {
    total: number;
    readyToCite: number;
    needsReview: number;
    conflicting: number;
    evidenceTotal: number;
    evidenceVerified: number;
  };
  claims: Array<{
    id: string;
    text: string;
    claimKind: string;
    confidence?: number;
    reviewStatus: ResearchWorkspaceClaimReviewStatus;
    verifiedSupport: number;
    evidenceTotal: number;
    support: ResearchWorkspaceEvidenceView[];
    contradictions: ResearchWorkspaceEvidenceView[];
  }>;
}

export interface ResearchWorkspaceMethodologyView {
  kind: "methodology";
  profile: string;
  executiveSummary: string;
  strengths: string[];
  checks: Array<{
    checkID: string;
    status: string;
    severity: string;
    finding: string;
    implication: string;
    confidence?: number;
    evidence: ResearchWorkspaceEvidenceView[];
  }>;
  experiments: Array<{
    hypothesis: string;
    experiment: string;
    expectedOutcomes: string[];
    evidence: ResearchWorkspaceEvidenceView[];
  }>;
  residualUncertainty: string[];
}

export interface ResearchWorkspaceReproducibilityView {
  kind: "reproducibility";
  summary: string;
  estimatedEffort: string;
  availability: {
    available: number;
    partial: number;
    missing: number;
    unclear: number;
  };
  artifacts: Array<{
    label: string;
    artifactKind: string;
    availability: string;
    value?: string;
    url?: string;
    version?: string;
    notes?: string;
    confidence?: number;
    evidence: ResearchWorkspaceEvidenceView[];
  }>;
  blockers: Array<{
    severity: string;
    description: string;
    mitigation: string;
    evidence: ResearchWorkspaceEvidenceView[];
  }>;
  steps: Array<{
    order: number;
    title: string;
    inputs: string[];
    outputs: string[];
    assumptions: string[];
    unresolved: string[];
    evidence: ResearchWorkspaceEvidenceView[];
  }>;
  minimalReproductionSteps: string[];
  verificationCommands: string[];
}

export interface ResearchWorkspacePaperToCodeView {
  kind: "paper-to-code";
  objective: string;
  summary: string;
  inputs: string[];
  outputs: string[];
  pseudocode: string;
  trace: Array<{
    order: number;
    name: string;
    operation: string;
    inputShapes: string[];
    outputShapes: string[];
    stateChanges: string[];
    memoryOrCommunication: string[];
    invariants: string[];
    ambiguity: string[];
    evidence: ResearchWorkspaceEvidenceView[];
  }>;
  invariants: Array<{
    statement: string;
    consequence: string;
    evidence: ResearchWorkspaceEvidenceView[];
  }>;
  complexity: {
    compute: string;
    memory: string;
    communication?: string;
    bottleneck?: string;
    assumptions: string[];
    evidence: ResearchWorkspaceEvidenceView[];
  };
  ambiguities: Array<{
    question: string;
    impact: string;
    likelyChoices: string[];
    proposedExperiment: string;
    evidence: ResearchWorkspaceEvidenceView[];
  }>;
  divergences: Array<{
    area: string;
    paperStatement: string;
    codeBehavior: string;
    impact: string;
    evidence: ResearchWorkspaceEvidenceView[];
  }>;
  checklist: string[];
  tests: Array<{
    name: string;
    purpose: string;
    setup: string;
    expected: string;
  }>;
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

export interface ResearchWorkspaceCitationHealthView {
  kind: "citation-health";
  provenance: {
    localMetadataVersion: string;
    localMetadataObservedAt: string;
    localMetadataFingerprint: string;
    localMetadataTruncated: boolean;
    externalProvider?: {
      provider: string;
      observedAt: string;
      fingerprint: string;
      identifiersChecked: number;
      identifiersCovered: number;
      signalCount: number;
    };
  };
  coverage: {
    admittedArtifacts: number;
    citationContexts: number;
    citationStances: number;
    localLibraryItems: number;
    localMetadataSignals: number;
    methodologyArtifacts: number;
    reproducibilityArtifacts: number;
    draftStatements: number;
    unsupportedDraftCandidates: number;
    externalProviderStatus: string;
  };
  findings: Array<{
    findingID: string;
    kind: string;
    severity: string;
    title: string;
    summary: string;
    sourceCount: number;
    contextCount: number;
    referenceIdentity?: string;
    localItem?: string;
    draftExcerpt?: string;
    evidence: ResearchWorkspaceEvidenceView[];
    limitations: string[];
  }>;
  draft?: {
    name?: string;
    fingerprint: string;
    excerpt: string;
    sourceCharacters: number;
    analyzedCharacters: number;
    statementCount: number;
    truncated: boolean;
  };
  limitations: string[];
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
  | ResearchWorkspaceClaimLedgerView
  | ResearchWorkspaceMethodologyView
  | ResearchWorkspaceReproducibilityView
  | ResearchWorkspacePaperToCodeView
  | ResearchWorkspaceMatrixView
  | ResearchWorkspaceGraphView
  | ResearchWorkspaceSynthesisView
  | ResearchWorkspaceMasteryView
  | ResearchWorkspaceCitationView
  | ResearchWorkspaceCitationHealthView
  | ResearchWorkspaceReviewLogView
  | ResearchWorkspaceContradictionGapView
  | ResearchWorkspaceGenericView;

export interface ResearchWorkspaceArtifactRendererOptions {
  artifactType?: ResearchWorkspaceArtifactType;
  responseLanguage?: string;
  onOpenEvidence?: (reference: UnknownRecord) => void | Promise<void>;
  onCopyText?: (value: string) => void | Promise<void>;
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
  return value.filter(isEvidence).map((reference) => {
    const verification = record(reference.verification);
    const quote = text(reference.exactQuote ?? reference.quote, "").trim();
    const detail = text(verification?.detail, "").trim();
    return {
      reference,
      locator: formatEvidenceLocator(reference),
      status: text(verification?.status, "unverified"),
      ...(quote ? { quote } : {}),
      ...(detail ? { detail } : {}),
    };
  });
}

function stringList(value: unknown) {
  return Array.isArray(value)
    ? value
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter(Boolean)
    : [];
}

function claimLedgerView(
  value: UnknownRecord,
): ResearchWorkspaceClaimLedgerView | undefined {
  if (!Array.isArray(value.claims)) return undefined;
  const claims = value.claims
    .map((entry) => record(entry))
    .filter((entry): entry is UnknownRecord => Boolean(entry))
    .filter((entry) => typeof entry.text === "string")
    .map((claim) => {
      const support = evidenceViews(claim.support);
      const contradictions = evidenceViews(claim.contradictions);
      const verifiedSupport = support.filter(
        (reference) => reference.status === "verified",
      ).length;
      const verifiedContradictions = contradictions.filter(
        (reference) => reference.status === "verified",
      ).length;
      const reviewStatus: ResearchWorkspaceClaimReviewStatus =
        verifiedContradictions > 0
          ? "conflicting"
          : verifiedSupport > 0 && contradictions.length === 0
            ? "ready"
            : "needs-review";
      return {
        id: text(claim.id, ""),
        text: text(claim.text, "Unlabelled claim"),
        claimKind: text(claim.kind, "claim"),
        confidence: finite(claim.confidence),
        reviewStatus,
        verifiedSupport,
        evidenceTotal: support.length + contradictions.length,
        support,
        contradictions,
      };
    });
  if (value.claims.length && !claims.length) return undefined;
  const allEvidence = claims.flatMap((claim) => [
    ...claim.support,
    ...claim.contradictions,
  ]);
  return {
    kind: "claim-ledger",
    summary: {
      total: claims.length,
      readyToCite: claims.filter((claim) => claim.reviewStatus === "ready")
        .length,
      needsReview: claims.filter(
        (claim) => claim.reviewStatus === "needs-review",
      ).length,
      conflicting: claims.filter(
        (claim) => claim.reviewStatus === "conflicting",
      ).length,
      evidenceTotal: allEvidence.length,
      evidenceVerified: allEvidence.filter(
        (reference) => reference.status === "verified",
      ).length,
    },
    claims,
  };
}

function methodologyView(
  value: UnknownRecord,
): ResearchWorkspaceMethodologyView | undefined {
  const report = record(value.report) ?? value;
  if (!Array.isArray(report.checks)) return undefined;
  const detection = record(value.detection);
  return {
    kind: "methodology",
    profile: text(report.profile ?? detection?.primary, "general"),
    executiveSummary: text(
      report.executiveSummary,
      "No methodology summary was returned.",
    ),
    strengths: stringList(report.strengths),
    checks: report.checks
      .map((entry) => record(entry))
      .filter((entry): entry is UnknownRecord => Boolean(entry))
      .map((check) => ({
        checkID: text(check.checkId ?? check.checkID, "methodology check"),
        status: text(check.status, "unclear"),
        severity: text(check.severity, "none"),
        finding: text(check.finding, "No finding reported"),
        implication: text(check.implication, "No implication reported"),
        confidence: finite(check.confidence),
        evidence: evidenceViews(check.evidence),
      })),
    experiments: (Array.isArray(report.discriminatingExperiments)
      ? report.discriminatingExperiments
      : []
    )
      .map((entry) => record(entry))
      .filter((entry): entry is UnknownRecord => Boolean(entry))
      .map((experiment) => ({
        hypothesis: text(experiment.hypothesis, "Unlabelled hypothesis"),
        experiment: text(experiment.experiment, "No experiment reported"),
        expectedOutcomes: stringList(experiment.expectedOutcomes),
        evidence: evidenceViews(experiment.evidence),
      })),
    residualUncertainty: stringList(report.residualUncertainty),
  };
}

function reproducibilityView(
  value: UnknownRecord,
): ResearchWorkspaceReproducibilityView | undefined {
  if (!Array.isArray(value.artifacts) || !Array.isArray(value.blockers)) {
    return undefined;
  }
  const artifacts = value.artifacts
    .map((entry) => record(entry))
    .filter((entry): entry is UnknownRecord => Boolean(entry))
    .map((artifact) => ({
      label: text(artifact.label, humanize(text(artifact.kind, "artifact"))),
      artifactKind: text(artifact.kind ?? artifact.category, "other"),
      availability: text(artifact.availability ?? artifact.status, "unclear"),
      ...(typeof artifact.value === "string" && artifact.value.trim()
        ? { value: artifact.value.trim() }
        : {}),
      ...(typeof artifact.url === "string" && artifact.url.trim()
        ? { url: artifact.url.trim() }
        : {}),
      ...(typeof artifact.version === "string" && artifact.version.trim()
        ? { version: artifact.version.trim() }
        : {}),
      ...(typeof artifact.notes === "string" && artifact.notes.trim()
        ? { notes: artifact.notes.trim() }
        : {}),
      confidence: finite(artifact.confidence),
      evidence: evidenceViews(artifact.evidence),
    }));
  const count = (availability: string) =>
    artifacts.filter((artifact) => artifact.availability === availability)
      .length;
  return {
    kind: "reproducibility",
    summary: text(value.summary, "No reproducibility summary was returned."),
    estimatedEffort: text(value.estimatedEffort, "unknown"),
    availability: {
      available: count("available"),
      partial: count("partial"),
      missing: count("missing"),
      unclear: count("unclear"),
    },
    artifacts,
    blockers: value.blockers
      .map((entry) => record(entry))
      .filter((entry): entry is UnknownRecord => Boolean(entry))
      .map((blocker) => ({
        severity: text(blocker.severity, "major"),
        description: text(blocker.description, "Unspecified blocker"),
        mitigation: text(blocker.mitigation, "No mitigation reported"),
        evidence: evidenceViews(blocker.evidence),
      })),
    steps: (Array.isArray(value.steps) ? value.steps : [])
      .map((entry) => record(entry))
      .filter((entry): entry is UnknownRecord => Boolean(entry))
      .map((step, index) => ({
        order: finite(step.order) ?? index + 1,
        title: text(step.title, `Step ${index + 1}`),
        inputs: stringList(step.inputs),
        outputs: stringList(step.outputs),
        assumptions: stringList(step.assumptions),
        unresolved: stringList(step.unresolved),
        evidence: evidenceViews(step.evidence),
      })),
    minimalReproductionSteps: stringList(
      value.minimumViableReproduction ?? value.minimalReproductionSteps,
    ),
    verificationCommands: stringList(
      value.verificationChecks ?? value.verificationCommands,
    ),
  };
}

function paperToCodeView(
  value: UnknownRecord,
): ResearchWorkspacePaperToCodeView | undefined {
  const rawTrace = Array.isArray(value.trace)
    ? value.trace
    : Array.isArray(value.tensorTrace)
      ? value.tensorTrace
      : undefined;
  const complexity = record(value.complexity);
  if (!rawTrace || !complexity || typeof value.pseudocode !== "string") {
    return undefined;
  }
  const trace = rawTrace
    .map((entry) => record(entry))
    .filter((entry): entry is UnknownRecord => Boolean(entry))
    .map((step, index) => ({
      order: finite(step.order) ?? index + 1,
      name: text(step.name ?? step.stage, `Step ${index + 1}`),
      operation: text(step.operation, "Unspecified operation"),
      inputShapes: Array.isArray(step.inputShapes)
        ? stringList(step.inputShapes)
        : stringList(
            typeof step.inputShape === "string" ? [step.inputShape] : [],
          ),
      outputShapes: Array.isArray(step.outputShapes)
        ? stringList(step.outputShapes)
        : stringList(
            typeof step.outputShape === "string" ? [step.outputShape] : [],
          ),
      stateChanges: [
        ...stringList(step.stateReads).map((entry) => `Read: ${entry}`),
        ...stringList(step.stateWrites ?? step.stateChanges).map(
          (entry) => `Write: ${entry}`,
        ),
      ],
      memoryOrCommunication: stringList(
        step.memoryOrCommunication ?? step.memoryAccess,
      ),
      invariants: stringList(step.invariants),
      ambiguity: stringList(step.ambiguity),
      evidence: evidenceViews(step.evidence),
    }));
  const tests = (
    Array.isArray(value.tests)
      ? value.tests
      : Array.isArray(value.validationTests)
        ? value.validationTests
        : []
  ).map((entry, index) => {
    const candidate = record(entry);
    return candidate
      ? {
          name: text(candidate.name, `Test ${index + 1}`),
          purpose: text(candidate.purpose, "Validation test"),
          setup: text(candidate.setup, ""),
          expected: text(candidate.expected, ""),
        }
      : {
          name: `Test ${index + 1}`,
          purpose: text(entry, "Validation test"),
          setup: "",
          expected: "",
        };
  });
  return {
    kind: "paper-to-code",
    objective: text(value.objective, "Implementation objective not reported"),
    summary: text(value.summary, "No implementation summary was returned."),
    inputs: stringList(value.inputs),
    outputs: stringList(value.outputs),
    pseudocode: value.pseudocode.trim(),
    trace,
    invariants: (Array.isArray(value.invariants) ? value.invariants : [])
      .map((entry) => record(entry))
      .filter((entry): entry is UnknownRecord => Boolean(entry))
      .map((invariant) => ({
        statement: text(invariant.statement, "Unspecified invariant"),
        consequence: text(invariant.consequence, ""),
        evidence: evidenceViews(invariant.evidence),
      })),
    complexity: {
      compute: text(complexity.compute ?? complexity.time, "Unspecified"),
      memory: text(complexity.memory, "Unspecified"),
      ...(typeof complexity.communication === "string" &&
      complexity.communication.trim()
        ? { communication: complexity.communication.trim() }
        : {}),
      ...(typeof complexity.bottleneck === "string" &&
      complexity.bottleneck.trim()
        ? { bottleneck: complexity.bottleneck.trim() }
        : {}),
      assumptions: stringList(complexity.assumptions),
      evidence: evidenceViews(complexity.evidence),
    },
    ambiguities: (Array.isArray(value.ambiguities) ? value.ambiguities : [])
      .map((entry) => record(entry))
      .filter((entry): entry is UnknownRecord => Boolean(entry))
      .map((ambiguity) => ({
        question: text(ambiguity.question, "Unspecified ambiguity"),
        impact: text(ambiguity.impact ?? ambiguity.risk, "unknown"),
        likelyChoices: stringList(ambiguity.likelyChoices),
        proposedExperiment: text(
          ambiguity.proposedExperiment ?? ambiguity.suggestedResolution,
          "No resolution reported",
        ),
        evidence: evidenceViews(ambiguity.evidence),
      })),
    divergences: (Array.isArray(value.paperCodeDivergences)
      ? value.paperCodeDivergences
      : []
    )
      .map((entry) => record(entry))
      .filter((entry): entry is UnknownRecord => Boolean(entry))
      .map((divergence) => ({
        area: text(divergence.area, "Unlabelled divergence"),
        paperStatement: text(divergence.paperStatement, "Not reported"),
        codeBehavior: text(divergence.codeBehavior, "Not reported"),
        impact: text(divergence.impact, "Not reported"),
        evidence: evidenceViews(divergence.evidence),
      })),
    checklist: stringList(
      value.minimalReproduction ??
        value.implementationChecklist ??
        value.minimalReproductionSteps,
    ),
    tests,
  };
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

function citationHealthView(
  value: UnknownRecord,
): ResearchWorkspaceCitationHealthView | undefined {
  if (
    value.kind !== "research-workspace-citation-health" ||
    !Array.isArray(value.findings)
  ) {
    return undefined;
  }
  const coverage = record(value.coverage) ?? {};
  const external = record(coverage.externalProvider) ?? {};
  const localMetadata = record(value.localMetadata) ?? {};
  const externalProvenance = record(value.externalProvider);
  const draft = record(value.draft);
  return {
    kind: "citation-health",
    provenance: {
      localMetadataVersion: text(localMetadata.version, "unknown"),
      localMetadataObservedAt: text(localMetadata.observedAt, "unknown"),
      localMetadataFingerprint: text(localMetadata.fingerprint, "unavailable"),
      localMetadataTruncated: localMetadata.truncated === true,
      ...(externalProvenance
        ? {
            externalProvider: {
              provider: text(externalProvenance.provider, "Unknown provider"),
              observedAt: text(externalProvenance.observedAt, "unknown"),
              fingerprint: text(externalProvenance.fingerprint, "unavailable"),
              identifiersChecked:
                finite(externalProvenance.identifiersChecked) ?? 0,
              identifiersCovered:
                finite(externalProvenance.identifiersCovered) ?? 0,
              signalCount: finite(externalProvenance.signalCount) ?? 0,
            },
          }
        : {}),
    },
    coverage: {
      admittedArtifacts: finite(coverage.admittedArtifacts) ?? 0,
      citationContexts: finite(coverage.citationContexts) ?? 0,
      citationStances: finite(coverage.citationStances) ?? 0,
      localLibraryItems: finite(coverage.localLibraryItems) ?? 0,
      localMetadataSignals: finite(coverage.localMetadataSignals) ?? 0,
      methodologyArtifacts: finite(coverage.methodologyArtifacts) ?? 0,
      reproducibilityArtifacts: finite(coverage.reproducibilityArtifacts) ?? 0,
      draftStatements: finite(coverage.draftStatements) ?? 0,
      unsupportedDraftCandidates:
        finite(coverage.unsupportedDraftCandidates) ?? 0,
      externalProviderStatus: text(external.status, "not-configured"),
    },
    findings: value.findings
      .map((entry) => record(entry))
      .filter((entry): entry is UnknownRecord => Boolean(entry))
      .map((entry) => {
        const localItem = record(entry.localItem);
        const draftStatement = record(entry.draftStatement);
        return {
          findingID: text(entry.findingID, ""),
          kind: text(entry.kind, "unknown"),
          severity: text(entry.severity, "review"),
          title: text(entry.title, "Unlabelled citation health finding"),
          summary: text(entry.summary),
          sourceCount: Array.isArray(entry.sourceIDs)
            ? entry.sourceIDs.length
            : 0,
          contextCount: Array.isArray(entry.contextIDs)
            ? entry.contextIDs.length
            : 0,
          ...(typeof entry.referenceIdentity === "string" &&
          entry.referenceIdentity.trim()
            ? { referenceIdentity: entry.referenceIdentity.trim() }
            : {}),
          ...(localItem
            ? {
                localItem: `${text(localItem.title, "Local item")} · Library ${text(localItem.libraryID)} · ${text(localItem.itemKey)}`,
              }
            : {}),
          ...(draftStatement &&
          typeof draftStatement.excerpt === "string" &&
          draftStatement.excerpt.trim()
            ? { draftExcerpt: draftStatement.excerpt.trim() }
            : {}),
          evidence: evidenceViews(entry.evidence),
          limitations: stringList(entry.limitations),
        };
      }),
    ...(draft
      ? {
          draft: {
            ...(typeof draft.name === "string" && draft.name.trim()
              ? { name: draft.name.trim() }
              : {}),
            fingerprint: text(draft.fingerprint, "unavailable"),
            excerpt: text(draft.excerpt, ""),
            sourceCharacters: finite(draft.sourceCharacters) ?? 0,
            analyzedCharacters: finite(draft.analyzedCharacters) ?? 0,
            statementCount: finite(draft.statementCount) ?? 0,
            truncated: draft.truncated === true,
          },
        }
      : {}),
    limitations: stringList(value.limitations),
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
    artifactType === "claim-ledger" ||
    (typeof candidate.paperKey === "string" && Array.isArray(candidate.claims))
  ) {
    const ledger = claimLedgerView(candidate);
    if (ledger) return ledger;
  }
  if (
    artifactType === "methodology-audit" ||
    candidate.kind === "methodology-audit"
  ) {
    const methodology = methodologyView(candidate);
    if (methodology) return methodology;
  }
  if (
    artifactType === "reproducibility" ||
    (Array.isArray(candidate.artifacts) && Array.isArray(candidate.blockers))
  ) {
    const reproducibility = reproducibilityView(candidate);
    if (reproducibility) return reproducibility;
  }
  if (
    artifactType === "paper-to-code" ||
    (typeof candidate.pseudocode === "string" &&
      (Array.isArray(candidate.trace) || Array.isArray(candidate.tensorTrace)))
  ) {
    const implementation = paperToCodeView(candidate);
    if (implementation) return implementation;
  }
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
    artifactType === "citation-health" ||
    candidate.kind === "research-workspace-citation-health"
  ) {
    const health = citationHealthView(candidate);
    if (health) return health;
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

function statusTone(status: string) {
  if (
    ["verified", "supported", "available", "none", "not_applicable"].includes(
      status,
    )
  ) {
    return "success";
  }
  if (
    [
      "conflicting",
      "unverified",
      "unsupported",
      "missing",
      "major",
      "critical",
      "high",
    ].includes(status)
  ) {
    return "warning";
  }
  return "accent";
}

type ClaimLedgerLanguage = "en" | "ko" | "zh";

interface ClaimLedgerLabels {
  language: ClaimLedgerLanguage;
  guidance: string;
  claims: string;
  readyToCite: string;
  needsReview: string;
  conflicting: string;
  checkedEvidence: string;
  copyMarkdown: string;
  copied: string;
  copyFailed: string;
  filters: string;
  all: string;
  ready: string;
  review: string;
  conflicts: string;
  claimType: string;
  allTypes: string;
  showing: (visible: number, total: number) => string;
  noMatches: string;
  evidence: string;
  supportingEvidence: string;
  contradictingEvidence: string;
  noEvidence: string;
  noQuote: string;
  openPDF: string;
  status: Record<string, string>;
  details: Record<string, string>;
  kinds: Record<string, string>;
  markdownTitle: string;
  evidenceSummary: (verified: number, total: number) => string;
}

const CLAIM_LEDGER_LABELS: Record<ClaimLedgerLanguage, ClaimLedgerLabels> = {
  en: {
    language: "en",
    guidance:
      "Review claims first, then open the evidence only where it affects your reading or writing. Only locally checked evidence is ready to cite.",
    claims: "Claims",
    readyToCite: "Ready to cite",
    needsReview: "Needs review",
    conflicting: "Conflicting",
    checkedEvidence: "Checked evidence",
    copyMarkdown: "Copy readable Markdown",
    copied: "Copied",
    copyFailed: "Copy failed",
    filters: "Evidence review filter",
    all: "All",
    ready: "Ready",
    review: "Review needed",
    conflicts: "Conflicts",
    claimType: "Claim type",
    allTypes: "All claim types",
    showing: (visible, total) => `Showing ${visible} of ${total} claims`,
    noMatches: "No claims match the current filters.",
    evidence: "View evidence",
    supportingEvidence: "Supporting evidence",
    contradictingEvidence: "Contradicting evidence",
    noEvidence: "No supporting evidence was returned for this claim.",
    noQuote: "No quote was returned for this locator.",
    openPDF: "Open in PDF",
    status: {
      ready: "Local evidence checked",
      "needs-review": "Source review needed",
      conflicting: "Conflicting evidence",
      verified: "Locally checked",
      unverified: "Not locally checked",
      "not-found": "Quote not found",
      "source-unavailable": "Source unavailable",
    },
    details: {},
    kinds: {
      author_claim: "Author claim",
      empirical_result: "Empirical result",
      assumption: "Assumption",
      reader_inference: "Reader inference",
      external_evidence: "External evidence",
      claim: "Claim",
    },
    markdownTitle: "Claim–Evidence Review",
    evidenceSummary: (verified, total) =>
      `${verified} of ${total} evidence references locally checked`,
  },
  ko: {
    language: "ko",
    guidance:
      "먼저 주장을 훑고, 읽기나 글쓰기에 필요한 근거만 펼쳐 확인하세요. 로컬 원문 확인이 끝난 근거만 인용에 사용할 수 있습니다.",
    claims: "전체 주장",
    readyToCite: "인용 준비",
    needsReview: "확인 필요",
    conflicting: "상충",
    checkedEvidence: "확인된 근거",
    copyMarkdown: "읽기 좋은 Markdown 복사",
    copied: "복사됨",
    copyFailed: "복사 실패",
    filters: "근거 검토 필터",
    all: "전체",
    ready: "인용 준비",
    review: "확인 필요",
    conflicts: "상충",
    claimType: "주장 유형",
    allTypes: "모든 주장 유형",
    showing: (visible, total) => `주장 ${total}개 중 ${visible}개 표시`,
    noMatches: "현재 조건에 맞는 주장이 없습니다.",
    evidence: "근거 보기",
    supportingEvidence: "지지 근거",
    contradictingEvidence: "상충 근거",
    noEvidence: "이 주장에 제시된 지지 근거가 없습니다.",
    noQuote: "이 위치에 대한 인용문이 제공되지 않았습니다.",
    openPDF: "PDF에서 열기",
    status: {
      ready: "로컬 원문 확인됨",
      "needs-review": "원문 확인 필요",
      conflicting: "상충 근거 있음",
      verified: "로컬 원문 확인됨",
      unverified: "원문 확인 안 됨",
      "not-found": "인용문을 찾지 못함",
      "source-unavailable": "원본 접근 불가",
    },
    details: {
      "No exact quote or trusted structured element was supplied.":
        "직접 인용문이나 신뢰할 수 있는 구조화 요소가 제공되지 않았습니다.",
      "The exact local PDF source could not be loaded.":
        "정확한 로컬 PDF 원본을 불러오지 못했습니다.",
      "The claimed page is outside the local PDF page range.":
        "표시된 페이지가 로컬 PDF의 페이지 범위를 벗어납니다.",
      "The exact quote was not found at the claimed local PDF location.":
        "표시된 로컬 PDF 위치에서 해당 인용문을 찾지 못했습니다.",
    },
    kinds: {
      author_claim: "저자 주장",
      empirical_result: "실험 결과",
      assumption: "가정",
      reader_inference: "독자 추론",
      external_evidence: "외부 근거",
      claim: "주장",
    },
    markdownTitle: "주장–근거 검토표",
    evidenceSummary: (verified, total) =>
      `근거 ${total}개 중 ${verified}개 로컬 원문 확인됨`,
  },
  zh: {
    language: "zh",
    guidance:
      "先浏览主张，再只展开影响阅读或写作的证据。只有经过本地原文核验的证据才适合引用。",
    claims: "全部主张",
    readyToCite: "可供引用",
    needsReview: "需要核验",
    conflicting: "存在冲突",
    checkedEvidence: "已核验证据",
    copyMarkdown: "复制易读 Markdown",
    copied: "已复制",
    copyFailed: "复制失败",
    filters: "证据核验筛选",
    all: "全部",
    ready: "可供引用",
    review: "需要核验",
    conflicts: "冲突",
    claimType: "主张类型",
    allTypes: "全部主张类型",
    showing: (visible, total) => `显示 ${visible}/${total} 条主张`,
    noMatches: "没有符合当前筛选条件的主张。",
    evidence: "查看证据",
    supportingEvidence: "支持证据",
    contradictingEvidence: "冲突证据",
    noEvidence: "该主张没有返回支持证据。",
    noQuote: "该位置没有返回引文。",
    openPDF: "在 PDF 中打开",
    status: {
      ready: "本地原文已核验",
      "needs-review": "需要原文核验",
      conflicting: "存在冲突证据",
      verified: "本地原文已核验",
      unverified: "本地原文未核验",
      "not-found": "未找到引文",
      "source-unavailable": "原文不可用",
    },
    details: {
      "No exact quote or trusted structured element was supplied.":
        "未提供直接引文或可信的结构化元素。",
      "The exact local PDF source could not be loaded.":
        "无法加载对应的本地 PDF 原文。",
      "The claimed page is outside the local PDF page range.":
        "所标页码超出本地 PDF 的页数范围。",
      "The exact quote was not found at the claimed local PDF location.":
        "在所标的本地 PDF 位置未找到该引文。",
    },
    kinds: {
      author_claim: "作者主张",
      empirical_result: "实证结果",
      assumption: "假设",
      reader_inference: "读者推断",
      external_evidence: "外部证据",
      claim: "主张",
    },
    markdownTitle: "主张–证据核验表",
    evidenceSummary: (verified, total) =>
      `${total} 条证据中 ${verified} 条已完成本地原文核验`,
  },
};

function claimLedgerLabels(responseLanguage?: string) {
  const normalized = String(responseLanguage || "English").toLowerCase();
  if (normalized === "korean" || normalized.startsWith("ko")) {
    return CLAIM_LEDGER_LABELS.ko;
  }
  if (normalized === "chinese" || normalized.startsWith("zh")) {
    return CLAIM_LEDGER_LABELS.zh;
  }
  return CLAIM_LEDGER_LABELS.en;
}

function localizedClaimKind(kind: string, labels: ClaimLedgerLabels) {
  return labels.kinds[kind] ?? humanize(kind);
}

function localizedClaimStatus(status: string, labels: ClaimLedgerLabels) {
  return labels.status[status] ?? humanize(status);
}

function localizedEvidenceDetail(detail: string, labels: ClaimLedgerLabels) {
  return labels.details[detail] ?? detail;
}

function claimLedgerMarkdown(
  view: ResearchWorkspaceClaimLedgerView,
  labels: ClaimLedgerLabels,
) {
  const lines = [
    `# ${labels.markdownTitle}`,
    "",
    `- ${labels.claims}: ${view.summary.total}`,
    `- ${labels.readyToCite}: ${view.summary.readyToCite}`,
    `- ${labels.needsReview}: ${view.summary.needsReview}`,
    `- ${labels.conflicting}: ${view.summary.conflicting}`,
    `- ${labels.checkedEvidence}: ${view.summary.evidenceVerified}/${view.summary.evidenceTotal}`,
  ];
  const appendEvidence = (
    title: string,
    evidence: ResearchWorkspaceEvidenceView[],
  ) => {
    lines.push("", `### ${title}`);
    if (!evidence.length) {
      lines.push("", `- ${labels.noEvidence}`);
      return;
    }
    for (const [index, item] of evidence.entries()) {
      lines.push(
        "",
        `${index + 1}. **${localizedClaimStatus(item.status, labels)}** — ${item.locator}`,
      );
      if (item.quote) lines.push("", `   > ${item.quote.replace(/\n+/g, " ")}`);
      if (item.detail) {
        lines.push("", `   ${localizedEvidenceDetail(item.detail, labels)}`);
      }
    }
  };
  for (const [index, claim] of view.claims.entries()) {
    lines.push(
      "",
      `## ${index + 1}. ${claim.text}`,
      "",
      `- ${localizedClaimKind(claim.claimKind, labels)}`,
      `- ${localizedClaimStatus(claim.reviewStatus, labels)}`,
      `- ${labels.evidenceSummary(claim.verifiedSupport, claim.evidenceTotal)}`,
    );
    appendEvidence(labels.supportingEvidence, claim.support);
    if (claim.contradictions.length) {
      appendEvidence(labels.contradictingEvidence, claim.contradictions);
    }
  }
  return `${lines.join("\n").trim()}\n`;
}

export function createResearchWorkspaceClaimLedgerMarkdown(
  value: unknown,
  responseLanguage = "English",
) {
  const view = createResearchWorkspaceArtifactView(value, "claim-ledger");
  if (view.kind !== "claim-ledger") {
    throw new Error("The value is not a Claim Ledger artifact.");
  }
  return claimLedgerMarkdown(view, claimLedgerLabels(responseLanguage));
}

function renderClaimEvidenceGroup(
  doc: Document,
  title: string,
  evidence: ResearchWorkspaceEvidenceView[],
  labels: ClaimLedgerLabels,
  options: ResearchWorkspaceArtifactRendererOptions,
) {
  const section = element(doc, "section", "pprw-claim-evidence-group");
  section.append(element(doc, "h4", "", `${title} · ${evidence.length}`));
  if (!evidence.length) {
    section.append(element(doc, "p", "pprw-render-empty", labels.noEvidence));
    return section;
  }
  const list = element(doc, "div", "pprw-claim-evidence-list");
  for (const item of evidence) {
    const row = element(doc, "article", "pprw-claim-evidence-item");
    row.dataset.status = item.status;
    const header = element(doc, "div", "pprw-claim-evidence-header");
    header.append(
      element(
        doc,
        "strong",
        "pprw-claim-evidence-status",
        localizedClaimStatus(item.status, labels),
      ),
      element(doc, "span", "pprw-claim-evidence-locator", item.locator),
    );
    row.append(header);
    if (item.quote) {
      row.append(element(doc, "blockquote", "pprw-claim-quote", item.quote));
    } else if (!item.detail) {
      row.append(element(doc, "p", "pprw-claim-no-quote", labels.noQuote));
    }
    if (item.detail) {
      row.append(
        element(
          doc,
          "p",
          "pprw-claim-evidence-detail",
          localizedEvidenceDetail(item.detail, labels),
        ),
      );
    }
    if (item.status === "verified" && options.onOpenEvidence) {
      const open = element(
        doc,
        "button",
        "pprw-button pp-btn pp-btn--ghost pprw-claim-open",
        labels.openPDF,
      );
      open.type = "button";
      open.addEventListener("click", () => {
        void options.onOpenEvidence?.(item.reference);
      });
      row.append(open);
    }
    list.append(row);
  }
  section.append(list);
  return section;
}

function renderClaimLedger(
  doc: Document,
  view: ResearchWorkspaceClaimLedgerView,
  options: ResearchWorkspaceArtifactRendererOptions,
) {
  const root = element(doc, "div", "pprw-render pprw-render--claim-ledger");
  const labels = claimLedgerLabels(options.responseLanguage);
  root.lang = labels.language;
  const overview = element(doc, "section", "pprw-claim-overview");
  const metrics = element(doc, "div", "pprw-claim-metrics");
  for (const [value, label, status] of [
    [view.summary.total, labels.claims, "total"],
    [view.summary.readyToCite, labels.readyToCite, "ready"],
    [view.summary.needsReview, labels.needsReview, "needs-review"],
    [view.summary.conflicting, labels.conflicting, "conflicting"],
  ] as const) {
    const item = element(doc, "div", "pprw-claim-metric");
    item.dataset.status = status;
    item.append(
      element(doc, "strong", "", String(value)),
      element(doc, "span", "", label),
    );
    metrics.append(item);
  }
  const guidance = element(doc, "div", "pprw-claim-guidance");
  guidance.append(
    element(doc, "p", "", labels.guidance),
    element(
      doc,
      "p",
      "pprw-claim-coverage",
      labels.evidenceSummary(
        view.summary.evidenceVerified,
        view.summary.evidenceTotal,
      ),
    ),
  );
  if (options.onCopyText) {
    const copy = element(
      doc,
      "button",
      "pprw-button pp-btn pp-btn--ghost pprw-claim-copy",
      labels.copyMarkdown,
    );
    copy.type = "button";
    copy.addEventListener("click", () => {
      copy.disabled = true;
      void Promise.resolve(
        options.onCopyText?.(claimLedgerMarkdown(view, labels)),
      )
        .then(() => {
          copy.textContent = labels.copied;
        })
        .catch(() => {
          copy.textContent = labels.copyFailed;
        })
        .finally(() => {
          copy.disabled = false;
        });
    });
    guidance.append(copy);
  }
  overview.append(metrics, guidance);
  root.append(overview);

  const controls = element(doc, "div", "pprw-claim-controls");
  const filterGroup = element(doc, "div", "pprw-claim-filters");
  filterGroup.setAttribute("role", "group");
  filterGroup.setAttribute("aria-label", labels.filters);
  const filterDefinitions: Array<{
    value: "all" | ResearchWorkspaceClaimReviewStatus;
    label: string;
  }> = [
    { value: "all", label: labels.all },
    { value: "ready", label: labels.ready },
    { value: "needs-review", label: labels.review },
    { value: "conflicting", label: labels.conflicts },
  ];
  const filterButtons = filterDefinitions.map((filter, index) => {
    const control = element(doc, "button", "pprw-claim-filter", filter.label);
    control.type = "button";
    control.dataset.filter = filter.value;
    control.setAttribute("aria-pressed", index === 0 ? "true" : "false");
    filterGroup.append(control);
    return control;
  });
  const typeLabel = element(doc, "label", "pprw-claim-type-control");
  typeLabel.append(
    element(doc, "span", "pp-visually-hidden", labels.claimType),
  );
  const typeSelect = element(doc, "select", "pprw-select pprw-claim-type");
  const claimKinds = [...new Set(view.claims.map((claim) => claim.claimKind))];
  for (const [value, label] of [
    ["all", labels.allTypes],
    ...claimKinds.map((kind) => [kind, localizedClaimKind(kind, labels)]),
  ]) {
    const option = element(doc, "option", "", label);
    option.value = value;
    typeSelect.append(option);
  }
  typeSelect.value = "all";
  typeLabel.append(typeSelect);
  controls.append(filterGroup, typeLabel);
  root.append(controls);

  const count = element(doc, "p", "pprw-claim-count");
  count.setAttribute("role", "status");
  count.setAttribute("aria-live", "polite");
  root.append(count);
  const list = element(doc, "div", "pprw-claim-list");
  const rows: Array<{
    node: HTMLDetailsElement;
    status: ResearchWorkspaceClaimReviewStatus;
    kind: string;
  }> = [];
  for (const [index, claim] of view.claims.entries()) {
    const item = element(doc, "details", "pprw-claim");
    item.dataset.status = claim.reviewStatus;
    item.dataset.claimKind = claim.claimKind;
    const summary = element(doc, "summary", "pprw-claim-summary");
    const number = element(
      doc,
      "span",
      "pprw-claim-number",
      String(index + 1).padStart(2, "0"),
    );
    const main = element(doc, "div", "pprw-claim-main");
    main.append(
      element(doc, "p", "pprw-claim-statement", claim.text),
      element(
        doc,
        "p",
        `pprw-claim-meta pprw-claim-meta--${claim.reviewStatus}`,
        `${localizedClaimKind(claim.claimKind, labels)} · ${localizedClaimStatus(claim.reviewStatus, labels)} · ${labels.evidenceSummary(claim.verifiedSupport, claim.evidenceTotal)}`,
      ),
    );
    summary.append(
      number,
      main,
      element(doc, "span", "pprw-claim-disclosure", labels.evidence),
    );
    const body = element(doc, "div", "pprw-claim-body");
    body.append(
      renderClaimEvidenceGroup(
        doc,
        labels.supportingEvidence,
        claim.support,
        labels,
        options,
      ),
    );
    if (claim.contradictions.length) {
      body.append(
        renderClaimEvidenceGroup(
          doc,
          labels.contradictingEvidence,
          claim.contradictions,
          labels,
          options,
        ),
      );
    }
    item.append(summary, body);
    list.append(item);
    rows.push({
      node: item,
      status: claim.reviewStatus,
      kind: claim.claimKind,
    });
  }
  const noMatches = element(
    doc,
    "p",
    "pprw-claim-no-matches",
    labels.noMatches,
  );
  noMatches.hidden = true;
  list.append(noMatches);
  if (!view.claims.length) {
    noMatches.hidden = false;
  }
  root.append(list);

  let activeFilter: "all" | ResearchWorkspaceClaimReviewStatus = "all";
  const updateFilters = () => {
    let visible = 0;
    for (const row of rows) {
      const matchesStatus =
        activeFilter === "all" || row.status === activeFilter;
      const matchesKind =
        typeSelect.value === "all" || row.kind === typeSelect.value;
      row.node.hidden = !(matchesStatus && matchesKind);
      if (!row.node.hidden) visible += 1;
    }
    for (const button of filterButtons) {
      button.setAttribute(
        "aria-pressed",
        button.dataset.filter === activeFilter ? "true" : "false",
      );
    }
    count.textContent = labels.showing(visible, view.summary.total);
    noMatches.hidden = visible > 0;
  };
  for (const button of filterButtons) {
    button.addEventListener("click", () => {
      activeFilter = button.dataset.filter as
        | "all"
        | ResearchWorkspaceClaimReviewStatus;
      updateFilters();
    });
  }
  typeSelect.addEventListener("change", updateFilters);
  updateFilters();
  return root;
}

function renderMethodology(
  doc: Document,
  view: ResearchWorkspaceMethodologyView,
  options: ResearchWorkspaceArtifactRendererOptions,
) {
  const root = element(doc, "div", "pprw-render pprw-render--methodology");
  const concerning = view.checks.filter((check) =>
    ["major", "critical"].includes(check.severity),
  ).length;
  const unclear = view.checks.filter((check) =>
    ["unsupported", "unclear"].includes(check.status),
  ).length;
  const metrics = element(doc, "div", "pprw-render-metrics");
  metrics.append(
    metric(doc, "Profile", humanize(view.profile)),
    metric(doc, "Checks", String(view.checks.length)),
    metric(doc, "Major or critical", String(concerning)),
    metric(doc, "Unsupported or unclear", String(unclear)),
  );
  root.append(
    metrics,
    element(doc, "p", "pprw-synthesis-answer", view.executiveSummary),
  );
  if (view.strengths.length) {
    root.append(renderStringList(doc, "Strengths", view.strengths));
  }
  const checks = element(doc, "section", "pprw-render-section");
  checks.append(element(doc, "h4", "", "Methodology checks"));
  const checkList = element(doc, "div", "pprw-render-card-list");
  for (const check of view.checks) {
    const card = element(doc, "article", "pprw-render-card");
    const metadata = element(doc, "div", "pprw-render-inline");
    metadata.append(
      badge(doc, humanize(check.status), statusTone(check.status)),
      badge(doc, humanize(check.severity), statusTone(check.severity)),
    );
    if (check.confidence !== undefined) {
      metadata.append(badge(doc, `Confidence ${percentage(check.confidence)}`));
    }
    card.append(
      element(doc, "h5", "", humanize(check.checkID)),
      metadata,
      element(doc, "p", "pprw-render-statement", check.finding),
      element(
        doc,
        "p",
        "pprw-render-note",
        `Why it matters: ${check.implication}`,
      ),
    );
    if (check.evidence.length) {
      card.append(renderEvidence(doc, check.evidence, options));
    }
    checkList.append(card);
  }
  checks.append(checkList);
  root.append(checks);
  if (view.experiments.length) {
    const section = element(doc, "section", "pprw-render-section");
    section.append(element(doc, "h4", "", "Discriminating experiments"));
    const list = element(doc, "div", "pprw-render-card-list");
    for (const experiment of view.experiments) {
      const card = element(doc, "article", "pprw-render-card");
      card.append(
        element(doc, "h5", "", experiment.hypothesis),
        element(doc, "p", "pprw-render-statement", experiment.experiment),
      );
      if (experiment.expectedOutcomes.length) {
        card.append(
          renderStringList(
            doc,
            "Expected outcomes",
            experiment.expectedOutcomes,
          ),
        );
      }
      if (experiment.evidence.length) {
        card.append(renderEvidence(doc, experiment.evidence, options));
      }
      list.append(card);
    }
    section.append(list);
    root.append(section);
  }
  if (view.residualUncertainty.length) {
    const uncertainty = renderStringList(
      doc,
      "Residual uncertainty",
      view.residualUncertainty,
    );
    uncertainty.classList.add("pprw-render-section--warning");
    root.append(uncertainty);
  }
  return root;
}

function renderReproducibility(
  doc: Document,
  view: ResearchWorkspaceReproducibilityView,
  options: ResearchWorkspaceArtifactRendererOptions,
) {
  const root = element(doc, "div", "pprw-render pprw-render--reproducibility");
  const metrics = element(doc, "div", "pprw-render-metrics");
  metrics.append(
    metric(doc, "Available", String(view.availability.available)),
    metric(doc, "Partial", String(view.availability.partial)),
    metric(doc, "Missing", String(view.availability.missing)),
    metric(doc, "Blockers", String(view.blockers.length)),
    metric(doc, "Estimated effort", humanize(view.estimatedEffort)),
  );
  root.append(
    metrics,
    element(doc, "p", "pprw-synthesis-answer", view.summary),
  );
  const artifactSection = element(doc, "section", "pprw-render-section");
  artifactSection.append(element(doc, "h4", "", "Required artifacts"));
  const artifactList = element(doc, "div", "pprw-render-card-list");
  for (const artifact of view.artifacts) {
    const card = element(doc, "article", "pprw-render-card");
    const metadata = element(doc, "div", "pprw-render-inline");
    metadata.append(
      badge(
        doc,
        humanize(artifact.availability),
        statusTone(artifact.availability),
      ),
      badge(doc, humanize(artifact.artifactKind), "accent"),
    );
    if (artifact.confidence !== undefined) {
      metadata.append(
        badge(doc, `Confidence ${percentage(artifact.confidence)}`),
      );
    }
    card.append(element(doc, "h5", "", artifact.label), metadata);
    for (const [label, value] of [
      ["Value", artifact.value],
      ["Version", artifact.version],
      ["Location", artifact.url],
      ["Notes", artifact.notes],
    ] as const) {
      if (value) {
        card.append(
          element(doc, "p", "pprw-render-note", `${label}: ${value}`),
        );
      }
    }
    if (artifact.evidence.length) {
      card.append(renderEvidence(doc, artifact.evidence, options));
    }
    artifactList.append(card);
  }
  artifactSection.append(artifactList);
  root.append(artifactSection);
  if (view.blockers.length) {
    const section = element(
      doc,
      "section",
      "pprw-render-section pprw-render-section--warning",
    );
    section.append(element(doc, "h4", "", "Reproduction blockers"));
    const list = element(doc, "div", "pprw-render-card-list");
    for (const blocker of view.blockers) {
      const card = element(doc, "article", "pprw-render-card");
      card.append(
        badge(doc, humanize(blocker.severity), statusTone(blocker.severity)),
        element(doc, "p", "pprw-render-statement", blocker.description),
        element(
          doc,
          "p",
          "pprw-render-note",
          `Mitigation: ${blocker.mitigation}`,
        ),
      );
      if (blocker.evidence.length) {
        card.append(renderEvidence(doc, blocker.evidence, options));
      }
      list.append(card);
    }
    section.append(list);
    root.append(section);
  }
  if (view.steps.length) {
    const section = element(doc, "section", "pprw-render-section");
    section.append(element(doc, "h4", "", "Reproduction workflow"));
    const list = element(doc, "div", "pprw-render-card-list");
    for (const step of view.steps) {
      const card = element(doc, "article", "pprw-render-card");
      card.append(element(doc, "h5", "", `${step.order}. ${step.title}`));
      if (step.inputs.length)
        card.append(renderStringList(doc, "Inputs", step.inputs));
      if (step.outputs.length)
        card.append(renderStringList(doc, "Outputs", step.outputs));
      if (step.assumptions.length)
        card.append(renderStringList(doc, "Assumptions", step.assumptions));
      if (step.unresolved.length)
        card.append(renderStringList(doc, "Unresolved", step.unresolved));
      if (step.evidence.length) {
        card.append(renderEvidence(doc, step.evidence, options));
      }
      list.append(card);
    }
    section.append(list);
    root.append(section);
  }
  if (view.minimalReproductionSteps.length) {
    root.append(
      renderStringList(
        doc,
        "Minimum viable reproduction",
        view.minimalReproductionSteps,
      ),
    );
  }
  if (view.verificationCommands.length) {
    const section = element(doc, "section", "pprw-render-section");
    section.append(
      element(doc, "h4", "", "Verification commands"),
      element(
        doc,
        "pre",
        "pprw-render-code",
        view.verificationCommands.join("\n"),
      ),
    );
    root.append(section);
  }
  return root;
}

function renderPaperToCode(
  doc: Document,
  view: ResearchWorkspacePaperToCodeView,
  options: ResearchWorkspaceArtifactRendererOptions,
) {
  const root = element(doc, "div", "pprw-render pprw-render--paper-to-code");
  root.append(
    element(doc, "p", "pprw-synthesis-answer", view.summary),
    element(doc, "p", "pprw-render-note", `Objective: ${view.objective}`),
  );
  if (view.inputs.length)
    root.append(renderStringList(doc, "Inputs", view.inputs));
  if (view.outputs.length)
    root.append(renderStringList(doc, "Outputs", view.outputs));
  const pseudocode = element(doc, "section", "pprw-render-section");
  pseudocode.append(
    element(doc, "h4", "", "Pseudocode"),
    element(doc, "pre", "pprw-render-code", view.pseudocode),
  );
  root.append(pseudocode);
  if (view.trace.length) {
    const section = element(doc, "section", "pprw-render-section");
    section.append(element(doc, "h4", "", "Execution trace"));
    const list = element(doc, "div", "pprw-render-card-list");
    for (const step of view.trace) {
      const card = element(doc, "article", "pprw-render-card");
      card.append(
        element(doc, "h5", "", `${step.order}. ${step.name}`),
        element(doc, "p", "pprw-render-statement", step.operation),
      );
      if (step.inputShapes.length || step.outputShapes.length) {
        const metadata = element(doc, "div", "pprw-render-inline");
        if (step.inputShapes.length) {
          metadata.append(badge(doc, `Input ${step.inputShapes.join(", ")}`));
        }
        if (step.outputShapes.length) {
          metadata.append(badge(doc, `Output ${step.outputShapes.join(", ")}`));
        }
        card.append(metadata);
      }
      if (step.stateChanges.length)
        card.append(renderStringList(doc, "State changes", step.stateChanges));
      if (step.memoryOrCommunication.length) {
        card.append(
          renderStringList(
            doc,
            "Memory and communication",
            step.memoryOrCommunication,
          ),
        );
      }
      if (step.invariants.length)
        card.append(renderStringList(doc, "Invariants", step.invariants));
      if (step.ambiguity.length)
        card.append(renderStringList(doc, "Ambiguity", step.ambiguity));
      if (step.evidence.length) {
        card.append(renderEvidence(doc, step.evidence, options));
      }
      list.append(card);
    }
    section.append(list);
    root.append(section);
  }
  const complexity = element(doc, "section", "pprw-render-section");
  complexity.append(element(doc, "h4", "", "Complexity"));
  const complexityMetrics = element(doc, "div", "pprw-render-metrics");
  complexityMetrics.append(
    metric(doc, "Compute", view.complexity.compute),
    metric(doc, "Memory", view.complexity.memory),
  );
  if (view.complexity.communication) {
    complexityMetrics.append(
      metric(doc, "Communication", view.complexity.communication),
    );
  }
  complexity.append(complexityMetrics);
  if (view.complexity.bottleneck) {
    complexity.append(
      element(
        doc,
        "p",
        "pprw-render-note",
        `Bottleneck: ${view.complexity.bottleneck}`,
      ),
    );
  }
  if (view.complexity.assumptions.length) {
    complexity.append(
      renderStringList(doc, "Assumptions", view.complexity.assumptions),
    );
  }
  if (view.complexity.evidence.length) {
    complexity.append(renderEvidence(doc, view.complexity.evidence, options));
  }
  root.append(complexity);
  if (view.invariants.length) {
    const section = element(doc, "section", "pprw-render-section");
    section.append(element(doc, "h4", "", "Implementation invariants"));
    const list = element(doc, "div", "pprw-render-card-list");
    for (const invariant of view.invariants) {
      const card = element(doc, "article", "pprw-render-card");
      card.append(
        element(doc, "p", "pprw-render-statement", invariant.statement),
      );
      if (invariant.consequence) {
        card.append(
          element(
            doc,
            "p",
            "pprw-render-note",
            `Consequence: ${invariant.consequence}`,
          ),
        );
      }
      if (invariant.evidence.length) {
        card.append(renderEvidence(doc, invariant.evidence, options));
      }
      list.append(card);
    }
    section.append(list);
    root.append(section);
  }
  if (view.ambiguities.length) {
    const section = element(
      doc,
      "section",
      "pprw-render-section pprw-render-section--warning",
    );
    section.append(element(doc, "h4", "", "Implementation ambiguities"));
    const list = element(doc, "div", "pprw-render-card-list");
    for (const ambiguity of view.ambiguities) {
      const card = element(doc, "article", "pprw-render-card");
      card.append(
        badge(
          doc,
          `${humanize(ambiguity.impact)} impact`,
          statusTone(ambiguity.impact),
        ),
        element(doc, "p", "pprw-render-statement", ambiguity.question),
        element(
          doc,
          "p",
          "pprw-render-note",
          `How to resolve: ${ambiguity.proposedExperiment}`,
        ),
      );
      if (ambiguity.likelyChoices.length) {
        card.append(
          renderStringList(doc, "Likely choices", ambiguity.likelyChoices),
        );
      }
      if (ambiguity.evidence.length) {
        card.append(renderEvidence(doc, ambiguity.evidence, options));
      }
      list.append(card);
    }
    section.append(list);
    root.append(section);
  }
  if (view.divergences.length) {
    const section = element(doc, "section", "pprw-render-section");
    section.append(element(doc, "h4", "", "Paper–code divergences"));
    const list = element(doc, "div", "pprw-render-card-list");
    for (const divergence of view.divergences) {
      const card = element(doc, "article", "pprw-render-card");
      card.append(
        element(doc, "h5", "", divergence.area),
        element(
          doc,
          "p",
          "pprw-render-note",
          `Paper: ${divergence.paperStatement}`,
        ),
        element(
          doc,
          "p",
          "pprw-render-note",
          `Code: ${divergence.codeBehavior}`,
        ),
        element(
          doc,
          "p",
          "pprw-render-statement",
          `Impact: ${divergence.impact}`,
        ),
      );
      if (divergence.evidence.length) {
        card.append(renderEvidence(doc, divergence.evidence, options));
      }
      list.append(card);
    }
    section.append(list);
    root.append(section);
  }
  if (view.checklist.length) {
    root.append(
      renderStringList(doc, "Implementation checklist", view.checklist),
    );
  }
  if (view.tests.length) {
    const section = element(doc, "section", "pprw-render-section");
    section.append(element(doc, "h4", "", "Validation tests"));
    const list = element(doc, "div", "pprw-render-card-list");
    for (const test of view.tests) {
      const card = element(doc, "article", "pprw-render-card");
      card.append(
        element(doc, "h5", "", test.name),
        element(doc, "p", "pprw-render-statement", test.purpose),
      );
      if (test.setup)
        card.append(
          element(doc, "p", "pprw-render-note", `Setup: ${test.setup}`),
        );
      if (test.expected) {
        card.append(
          element(doc, "p", "pprw-render-note", `Expected: ${test.expected}`),
        );
      }
      list.append(card);
    }
    section.append(list);
    root.append(section);
  }
  return root;
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

function renderCitationHealth(
  doc: Document,
  view: ResearchWorkspaceCitationHealthView,
  options: ResearchWorkspaceArtifactRendererOptions,
) {
  const root = element(doc, "div", "pprw-render pprw-render--citation-health");
  const metrics = element(doc, "div", "pprw-render-metrics");
  metrics.append(
    metric(doc, "Current inputs", String(view.coverage.admittedArtifacts)),
    metric(doc, "Citation contexts", String(view.coverage.citationContexts)),
    metric(doc, "Stance results", String(view.coverage.citationStances)),
    metric(doc, "Local library items", String(view.coverage.localLibraryItems)),
    metric(doc, "Metadata signals", String(view.coverage.localMetadataSignals)),
    metric(
      doc,
      "Draft coverage candidates",
      `${view.coverage.unsupportedDraftCandidates}/${view.coverage.draftStatements}`,
    ),
  );
  root.append(
    metrics,
    element(
      doc,
      "p",
      "pprw-render-note",
      "This is a review checklist, not an aggregate truth or scientific-quality score. Local and optional external signals require inspection of the cited work and primary metadata.",
    ),
    element(
      doc,
      "p",
      "pprw-render-note",
      `Local metadata ${view.provenance.localMetadataVersion} observed ${view.provenance.localMetadataObservedAt} · fingerprint ${view.provenance.localMetadataFingerprint}${view.provenance.localMetadataTruncated ? " · bounded item scan" : ""}`,
    ),
  );
  if (view.provenance.externalProvider) {
    const provider = view.provenance.externalProvider;
    root.append(
      element(
        doc,
        "p",
        "pprw-render-note",
        `${provider.provider} observed ${provider.observedAt} · ${provider.identifiersCovered}/${provider.identifiersChecked} identifiers covered · ${provider.signalCount} signals · fingerprint ${provider.fingerprint}`,
      ),
    );
  }

  if (view.draft) {
    const section = element(doc, "section", "pprw-render-section");
    section.append(
      element(
        doc,
        "h4",
        "",
        view.draft.name
          ? `Imported draft · ${view.draft.name}`
          : "Imported draft",
      ),
      element(
        doc,
        "p",
        "pprw-render-note",
        `${view.draft.analyzedCharacters.toLocaleString()} of ${view.draft.sourceCharacters.toLocaleString()} characters analyzed · fingerprint ${view.draft.fingerprint}${view.draft.truncated ? " · bounded" : ""}`,
      ),
    );
    if (view.draft.excerpt) {
      section.append(
        element(doc, "p", "pprw-render-statement", view.draft.excerpt),
      );
    }
    root.append(section);
  }

  const groups = new Map<string, typeof view.findings>();
  for (const item of view.findings) {
    const entries = groups.get(item.kind) ?? [];
    entries.push(item);
    groups.set(item.kind, entries);
  }
  for (const kind of [...groups.keys()].sort()) {
    const section = element(doc, "section", "pprw-render-section");
    section.append(element(doc, "h4", "", humanize(kind)));
    const list = element(doc, "div", "pprw-render-card-list");
    for (const item of groups.get(kind) ?? []) {
      const card = element(doc, "article", "pprw-render-card");
      card.dataset.findingId = item.findingID;
      const metadata = element(doc, "div", "pprw-render-inline");
      metadata.append(
        badge(
          doc,
          humanize(item.severity),
          item.severity === "high"
            ? "warning"
            : item.severity === "info"
              ? "success"
              : "accent",
        ),
        badge(
          doc,
          `${item.sourceCount} source${item.sourceCount === 1 ? "" : "s"}`,
        ),
        badge(
          doc,
          `${item.contextCount} context${item.contextCount === 1 ? "" : "s"}`,
        ),
      );
      card.append(
        metadata,
        element(doc, "h5", "", item.title),
        element(doc, "p", "pprw-render-statement", item.summary),
      );
      if (item.referenceIdentity) {
        card.append(
          element(
            doc,
            "p",
            "pprw-render-note",
            `Reference identity: ${item.referenceIdentity}`,
          ),
        );
      }
      if (item.localItem) {
        card.append(element(doc, "p", "pprw-render-note", item.localItem));
      }
      if (item.draftExcerpt && item.draftExcerpt !== item.summary) {
        card.append(
          element(
            doc,
            "p",
            "pprw-render-note",
            `Draft excerpt: ${item.draftExcerpt}`,
          ),
        );
      }
      if (item.evidence.length) {
        card.append(renderEvidence(doc, item.evidence, options));
      }
      if (item.limitations.length) {
        card.append(renderStringList(doc, "Review boundary", item.limitations));
      }
      list.append(card);
    }
    section.append(list);
    root.append(section);
  }
  if (!view.findings.length) {
    root.append(
      element(
        doc,
        "p",
        "pprw-muted",
        "No checklist finding was produced from the admitted saved artifacts and local metadata. This does not prove that no citation or reference issue exists.",
      ),
    );
  }
  if (view.limitations.length) {
    const limitations = renderStringList(
      doc,
      "Coverage and interpretation limits",
      view.limitations,
    );
    limitations.classList.add("pprw-render-section--warning");
    root.append(limitations);
  }
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
  if (view.kind === "claim-ledger") {
    return renderClaimLedger(doc, view, options);
  }
  if (view.kind === "methodology") {
    return renderMethodology(doc, view, options);
  }
  if (view.kind === "reproducibility") {
    return renderReproducibility(doc, view, options);
  }
  if (view.kind === "paper-to-code") {
    return renderPaperToCode(doc, view, options);
  }
  if (view.kind === "matrix") return renderMatrix(doc, view, options);
  if (view.kind === "graph") return renderGraph(doc, view, options);
  if (view.kind === "synthesis") return renderSynthesis(doc, view, options);
  if (view.kind === "mastery") return renderMastery(doc, view, options);
  if (view.kind === "citation") return renderCitation(doc, view, options);
  if (view.kind === "citation-health") {
    return renderCitationHealth(doc, view, options);
  }
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
