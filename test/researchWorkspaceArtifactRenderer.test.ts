import { test } from "node:test";
import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  createResearchWorkspaceClaimLedgerMarkdown,
  createResearchWorkspaceArtifactView,
  createResearchWorkspacePublicPayload,
  renderResearchWorkspaceArtifactValue,
} from "../src/modules/researchWorkspace/artifactRenderer";

class FakeClassList {
  constructor(private readonly owner: FakeElement) {}

  add(...tokens: string[]) {
    const classes = new Set(this.owner.className.split(/\s+/).filter(Boolean));
    for (const token of tokens) classes.add(token);
    this.owner.className = [...classes].join(" ");
  }
}

class FakeElement {
  readonly children: FakeElement[] = [];
  readonly classList = new FakeClassList(this);
  private readonly attributes = new Map<string, string>();
  private readonly listeners = new Map<string, Array<() => void>>();
  className = "";
  textContent = "";
  type = "";
  scope = "";
  value = "";
  lang = "";
  hidden = false;
  disabled = false;
  readonly dataset: Record<string, string> = {};

  constructor(readonly tagName: string) {}

  get childElementCount() {
    return this.children.length;
  }

  append(...nodes: FakeElement[]) {
    this.children.push(...nodes);
  }

  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }

  getAttribute(name: string) {
    return this.attributes.get(name) ?? null;
  }

  addEventListener(name: string, listener: () => void) {
    const listeners = this.listeners.get(name) ?? [];
    listeners.push(listener);
    this.listeners.set(name, listeners);
  }

  dispatch(name: string) {
    for (const listener of this.listeners.get(name) ?? []) listener();
  }

  click() {
    this.dispatch("click");
  }
}

class FakeDocument {
  createElementNS(_namespace: string, tag: string) {
    return new FakeElement(tag);
  }
}

function tags(root: FakeElement): string[] {
  return [root.tagName, ...root.children.flatMap(tags)];
}

function renderedText(root: FakeElement): string {
  return [root.textContent, ...root.children.map(renderedText)].join(" ");
}

function withClass(root: FakeElement, className: string): FakeElement[] {
  const matches = root.className.split(/\s+/).includes(className) ? [root] : [];
  return [
    ...matches,
    ...root.children.flatMap((child) => withClass(child, className)),
  ];
}

const evidence = {
  sourceID: "SOURCE-1",
  libraryID: 1,
  attachmentKey: "PDF-1",
  pageIndex: 2,
  pageLabel: "3",
  sectionPath: ["Methods"],
  exactQuote: "The measured result supports the claim.",
  verification: { status: "verified" },
};

test("Claim Ledger prioritizes locally checked evidence over the model-reported status", () => {
  const payload = {
    schemaVersion: 1,
    paperKey: "zotero:1:SOURCE-1:PDF-1",
    claims: [
      {
        id: "C01",
        text: "The proposed method reduces decoding latency.",
        kind: "empirical_result",
        confidence: 0.92,
        verificationStatus: "verified",
        support: [evidence],
        contradictions: [],
        createdAt: "2026-09-01T00:00:00.000Z",
      },
      {
        id: "C02",
        text: "The result generalizes to unseen hardware.",
        kind: "reader_inference",
        confidence: 0.4,
        verificationStatus: "verified",
        support: [
          {
            ...evidence,
            pageIndex: 4,
            pageLabel: "5",
            exactQuote: "Generalization was not evaluated.",
            verification: {
              status: "source-unavailable",
              detail: "The exact local PDF source could not be loaded.",
            },
          },
        ],
        contradictions: [],
      },
    ],
    revision: 2,
  };
  const view = createResearchWorkspaceArtifactView(payload);
  assert.equal(view.kind, "claim-ledger");
  if (view.kind !== "claim-ledger") return;
  assert.deepEqual(view.summary, {
    total: 2,
    readyToCite: 1,
    needsReview: 1,
    conflicting: 0,
    evidenceTotal: 2,
    evidenceVerified: 1,
  });
  assert.equal(view.claims[1].reviewStatus, "needs-review");

  const rendered = renderResearchWorkspaceArtifactValue(
    new FakeDocument() as unknown as Document,
    payload,
    { artifactType: "claim-ledger" },
  ) as unknown as FakeElement;
  const visible = renderedText(rendered);
  assert.match(visible, /The proposed method reduces decoding latency/);
  assert.match(visible, /Empirical result/);
  assert.match(visible, /Ready to cite/);
  assert.match(visible, /Supporting evidence.*1/);
  assert.match(visible, /Locally checked.*Page 3/);
  assert.match(visible, /The measured result supports the claim/);
  assert.match(visible, /Source unavailable.*Page 5/);
  assert(tags(rendered).includes("details"));
  assert(tags(rendered).includes("summary"));
  assert(tags(rendered).includes("blockquote"));
  assert.doesNotMatch(visible, /Confidence 92%|Confidence 40%/);
  assert.doesNotMatch(
    visible,
    /schemaVersion|paperKey|attachmentKey|verificationStatus|createdAt/,
  );

  const reviewFilter = withClass(rendered, "pprw-claim-filter").find(
    (node) => node.textContent === "Review needed",
  );
  assert(reviewFilter);
  reviewFilter.click();
  const claims = withClass(rendered, "pprw-claim");
  assert.equal(claims[0].hidden, true);
  assert.equal(claims[1].hidden, false);
});

test("Claim Ledger localizes Korean review labels and copies readable Markdown", async () => {
  const payload = {
    paperKey: "zotero:1:SOURCE-1:PDF-1",
    claims: [
      {
        id: "C01",
        text: "Speculative decoding은 target model의 최종 결정권을 유지한다.",
        kind: "author_claim",
        confidence: 0.99,
        verificationStatus: "verified",
        support: [
          {
            ...evidence,
            verification: {
              status: "source-unavailable",
              detail: "The exact local PDF source could not be loaded.",
            },
          },
        ],
        contradictions: [],
      },
    ],
  };
  let copied = "";
  const rendered = renderResearchWorkspaceArtifactValue(
    new FakeDocument() as unknown as Document,
    payload,
    {
      artifactType: "claim-ledger",
      onCopyText: (value) => {
        copied = value;
      },
    },
  ) as unknown as FakeElement;
  const visible = renderedText(rendered);
  assert.equal(rendered.lang, "ko");
  assert.match(visible, /전체 주장/);
  assert.match(visible, /확인 필요/);
  assert.match(visible, /원본 접근 불가/);
  assert.match(visible, /정확한 로컬 PDF 원본을 불러오지 못했습니다/);
  assert.doesNotMatch(
    visible,
    /The exact local PDF source could not be loaded/,
  );
  assert.doesNotMatch(visible, /Verified|Confidence 99%/);

  const copy = withClass(rendered, "pprw-claim-copy")[0];
  assert(copy);
  copy.click();
  await Promise.resolve();
  assert.match(copied, /^# 주장–근거 검토표/m);
  assert.match(copied, /## 1\. Speculative decoding/);
  assert.match(copied, /> The measured result supports the claim/);
  assert.match(copied, /정확한 로컬 PDF 원본을 불러오지 못했습니다/);
  assert.doesNotMatch(copied, /schemaVersion|attachmentKey|confidence/);

  assert.equal(createResearchWorkspaceClaimLedgerMarkdown(payload), copied);
});

test("Methodology Audit renders a summary, review checks, and implications", () => {
  const payload = {
    kind: "methodology-audit",
    detection: { primary: "empirical_ml" },
    report: {
      profile: "empirical_ml",
      executiveSummary: "The evaluation is informative but narrowly scoped.",
      strengths: ["Ablations isolate the main mechanism."],
      checks: [
        {
          checkId: "evaluation_scope",
          status: "partial",
          severity: "major",
          finding: "Only one hardware family was tested.",
          implication: "Latency gains may not transfer to other accelerators.",
          confidence: 0.85,
          evidence: [evidence],
        },
      ],
      discriminatingExperiments: [
        {
          hypothesis: "The gain is hardware dependent.",
          experiment: "Repeat the benchmark on a second accelerator family.",
          expectedOutcomes: ["Similar gain", "Reduced gain"],
          evidence: [],
        },
      ],
      residualUncertainty: ["Compiler effects remain unclear."],
    },
  };
  const rendered = renderResearchWorkspaceArtifactValue(
    new FakeDocument() as unknown as Document,
    payload,
    { artifactType: "methodology-audit" },
  ) as unknown as FakeElement;
  const visible = renderedText(rendered);
  assert.match(visible, /informative but narrowly scoped/);
  assert.match(visible, /Evaluation scope/);
  assert.match(visible, /Why it matters: Latency gains/);
  assert.match(visible, /Discriminating experiments/);
  assert.doesNotMatch(visible, /executiveSummary|checkId|attachmentKey/);
});

test("Reproducibility renders artifacts, blockers, steps, and commands semantically", () => {
  const payload = {
    summary: "The paper is partially reproducible from the disclosed assets.",
    estimatedEffort: "medium",
    artifacts: [
      {
        kind: "code",
        label: "Reference implementation",
        availability: "available",
        url: "https://example.test/code",
        confidence: 0.9,
        evidence: [evidence],
      },
      {
        kind: "random_seeds",
        label: "Random seeds",
        availability: "missing",
        confidence: 0.8,
        evidence: [],
      },
    ],
    blockers: [
      {
        severity: "major",
        description: "Random seeds are not reported.",
        mitigation: "Publish the seeds used for the main table.",
        evidence: [],
      },
    ],
    steps: [
      {
        order: 1,
        title: "Install dependencies",
        inputs: ["environment.yml"],
        outputs: ["runtime environment"],
        assumptions: [],
        unresolved: [],
        evidence: [],
      },
    ],
    minimumViableReproduction: ["Run the public evaluation script."],
    verificationChecks: ["python -m pytest tests/eval_test.py"],
  };
  const view = createResearchWorkspaceArtifactView(payload, "reproducibility");
  assert.equal(view.kind, "reproducibility");
  if (view.kind !== "reproducibility") return;
  assert.equal(view.availability.available, 1);
  assert.equal(view.availability.missing, 1);

  const rendered = renderResearchWorkspaceArtifactValue(
    new FakeDocument() as unknown as Document,
    payload,
    { artifactType: "reproducibility" },
  ) as unknown as FakeElement;
  const visible = renderedText(rendered);
  assert.match(visible, /partially reproducible/);
  assert.match(visible, /Reference implementation/);
  assert.match(visible, /Reproduction blockers/);
  assert.match(visible, /python -m pytest/);
  assert.doesNotMatch(
    visible,
    /estimatedEffort|verificationChecks|attachmentKey/,
  );
});

test("Paper-to-Code renders an implementation map instead of field names", () => {
  const payload = {
    objective: "Implement exact speculative sampling.",
    summary: "Verify a drafted block with one target-model call.",
    inputs: ["prefix tokens", "draft tokens"],
    outputs: ["committed tokens"],
    pseudocode: "draft <- proposer(prefix)\nverified <- target(draft)",
    trace: [
      {
        order: 1,
        name: "Draft",
        operation: "Generate candidate tokens.",
        inputShapes: ["[batch, prefix]"],
        outputShapes: ["[batch, gamma]"],
        stateReads: ["KV cache"],
        stateWrites: ["draft buffer"],
        memoryOrCommunication: ["Read proposer weights"],
        invariants: ["Preserve token order"],
        ambiguity: [],
        evidence: [evidence],
      },
    ],
    invariants: [
      {
        statement: "Committed tokens follow target probabilities.",
        consequence: "Violating this changes the output distribution.",
        evidence: [evidence],
      },
    ],
    complexity: {
      compute: "One proposer pass plus one target pass",
      memory: "KV cache plus draft buffer",
      assumptions: ["The target validates the full block."],
      evidence: [evidence],
    },
    ambiguities: [
      {
        question: "How are ties broken?",
        impact: "high",
        likelyChoices: ["Stable vocabulary order"],
        proposedExperiment: "Compare outputs on tied logits.",
        evidence: [],
      },
    ],
    paperCodeDivergences: [],
    minimalReproduction: ["Implement the acceptance rule."],
    tests: [
      {
        name: "distribution-test",
        purpose: "Compare sampled frequencies.",
        setup: "Fixed prompt set",
        expected: "No significant distribution shift",
      },
    ],
  };
  const rendered = renderResearchWorkspaceArtifactValue(
    new FakeDocument() as unknown as Document,
    payload,
    { artifactType: "paper-to-code" },
  ) as unknown as FakeElement;
  const visible = renderedText(rendered);
  assert.match(visible, /Verify a drafted block/);
  assert.match(visible, /Execution trace/);
  assert.match(visible, /How are ties broken/);
  assert.match(visible, /distribution-test/);
  assert.doesNotMatch(visible, /paperCodeDivergences|stateReads|attachmentKey/);
});

test("Evidence Matrix view preserves columns, rows, coverage, and cell evidence", () => {
  const view = createResearchWorkspaceArtifactView(
    {
      matrix: {
        columns: [
          { id: "method", label: "Method" },
          { id: "result", label: "Primary result" },
        ],
        rows: [
          {
            paperKey: "SOURCE-1",
            title: "Paper One",
            cells: [
              {
                columnId: "method",
                displayValue: "Method A",
                status: "extracted",
                confidence: 0.8,
                evidence: [
                  {
                    sourceID: "SOURCE-1",
                    attachmentKey: "PDF-1",
                    pageIndex: 2,
                    verification: { status: "verified" },
                  },
                ],
              },
            ],
          },
        ],
      },
      coverage: {
        extractionCoverage: 0.5,
        evidenceCoverage: 1,
        requiredEvidenceCoverage: 0.5,
      },
    },
    "evidence-matrix",
  );
  assert.equal(view.kind, "matrix");
  if (view.kind !== "matrix") return;
  assert.deepEqual(
    view.columns.map((column) => column.label),
    ["Method", "Primary result"],
  );
  assert.equal(view.rows[0].cells[0].evidence[0].status, "verified");
  assert.equal(view.coverage?.extraction, 0.5);

  const rendered = renderResearchWorkspaceArtifactValue(
    new FakeDocument() as unknown as Document,
    {
      matrix: {
        columns: [{ id: "method", label: "Method" }],
        rows: [
          {
            paperKey: "SOURCE-1",
            title: "Paper One",
            cells: [
              {
                columnId: "method",
                value: "Method A",
                status: "extracted",
                evidence: [],
              },
            ],
          },
        ],
      },
    },
    { artifactType: "evidence-matrix" },
  ) as unknown as FakeElement;
  assert(tags(rendered).includes("table"));
  assert(!tags(rendered).includes("pre"));
});

test("Relationship Graph view distinguishes verified and inferred edges", () => {
  const view = createResearchWorkspaceArtifactView(
    {
      nodes: [
        { id: "a", label: "Paper A" },
        { id: "b", label: "Paper B" },
        { id: "m", label: "Method" },
      ],
      edges: [
        {
          id: "verified",
          source: "a",
          target: "b",
          kind: "extends",
          provenance: "local-evidence",
          evidence: [],
        },
        {
          id: "inferred",
          source: "a",
          target: "m",
          kind: "uses",
          provenance: "inferred",
          evidence: [],
        },
      ],
    },
    "relationship-graph",
  );
  assert.equal(view.kind, "graph");
  if (view.kind !== "graph") return;
  assert.equal(view.nodeCount, 3);
  assert.equal(view.verifiedEdgeCount, 1);
  assert.equal(view.inferredEdgeCount, 1);
  assert.equal(view.edges[0].source, "Paper A");
});

test("Screening review log renders semantic metrics and history", () => {
  const payload = {
    kind: "research-workspace-review-log",
    summary: {
      total: 1,
      include: 1,
      exclude: 0,
      maybe: 0,
      unreviewed: 0,
      decisions: 2,
      duplicateSignals: 1,
      missingPDFSignals: 0,
    },
    rows: [
      {
        sourceID: "SOURCE-1",
        title: "Paper One",
        current: {
          decision: "include",
          stage: "full-text",
          decidedAt: "2026-08-30T01:00:00.000Z",
          reason: { text: "Meets the protocol" },
        },
        history: [{ eventID: "event-1" }, { eventID: "event-2" }],
        issues: [{ kind: "duplicate" }],
      },
    ],
    limitations: ["Signals require reviewer confirmation."],
  };
  const view = createResearchWorkspaceArtifactView(payload, "review-log");
  assert.equal(view.kind, "review-log");
  if (view.kind !== "review-log") return;
  assert.equal(view.rows[0].decision, "include");
  assert.equal(view.rows[0].historyCount, 2);
  assert.equal(view.summary.decisions, 2);

  const rendered = renderResearchWorkspaceArtifactValue(
    new FakeDocument() as unknown as Document,
    payload,
    { artifactType: "review-log" },
  ) as unknown as FakeElement;
  assert(tags(rendered).includes("table"));
  assert(!tags(rendered).includes("pre"));
  assert.match(renderedText(rendered), /Meets the protocol/);
  assert.match(renderedText(rendered), /Signals require reviewer confirmation/);
});

test("contradiction dashboard renders semantic comparisons without raw JSON", () => {
  const payload = {
    kind: "research-workspace-contradiction-gap-dashboard",
    atoms: [
      {
        atomID: "fact-1",
        evidence: [
          {
            sourceID: "SOURCE-1",
            attachmentKey: "PDF-1",
            pageIndex: 2,
            verification: { status: "verified" },
          },
        ],
      },
    ],
    supportGroups: [],
    relationships: [
      {
        relationshipID: "relationship-1",
        topic: "Opposite outcome directions",
        classification: "direct-contradiction",
        reviewState: "unreviewed",
        comparability: { status: "comparable" },
        sides: [
          { position: "Increased", atomIDs: ["fact-1"] },
          { position: "Decreased", atomIDs: ["fact-1"] },
        ],
        limitations: ["Current project snapshot only."],
      },
    ],
    gaps: [
      {
        kind: "missing-reporting",
        statement: "Replication was not assessed.",
        sourceIDs: ["SOURCE-1"],
      },
    ],
    nextSearchQuestions: ["Which replication evidence is available?"],
    coverage: {
      includedSources: 1,
      admittedArtifacts: 1,
      verifiedFactAtoms: 1,
      multiSourceSupport: 0,
      directContradictions: 1,
      nonComparable: 0,
      uncertain: 0,
      gaps: 1,
    },
    limitations: ["Not a truth verdict."],
  };
  const rendered = renderResearchWorkspaceArtifactValue(
    new FakeDocument() as unknown as Document,
    payload,
    { artifactType: "contradiction-gap-dashboard" },
  ) as unknown as FakeElement;
  assert(!tags(rendered).includes("pre"));
  assert.match(
    renderedText(rendered),
    /Rule-detected contradiction candidates/,
  );
  assert.match(renderedText(rendered), /Replication was not assessed/);
  assert.match(renderedText(rendered), /Verified/);
});

test("Project synthesis view exposes coverage, evidence groups, and warnings", () => {
  const view = createResearchWorkspaceArtifactView(
    {
      answer: "The methods agree on the main mechanism.",
      claims: [
        {
          statement: "Shared mechanism",
          support: "verified",
          sourceIDs: ["S1", "S2"],
          evidence: [],
        },
      ],
      agreements: [],
      contradictions: [
        {
          statement: "Evaluation scope differs",
          support: "inferred",
          sourceIDs: ["S1", "S2"],
          evidence: [],
        },
      ],
      unresolvedUncertainty: ["No common benchmark"],
      freshnessWarnings: ["Paper S2 changed"],
      coverage: {
        analyzedSources: 2,
        totalProjectSources: 3,
        excludedSources: [{ sourceID: "S3", reason: "Not in snapshot" }],
        contextPlan: { insufficientCoverage: true },
      },
    },
    "synthesis",
  );
  assert.equal(view.kind, "synthesis");
  if (view.kind !== "synthesis") return;
  assert.equal(view.groups.length, 2);
  assert.equal(view.coverage?.excludedSources, 1);
  assert.equal(view.coverage?.insufficient, true);
  assert.deepEqual(view.freshnessWarnings, ["Paper S2 changed"]);
});

test("Cross-paper mastery renders learner progress without leaking an unanswered rubric", () => {
  const payload = {
    session: {
      schemaVersion: 2,
      revision: 1,
      state: "awaiting-answer",
      sourceSnapshot: [{ sourceID: "S1" }, { sourceID: "S2" }],
      questions: [
        {
          id: "Q1",
          prompt: "Compare the mechanisms.",
          mode: "compare",
          difficulty: "advanced",
          paperKeys: ["S1", "S2"],
          rubric: [
            {
              id: "mechanism",
              expectedClaims: ["HIDDEN EXPECTED CLAIM"],
            },
          ],
          criteria: [{ requiredClaims: ["HIDDEN REQUIRED CLAIM"] }],
        },
      ],
      attempts: [],
    },
    question: {
      id: "Q1",
      prompt: "Compare the mechanisms.",
      mode: "compare",
      difficulty: "advanced",
      paperKeys: ["S1", "S2"],
      rubric: [{ expectedClaims: ["HIDDEN EXPECTED CLAIM"] }],
    },
    summary: {
      answerQuality: 0.75,
      calibration: 0.85,
      conceptCoverage: 0.5,
      openMisconceptions: ["Boundary condition"],
      nextReviewAt: "2026-09-01T00:00:00.000Z",
    },
  };
  const view = createResearchWorkspaceArtifactView(
    payload,
    "cross-paper-mastery",
  );
  assert.equal(view.kind, "mastery");
  if (view.kind !== "mastery") return;
  assert.equal(view.currentQuestion?.prompt, "Compare the mechanisms.");
  assert.equal(view.sourceCount, 2);

  const rendered = renderResearchWorkspaceArtifactValue(
    new FakeDocument() as unknown as Document,
    payload,
    { artifactType: "cross-paper-mastery" },
  ) as unknown as FakeElement;
  const visibleText = renderedText(rendered);
  assert.match(visibleText, /Compare the mechanisms/);
  assert.doesNotMatch(
    visibleText,
    /HIDDEN EXPECTED CLAIM|HIDDEN REQUIRED CLAIM/,
  );

  const exported = createResearchWorkspacePublicPayload(
    payload,
    "cross-paper-mastery",
  ) as typeof payload;
  assert.equal(exported.session.questions[0].rubric, undefined);
  assert.equal(exported.session.questions[0].criteria, undefined);
  assert.equal(exported.question.rubric, undefined);
});

test("Citation view exposes exact sentence, local page, resolution, and stance limits", () => {
  const value = {
    contexts: [
      {
        id: "C1",
        exactSentence: "Paper A reports a conflicting outcome [2].",
        context: "Before. Paper A reports a conflicting outcome [2]. After.",
        marker: "[2]",
        pageIndex: 4,
        reference: { raw: "Doe (2020). Paper B." },
        resolution: {
          status: "resolved",
          method: "project-title",
          title: "Paper B",
        },
        evidence: [],
      },
    ],
    results: [
      {
        contextId: "C1",
        stance: "contrasting",
        confidence: 0.8,
        rationale: "The outcome conflicts.",
        limitations: ["One local sentence"],
      },
    ],
    coverage: {
      sourcesAnalyzed: 2,
      contextsExtracted: 1,
      resolved: 1,
      ambiguous: 0,
      unresolved: 0,
      pageLocated: 1,
      submittedToModel: 1,
      analyzedContexts: 1,
      limitations: [],
    },
    corrections: [],
  };
  const view = createResearchWorkspaceArtifactView(value, "citation-stance");
  assert.equal(view.kind, "citation");
  if (view.kind !== "citation") return;
  assert.equal(view.rows[0].pageIndex, 4);
  assert.equal(view.rows[0].resolutionStatus, "resolved");
  assert.equal(view.rows[0].stance, "contrasting");
  const rendered = renderResearchWorkspaceArtifactValue(
    new FakeDocument() as unknown as Document,
    value,
    { artifactType: "citation-stance" },
  ) as unknown as FakeElement;
  assert.match(renderedText(rendered), /Page 5/);
  assert.match(renderedText(rendered), /review signal, not a verdict/i);
});

test("Citation Health renders a semantic checklist without an aggregate score or raw JSON", () => {
  const value = {
    kind: "research-workspace-citation-health",
    localMetadata: {
      version: "zotero-citation-health-metadata-v1",
      observedAt: "2026-08-30T03:00:00.000Z",
      fingerprint: "citation-health-local-metadata-12345678-20",
      libraryIDs: [1],
      itemCount: 120,
      truncated: false,
    },
    findings: [
      {
        findingID: "citation-health-1",
        kind: "local-correction-retraction-signal",
        severity: "high",
        title: "Local Zotero metadata contains a retraction signal",
        summary: "Retraction notice recorded in Extra.",
        sourceIDs: ["SOURCE-1"],
        contextIDs: ["CONTEXT-1"],
        referenceIdentity: "doi:10.1000/example",
        localItem: {
          libraryID: 1,
          itemKey: "ITEM-1",
          title: "Example paper",
        },
        evidence: [],
        limitations: ["Verify the publisher record."],
      },
      {
        findingID: "citation-health-2",
        kind: "unsupported-draft-statement",
        severity: "review",
        title: "No matching support was found",
        summary: "The draft claims a 99% improvement [7].",
        sourceIDs: [],
        contextIDs: [],
        draftStatement: {
          excerpt: "The draft claims a 99% improvement [7].",
          offset: 10,
        },
        evidence: [],
        limitations: ["Bounded lexical coverage check only."],
      },
    ],
    draft: {
      name: "draft.md",
      fingerprint: "draft-12345678-20",
      excerpt: "The draft claims a 99% improvement [7].",
      sourceCharacters: 42,
      analyzedCharacters: 42,
      statementCount: 1,
      truncated: false,
    },
    coverage: {
      admittedArtifacts: 4,
      citationContexts: 3,
      citationStances: 3,
      localLibraryItems: 120,
      localMetadataSignals: 1,
      methodologyArtifacts: 1,
      reproducibilityArtifacts: 1,
      draftStatements: 1,
      unsupportedDraftCandidates: 1,
      externalProvider: { status: "not-configured" },
    },
    limitations: ["Not an aggregate truth score."],
  };
  const view = createResearchWorkspaceArtifactView(value, "citation-health");
  assert.equal(view.kind, "citation-health");
  if (view.kind !== "citation-health") return;
  assert.equal(view.findings.length, 2);
  assert.equal(view.coverage.localLibraryItems, 120);
  assert.equal(view.draft?.fingerprint, "draft-12345678-20");
  assert.equal(
    view.provenance.localMetadataFingerprint,
    "citation-health-local-metadata-12345678-20",
  );

  const rendered = renderResearchWorkspaceArtifactValue(
    new FakeDocument() as unknown as Document,
    value,
    { artifactType: "citation-health" },
  ) as unknown as FakeElement;
  const visible = renderedText(rendered);
  assert(!tags(rendered).includes("pre"));
  assert.match(visible, /review checklist/i);
  assert.match(visible, /not an aggregate truth/i);
  assert.match(visible, /Retraction notice recorded in Extra/);
  assert.match(visible, /draft-12345678-20/);
  assert.match(visible, /citation-health-local-metadata-12345678-20/);
});

test("Research Workspace result surfaces no longer render raw JSON", () => {
  const viewSource = readFileSync(
    join(process.cwd(), "src/modules/researchWorkspace/view.ts"),
    "utf8",
  );
  const projectSource = readFileSync(
    join(process.cwd(), "src/modules/researchWorkspace/projectWindowView.ts"),
    "utf8",
  );
  assert.doesNotMatch(viewSource, /safeStringify|pprw-pre/);
  assert.doesNotMatch(
    projectSource,
    /JSON\.stringify\(artifact\.payload|pprw-pre/,
  );
});
