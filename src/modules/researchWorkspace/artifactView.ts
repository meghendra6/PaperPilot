import { formatEvidenceLocator } from "./core/evidence/types";
import type { ResearchWorkspaceArtifactType } from "./persistence/contracts";

export type UnknownRecord = Record<string, unknown>;

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

export function record(value: unknown): UnknownRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : undefined;
}

function finite(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

export function text(value: unknown, fallback = "—"): string {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value))
    return value.map((entry) => text(entry, "")).join("; ");
  if (typeof value === "object") return fallback;
  return String(value);
}

export function humanize(value: string) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/^./, (character) => character.toUpperCase());
}

export function isEvidence(value: unknown): value is UnknownRecord {
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

export function evidenceViews(value: unknown): ResearchWorkspaceEvidenceView[] {
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
