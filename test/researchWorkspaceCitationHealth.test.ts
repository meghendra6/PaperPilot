import { test } from "node:test";
import * as assert from "node:assert/strict";

import {
  buildCitationHealthReport,
  citationHealthDerivedLineage,
  collectCitationHealthLocalLibrarySnapshot,
  parseCitationHealthReport,
  type CitationHealthLocalLibraryItem,
  type CitationHealthLocalLibrarySnapshot,
} from "../src/modules/researchWorkspace/citationHealth";
import type {
  ResearchWorkspaceArtifact,
  ResearchWorkspaceSourceRecord,
} from "../src/modules/researchWorkspace/persistence/contracts";
import type { ResearchWorkspaceProjectDetails } from "../src/modules/researchWorkspace/projectController";
import { parseResearchWorkspaceArtifactFile } from "../src/modules/researchWorkspace/persistence/validation";

const GENERATED_AT = "2026-08-30T03:00:00.000Z";

function source(
  suffix: string,
  fingerprint = `fingerprint-${suffix}`,
): ResearchWorkspaceSourceRecord {
  return {
    sourceID: `zotero:1:ITEM-${suffix}:PDF-${suffix}`,
    identity: {
      libraryID: 1,
      itemKey: `ITEM-${suffix}`,
      attachmentKey: `PDF-${suffix}`,
      standaloneAttachment: false,
    },
    title: `Paper ${suffix}`,
    creators: [`Author ${suffix}`],
    year: 2025,
    doi: `10.1000/paper-${suffix.toLowerCase()}`,
    contentFingerprint: {
      algorithm: "zotero-version-mtime-size-v1",
      value: fingerprint,
    },
    extractionQuality: "structured",
    extractionNotes: [],
    availability: "ready",
    lastResolvedAt: "2026-08-30T00:00:00.000Z",
    lastExtractedAt: "2026-08-30T00:00:00.000Z",
  };
}

function artifact(params: {
  artifactID: string;
  type: ResearchWorkspaceArtifact["type"];
  sources: ResearchWorkspaceSourceRecord[];
  payload: unknown;
  updatedAt?: string;
}): ResearchWorkspaceArtifact {
  const updatedAt = params.updatedAt ?? "2026-08-30T02:00:00.000Z";
  return {
    artifactID: params.artifactID,
    projectID: "project-citation-health",
    type: params.type,
    title: params.type,
    version: 1,
    status: "complete",
    sourceIDs: params.sources.map((entry) => entry.sourceID),
    lineage: {
      inputs: params.sources.map((entry) => ({
        sourceID: entry.sourceID,
        contentFingerprint: entry.contentFingerprint!.value,
        contextProjectionFingerprint: "projection-current",
      })),
      operation: params.type,
      operationVersion: `${params.type}-v1`,
      promptVersion: `${params.type}-prompt-v1`,
      parserVersion: `${params.type}-parser-v1`,
      evidenceVerifierVersion: "paperpilot-evidence-v2",
      providerMode: "local",
      runID: `run-${params.artifactID}`,
    },
    payload: params.payload,
    createdAt: updatedAt,
    updatedAt,
    completedAt: updatedAt,
  };
}

function citationContext(params: {
  id: string;
  sourceID: string;
  doi: string;
  title: string;
  status?: "resolved" | "unresolved" | "ambiguous";
  localItem?: { libraryID: number; itemKey: string };
  sentence: string;
}) {
  return {
    id: params.id,
    citingSourceID: params.sourceID,
    citingPaperKey: params.sourceID,
    citedPaperKey: `reference:${params.id}`,
    exactSentence: params.sentence,
    context: params.sentence,
    marker: `[${params.id.replace(/\D/g, "") || "1"}]`,
    reference: {
      raw: `${params.title}. doi:${params.doi}`,
      title: params.title,
      year: 2024,
      doi: params.doi,
      authors: ["Shared Author"],
      firstAuthor: "author",
    },
    resolution: {
      status: params.status ?? "resolved",
      method: params.localItem ? "zotero-doi" : "none",
      confidence: params.localItem ? 1 : 0,
      ...(params.localItem
        ? {
            zoteroLibraryID: params.localItem.libraryID,
            zoteroItemKey: params.localItem.itemKey,
            title: params.title,
            doi: params.doi,
          }
        : {}),
    },
    evidence: [
      {
        schemaVersion: 2,
        sourceID: params.sourceID,
        libraryID: 1,
        attachmentKey: params.sourceID.split(":").at(-1),
        exactQuote: params.sentence,
        verification: {
          status: "verified",
          verifierVersion: "paperpilot-evidence-v2",
          method: "pdf-exact-quote",
          verifiedAt: GENERATED_AT,
        },
      },
    ],
  };
}

function details() {
  const sourceA = source("A");
  const sourceB = source("B");
  const sharedLocal = { libraryID: 1, itemKey: "LOCAL-SHARED" };
  const contextA = citationContext({
    id: "context-1",
    sourceID: sourceA.sourceID,
    doi: "10.2000/shared",
    title: "Shared result",
    localItem: sharedLocal,
    sentence: "The cited study supports the reported throughput result [1].",
  });
  const contextB = citationContext({
    id: "context-2",
    sourceID: sourceB.sourceID,
    doi: "10.2000/shared",
    title: "Shared result",
    localItem: sharedLocal,
    sentence: "A later experiment reports a conflicting throughput result [2].",
  });
  const missing = citationContext({
    id: "context-3",
    sourceID: sourceA.sourceID,
    doi: "10.2000/not-in-library",
    title: "Missing local reference",
    status: "unresolved",
    sentence: "The background claim relies on an unresolved reference [3].",
  });
  const artifacts = [
    artifact({
      artifactID: "artifact-context",
      type: "citation-context",
      sources: [sourceA, sourceB],
      payload: {
        schemaVersion: 1,
        contexts: [contextA, contextB, missing],
        coverage: { contextsExtracted: 3, resolved: 2, unresolved: 1 },
      },
    }),
    artifact({
      artifactID: "artifact-stance",
      type: "citation-stance",
      sources: [sourceA, sourceB],
      payload: {
        schemaVersion: 1,
        contexts: [contextA, contextB, missing],
        results: [
          {
            contextId: "context-1",
            stance: "supporting",
            rationale: "The sentence reports compatible evidence.",
          },
          {
            contextId: "context-2",
            stance: "contrasting",
            rationale: "The sentence reports conflicting evidence.",
          },
          {
            contextId: "context-3",
            stance: "background",
            rationale: "The sentence supplies background framing.",
          },
        ],
      },
      updatedAt: "2026-08-30T02:01:00.000Z",
    }),
    artifact({
      artifactID: "artifact-methodology",
      type: "methodology-audit",
      sources: [sourceA],
      payload: {
        kind: "methodology-audit",
        report: {
          executiveSummary: "The design needs review.",
          checks: [
            {
              checkId: "baseline-comparability",
              status: "unsupported",
              severity: "major",
              finding:
                "The saved audit did not establish comparable baselines.",
              implication:
                "The reported effect may reflect a design difference.",
              evidence: [],
            },
          ],
        },
      },
    }),
    artifact({
      artifactID: "artifact-reproducibility",
      type: "reproducibility",
      sources: [sourceB],
      payload: {
        schemaVersion: 2,
        summary: "The reproduction package is incomplete.",
        artifacts: [
          {
            id: "code",
            label: "Training code",
            availability: "missing",
            notes: "No repository was recorded.",
            evidence: [],
          },
        ],
        blockers: [
          {
            id: "blocker-code",
            severity: "critical",
            description: "Training code is unavailable.",
            mitigation: "Obtain the exact code revision.",
            evidence: [],
          },
        ],
      },
    }),
  ];
  return {
    sourceA,
    sourceB,
    details: {
      project: {
        projectID: "project-citation-health",
        name: "Citation Health",
        artifactIDs: artifacts.map((entry) => entry.artifactID),
        runIDs: [],
        createdAt: "2026-08-30T00:00:00.000Z",
        updatedAt: "2026-08-30T02:00:00.000Z",
      },
      projectRevision: 1,
      members: [sourceA, sourceB].map((entry) => ({
        sourceID: entry.sourceID,
        role: "included" as const,
        reviewStatus: "included" as const,
        addedAt: "2026-08-30T00:00:00.000Z",
        updatedAt: "2026-08-30T00:00:00.000Z",
      })),
      membersRevision: 7,
      sources: [sourceA, sourceB],
      artifacts,
      warnings: [],
    } satisfies ResearchWorkspaceProjectDetails,
  };
}

function localItem(
  overrides: Partial<CitationHealthLocalLibraryItem> = {},
): CitationHealthLocalLibraryItem {
  return {
    itemID: 901,
    libraryID: 1,
    itemKey: "LOCAL-SHARED",
    title: "Shared result",
    year: 2024,
    doi: "10.2000/shared",
    authors: ["Shared Author"],
    signals: [
      {
        kind: "correction",
        field: "extra",
        excerpt: "Corrected publication: verify the publisher notice.",
      },
    ],
    ...overrides,
  };
}

function localSnapshot(
  items: CitationHealthLocalLibraryItem[] = [localItem()],
): CitationHealthLocalLibrarySnapshot {
  return {
    version: "zotero-citation-health-metadata-v1",
    observedAt: GENERATED_AT,
    libraryIDs: [1],
    items,
    truncated: false,
    limitations: [],
  };
}

test("Citation Health builds a deterministic local checklist without a truth score", () => {
  const setup = details();
  const first = buildCitationHealthReport({
    details: setup.details,
    localLibrary: localSnapshot([localItem()]),
    generatedAt: GENERATED_AT,
    draft: {
      name: "draft.md",
      text: "The proposed system improves latency by 99% on every workload [7].",
    },
  });
  const reversed = buildCitationHealthReport({
    details: {
      ...setup.details,
      sources: [...setup.details.sources].reverse(),
      members: [...setup.details.members].reverse(),
      artifacts: [...setup.details.artifacts].reverse(),
    },
    localLibrary: localSnapshot([localItem()]),
    generatedAt: GENERATED_AT,
    draft: {
      name: "draft.md",
      text: "The proposed system improves latency by 99% on every workload [7].",
    },
  });

  assert.equal(first.reportID, reversed.reportID);
  assert.deepEqual(first.findings, reversed.findings);
  assert.equal(first.scope.membersRevision, 7);
  assert.equal(first.inputArtifacts.length, 4);
  assert.deepEqual(citationHealthDerivedLineage(first), {
    membersRevision: 7,
    sourceIDs: [setup.sourceA.sourceID, setup.sourceB.sourceID],
    artifactInputs: first.inputArtifacts.map((input) => ({
      artifactID: input.artifactID,
      artifactType: input.artifactType,
      version: input.version,
      updatedAt: input.updatedAt,
      payloadFingerprint: input.payloadFingerprint,
    })),
  });
  assert(first.localMetadata.fingerprint.startsWith("citation-health-local"));
  assert.equal(first.coverage.citationContexts, 3);
  assert.equal(first.coverage.citationStances, 3);
  assert.equal(first.coverage.externalProvider.status, "not-configured");
  assert(first.draft?.fingerprint.startsWith("draft-"));
  assert.equal(first.draft?.excerpt.includes("99%"), true);
  assert.equal("truthScore" in first, false);
  assert.equal("qualityScore" in first, false);

  const kinds = new Set(first.findings.map((entry) => entry.kind));
  assert(kinds.has("unresolved-citation-identity"));
  assert(kinds.has("reference-not-in-local-library"));
  assert(kinds.has("contrasting-citation-context"));
  assert(kinds.has("contrasting-citation-stance"));
  assert(kinds.has("local-correction-retraction-signal"));
  assert(kinds.has("methodology-risk"));
  assert(kinds.has("reproducibility-risk"));
  assert(kinds.has("unsupported-draft-statement"));
});

test("Citation Health excludes stale artifact inputs and reports the coverage boundary", () => {
  const setup = details();
  setup.details.artifacts[0] = {
    ...setup.details.artifacts[0],
    status: "stale",
  };
  const report = buildCitationHealthReport({
    details: setup.details,
    localLibrary: localSnapshot(),
    generatedAt: GENERATED_AT,
  });
  assert.equal(
    report.inputArtifacts.some(
      (entry) => entry.artifactID === "artifact-context",
    ),
    false,
  );
  assert.equal(report.coverage.excludedArtifacts, 1);
  assert(
    report.limitations.some(
      (entry) =>
        entry.includes("citation-context") && entry.includes("status-stale"),
    ),
  );
});

test("Citation Health omits a missing member source from derived lineage and reports it", () => {
  const setup = details();
  setup.details.sources = [setup.sourceA];
  const report = buildCitationHealthReport({
    details: setup.details,
    localLibrary: localSnapshot(),
    generatedAt: GENERATED_AT,
  });
  assert.deepEqual(report.scope.includedSourceIDs, [setup.sourceA.sourceID]);
  assert(
    report.limitations.some(
      (entry) =>
        entry.includes("non-excluded project source record") &&
        entry.includes(setup.sourceB.sourceID),
    ),
  );
});

test("Citation Health parser rejects aggregate truth scores and unbounded draft excerpts", () => {
  const setup = details();
  const report = buildCitationHealthReport({
    details: setup.details,
    localLibrary: localSnapshot(),
    generatedAt: GENERATED_AT,
  });
  assert.deepEqual(parseCitationHealthReport(structuredClone(report)), report);

  assert.throws(
    () =>
      parseCitationHealthReport({
        ...structuredClone(report),
        truthScore: 0.9,
      }),
    /must not contain an aggregate truth score/,
  );
  assert.throws(
    () =>
      parseCitationHealthReport({
        ...structuredClone(report),
        draft: {
          fingerprint: "draft-invalid",
          excerpt: "x".repeat(16_001),
          sourceCharacters: 16_001,
          analyzedCharacters: 16_001,
          statementCount: 0,
          truncated: false,
        },
      }),
    /excerpt exceeds the safety limit/,
  );
});

test("local Zotero metadata collection detects correction and retraction signals without reading attachments", async () => {
  let attachmentReads = 0;
  const snapshot = await collectCitationHealthLocalLibrarySnapshot([2, 1, 1], {
    observedAt: GENERATED_AT,
    getAllLibraries: async () => [{ libraryID: 3 }],
    userLibraryID: 4,
    getAllItems: async (libraryID) => [
      {
        id: 100 + libraryID,
        libraryID,
        key: `ITEM-${libraryID}`,
        isAttachment: () => false,
        isNote: () => false,
        getField: (field: string) => {
          if (field === "title") return "Expression of Concern: Example";
          if (field === "DOI") return `10.3000/${libraryID}`;
          if (field === "year") return "2024";
          if (field === "extra") return "Retraction notice pending review";
          if (field === "attachmentText") attachmentReads += 1;
          return "";
        },
        getCreators: () => [{ firstName: "Ada", lastName: "Lovelace" }],
        getTags: () => [{ tag: "corrected article" }],
      },
    ],
  });

  assert.deepEqual(snapshot.libraryIDs, [1, 2, 3, 4]);
  assert.equal(snapshot.items.length, 4);
  assert.equal(attachmentReads, 0);
  assert(
    snapshot.items.every((entry) =>
      entry.signals.some((signal) => signal.kind === "retraction"),
    ),
  );
  assert(
    snapshot.items.every((entry) =>
      entry.signals.some((signal) => signal.kind === "expression-of-concern"),
    ),
  );
  assert(
    snapshot.items.every((entry) =>
      entry.signals.some((signal) => signal.kind === "correction"),
    ),
  );
});

test("ordinary title words do not become correction or withdrawal signals", async () => {
  const snapshot = await collectCitationHealthLocalLibrarySnapshot([1], {
    observedAt: GENERATED_AT,
    getAllItems: async () => [
      {
        id: 101,
        libraryID: 1,
        key: "ITEM-1",
        isAttachment: () => false,
        isNote: () => false,
        getField: (field: string) =>
          field === "title"
            ? "Withdrawal behavior and error correction in networks"
            : "",
        getCreators: () => [],
        getTags: () => [],
      },
    ],
  });

  assert.deepEqual(snapshot.items[0].signals, []);
});

test("optional external provider signals remain explicitly supplementary", () => {
  const setup = details();
  const report = buildCitationHealthReport({
    details: setup.details,
    localLibrary: localSnapshot(),
    generatedAt: GENERATED_AT,
    externalProvider: {
      provider: "Example provider",
      observedAt: GENERATED_AT,
      identifiersChecked: 3,
      identifiersCovered: 1,
      signals: [
        {
          identity: "doi:10.2000/shared",
          kind: "disputed",
          summary: "The provider reports a disputed citation signal.",
        },
      ],
      limitations: ["Coverage is partial."],
    },
  });
  assert.equal(report.coverage.externalProvider.status, "provided");
  assert.equal(report.externalProvider?.provider, "Example provider");
  assert.equal(report.externalProvider?.observedAt, GENERATED_AT);
  assert(
    report.externalProvider?.fingerprint.startsWith(
      "citation-health-external-provider",
    ),
  );
  const signal = report.findings.find(
    (entry) => entry.kind === "external-provider-signal",
  );
  assert(signal);
  assert(
    signal.limitations.some((entry) =>
      entry.includes("not treated as a sole source of truth"),
    ),
  );
});

test("citation-health artifact persistence validates the deterministic payload", () => {
  const setup = details();
  const report = buildCitationHealthReport({
    details: setup.details,
    localLibrary: localSnapshot(),
    generatedAt: GENERATED_AT,
  });
  const stored = artifact({
    artifactID: "artifact-citation-health",
    type: "citation-health",
    sources: [setup.sourceA, setup.sourceB],
    payload: report,
  });
  stored.lineage.membersRevision = report.scope.membersRevision;
  stored.lineage.artifactInputs = report.inputArtifacts.map((input) => ({
    artifactID: input.artifactID,
    artifactType: input.artifactType,
    version: input.version,
    updatedAt: input.updatedAt,
    payloadFingerprint: input.payloadFingerprint,
  }));
  const file = {
    schemaVersion: 1,
    revision: 1,
    artifact: stored,
  };
  assert.deepEqual(
    parseResearchWorkspaceArtifactFile(structuredClone(file)),
    file,
  );

  const invalid = structuredClone(file) as typeof file & {
    artifact: typeof stored & {
      payload: typeof report & { truthScore: number };
    };
  };
  invalid.artifact.payload.truthScore = 1;
  assert.throws(
    () => parseResearchWorkspaceArtifactFile(invalid),
    /must not contain an aggregate truth score/,
  );

  const staleLineage = structuredClone(file);
  staleLineage.artifact.lineage.membersRevision =
    report.scope.membersRevision + 1;
  assert.throws(
    () => parseResearchWorkspaceArtifactFile(staleLineage),
    /members revision must match artifact lineage/,
  );
});
