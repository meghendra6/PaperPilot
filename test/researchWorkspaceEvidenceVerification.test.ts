import { test } from "node:test";
import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { normalizeQuoteText } from "../src/modules/autoHighlight/pdfMatch";
import {
  ResearchWorkspaceEvidenceVerifier,
  type AdmittedEvidenceSource,
  type EvidenceReferenceV2,
} from "../src/modules/researchWorkspace/evidenceVerification";
import { openVerifiedResearchWorkspaceEvidence } from "../src/modules/researchWorkspace/evidenceNavigation";
import { ResearchWorkspaceService } from "../src/modules/researchWorkspace/service";
import { toPdfNavigationTarget } from "../src/modules/researchWorkspace/core/evidence/types";

const source: AdmittedEvidenceSource = {
  sourceID: "zotero:7:ITEM:ATTACH",
  libraryID: 7,
  attachmentKey: "ATTACH",
  attachmentID: 12,
  contentFingerprint: { value: "fingerprint" },
  structuredChunks: [
    {
      text: "Structured evidence",
      pageIndex: 2,
      sectionPath: ["Method"],
      metadata: { elementId: "element-1", elementType: "paragraph" },
    },
  ],
};

function localDependencies() {
  return {
    resolveAttachment: async () => ({
      id: 12,
      libraryID: 7,
      key: "ATTACH",
      getFilePathAsync: async () => "/tmp/paper.pdf",
    }),
    extractPages: async () => [
      {
        pageIndex: 0,
        pageLabel: "1",
        spans: [
          {
            pageIndex: 0,
            pageLabel: "1",
            text: "The exact local evidence sentence.",
            normalizedText: normalizeQuoteText(
              "The exact local evidence sentence.",
            ),
            rect: [10, 20, 200, 40],
          },
        ],
      },
    ],
    now: () => "2026-08-29T00:00:00.000Z",
  };
}

test("local evidence verifier derives page geometry from an exact PDF quote", async () => {
  const verifier = new ResearchWorkspaceEvidenceVerifier(
    [source],
    localDependencies(),
  );
  const reference = await verifier.verify({
    attachmentKey: "ATTACH",
    pageIndex: 0,
    quote: "The exact local evidence sentence.",
    confidence: 0.9,
    boundingBox: {
      pageIndex: 0,
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    },
  });

  assert(reference);
  assert.equal(reference.sourceID, source.sourceID);
  assert.equal(reference.libraryID, 7);
  assert.equal(reference.verification.status, "verified");
  assert.equal(reference.verification.method, "pdf-exact-quote");
  assert.equal(reference.verification.verifiedAt, "2026-08-29T00:00:00.000Z");
  assert.deepEqual(reference.boundingBoxes, [
    { pageIndex: 0, rect: [10, 20, 200, 40] },
  ]);
});

test("local evidence verifier never verifies an unmatched or wrong-page quote", async () => {
  const verifier = new ResearchWorkspaceEvidenceVerifier(
    [source],
    localDependencies(),
  );
  const unmatched = await verifier.verify({
    attachmentKey: "ATTACH",
    pageIndex: 0,
    quote: "A fabricated sentence.",
  });
  const wrongPage = await verifier.verify({
    attachmentKey: "ATTACH",
    pageIndex: 4,
    quote: "The exact local evidence sentence.",
  });

  assert.equal(unmatched?.verification.status, "not-found");
  assert.equal(unmatched?.boundingBoxes, undefined);
  assert.equal(wrongPage?.verification.status, "not-found");
});

test("local evidence verifier accepts trusted structured element identity", async () => {
  const verifier = new ResearchWorkspaceEvidenceVerifier([source], {
    now: () => "2026-08-29T00:00:00.000Z",
  });
  const reference = await verifier.verify({
    attachmentKey: "ATTACH",
    elementId: "element-1",
    elementType: "paragraph",
  });

  assert.equal(reference?.verification.status, "verified");
  assert.equal(reference?.verification.method, "structured-element");
  assert.equal(reference?.pageIndex, 2);
  assert.deepEqual(reference?.sectionPath, ["Method"]);
});

test("evidence verification fails closed for unavailable and unadmitted sources", async () => {
  const unavailable = new ResearchWorkspaceEvidenceVerifier([source], {
    resolveAttachment: async () => undefined,
    now: () => "2026-08-29T00:00:00.000Z",
  });
  const missing = await unavailable.verify({
    attachmentKey: "ATTACH",
    quote: "The exact local evidence sentence.",
  });
  assert.equal(missing?.verification.status, "source-unavailable");

  const tree = (await unavailable.verifyTree({
    evidence: [
      { attachmentKey: "FOREIGN", pageIndex: 0, quote: "Foreign" },
      { attachmentKey: "ATTACH", pageIndex: 0, quote: "Local" },
    ],
  })) as { evidence: EvidenceReferenceV2[] };
  assert.equal(tree.evidence.length, 1);
  assert.equal(tree.evidence[0].attachmentKey, "ATTACH");
});

test("evidence verification requires source identity for duplicate cross-library keys", async () => {
  const groupSource: AdmittedEvidenceSource = {
    ...source,
    sourceID: "zotero:8:GROUP-ITEM:ATTACH",
    libraryID: 8,
    attachmentID: 22,
  };
  const verifier = new ResearchWorkspaceEvidenceVerifier(
    [source, groupSource],
    {
      ...localDependencies(),
      resolveAttachment: async (resolvedSource) => ({
        id: resolvedSource.attachmentID,
        libraryID: resolvedSource.libraryID,
        key: resolvedSource.attachmentKey,
        getFilePathAsync: async () => "/tmp/paper.pdf",
      }),
    },
  );

  assert.equal(
    await verifier.verify({
      attachmentKey: "ATTACH",
      quote: "The exact local evidence sentence.",
    }),
    null,
  );
  const reference = await verifier.verify({
    sourceID: groupSource.sourceID,
    libraryID: groupSource.libraryID,
    attachmentKey: "ATTACH",
    quote: "The exact local evidence sentence.",
  });
  assert.equal(reference?.sourceID, groupSource.sourceID);
  assert.equal(reference?.libraryID, 8);
  assert.equal(reference?.verification.status, "verified");
});

test("Research Workspace verifies claim evidence before persistence", async () => {
  const state: any = {
    preferences: { responseLanguage: "English" },
    papers: {
      [source.sourceID]: {
        sourceID: source.sourceID,
        paperKey: source.sourceID,
        libraryID: source.libraryID,
        attachmentID: source.attachmentID,
        attachmentKey: source.attachmentKey,
        criticalReads: [],
        reproducibilityReports: [],
        paperToCodeReports: [],
      },
    },
  };
  const service = new (ResearchWorkspaceService as any)({
    repository: {
      async load() {
        return state;
      },
      async update(update: (workspace: any) => void) {
        await update(state);
        return state;
      },
    },
    agent: {
      async run() {
        return JSON.stringify({
          claims: [
            {
              id: "claim-1",
              text: "The paper states the local sentence.",
              kind: "author_claim",
              confidence: 0.9,
              support: [
                {
                  attachmentKey: "ATTACH",
                  pageIndex: 0,
                  quote: "The exact local evidence sentence.",
                  confidence: 0.9,
                },
              ],
              contradictions: [],
              verificationStatus: "verified",
            },
            {
              id: "claim-2",
              text: "The model claims an unsupported local sentence.",
              kind: "author_claim",
              confidence: 0.99,
              support: [
                {
                  attachmentKey: "ATTACH",
                  pageIndex: 0,
                  quote: "This sentence is not in the local PDF.",
                  confidence: 0.99,
                },
              ],
              contradictions: [],
              verificationStatus: "verified",
            },
          ],
        });
      },
    },
    evidenceVerification: localDependencies(),
  });
  const paper = {
    sourceID: source.sourceID,
    paperKey: source.sourceID,
    libraryID: source.libraryID,
    itemKey: "ITEM",
    itemID: 11,
    attachmentID: source.attachmentID,
    attachmentKey: source.attachmentKey,
    contentFingerprint: {
      algorithm: "zotero-version-mtime-size-v1",
      value: "fingerprint",
    },
    title: "Paper",
    context: "The exact local evidence sentence.",
    extractionQuality: "zotero_text",
  };

  const ledger = await service.extractClaims(paper);
  const reference = ledger.claims[0].support[0];
  assert.equal(reference.verification.status, "verified");
  assert.equal(ledger.claims[0].verificationStatus, "verified");
  assert.equal(ledger.claims[1].support[0].verification.status, "not-found");
  assert.equal(ledger.claims[1].verificationStatus, "unverified");
  assert.equal(reference.sourceID, source.sourceID);
  assert.equal(
    state.papers[source.sourceID].claimLedger.claims[0].support[0].verification
      .status,
    "verified",
  );
  assert.equal(
    state.papers[source.sourceID].claimLedger.claims[1].verificationStatus,
    "unverified",
  );
});

test("verified evidence navigation resolves one exact library and never scans", async () => {
  const calls: Array<[number, string]> = [];
  const opens: Array<[number, { pageIndex?: number }]> = [];
  const reference: EvidenceReferenceV2 = {
    schemaVersion: 2,
    sourceID: "zotero:7:ITEM:ATTACH",
    libraryID: 7,
    attachmentKey: "ATTACH",
    pageIndex: 3,
    verification: {
      status: "verified",
      method: "pdf-exact-quote",
      verifierVersion: "paperpilot-evidence-v2",
    },
  };

  await openVerifiedResearchWorkspaceEvidence(reference, {
    getByLibraryAndKey: (libraryID, attachmentKey) => {
      calls.push([libraryID, attachmentKey]);
      return { id: 12, libraryID: 7, key: "ATTACH" };
    },
    openReader: async (attachmentID, options) => {
      opens.push([attachmentID, options]);
    },
  });

  assert.deepEqual(calls, [[7, "ATTACH"]]);
  assert.deepEqual(opens, [[12, { pageIndex: 3 }]]);
});

test("Research Workspace view exposes no cross-library evidence scan", () => {
  const viewSource = readFileSync(
    join(process.cwd(), "src/modules/researchWorkspace/view.ts"),
    "utf8",
  );
  const rendererSource = readFileSync(
    join(process.cwd(), "src/modules/researchWorkspace/artifactRenderer.ts"),
    "utf8",
  );
  assert.doesNotMatch(viewSource, /Libraries\?\.getAll|Libraries\.getAll/);
  assert.doesNotMatch(rendererSource, /Libraries\?\.getAll|Libraries\.getAll/);
  assert.match(rendererSource, /status === "verified"/);
  assert.match(viewSource, /openVerifiedResearchWorkspaceEvidence/);
});

test("evidence navigation refuses unverified or cross-library substitutions", async () => {
  const base: EvidenceReferenceV2 = {
    schemaVersion: 2,
    sourceID: "zotero:7:ITEM:ATTACH",
    libraryID: 7,
    attachmentKey: "ATTACH",
    verification: {
      status: "not-found",
      method: "pdf-exact-quote",
      verifierVersion: "paperpilot-evidence-v2",
    },
  };
  await assert.rejects(
    () =>
      openVerifiedResearchWorkspaceEvidence(base, {
        getByLibraryAndKey: () => ({ id: 12, libraryID: 7, key: "ATTACH" }),
      }),
    /Only locally verified evidence/,
  );
  await assert.rejects(
    () =>
      openVerifiedResearchWorkspaceEvidence(
        {
          ...base,
          verification: { ...base.verification, status: "verified" },
        },
        {
          getByLibraryAndKey: () => ({
            id: 99,
            libraryID: 8,
            key: "ATTACH",
          }),
          openReader: async () => {
            throw new Error("must not open");
          },
        },
      ),
    /exact Zotero evidence attachment is unavailable/,
  );
  assert.equal(toPdfNavigationTarget(base), null);
  assert.deepEqual(
    toPdfNavigationTarget({
      ...base,
      verification: { ...base.verification, status: "verified" },
    }),
    {
      sourceID: "zotero:7:ITEM:ATTACH",
      libraryID: 7,
      attachmentKey: "ATTACH",
    },
  );
});
