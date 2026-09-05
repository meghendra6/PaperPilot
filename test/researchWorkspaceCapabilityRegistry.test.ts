import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import * as assert from "node:assert/strict";

import {
  getResearchWorkspaceCapability,
  getResearchWorkspaceCapabilityForOperation,
  listResearchWorkspaceCapabilities,
} from "../src/modules/researchWorkspace/capabilityRegistry";
import { openCanonicalReaderCapability } from "../src/modules/researchWorkspace/canonicalReaderCapability";
import { getEvidenceMatrixPreset } from "../src/modules/researchWorkspace/evidenceMatrixPresets";
import { readResearchWorkspaceArtifact } from "../src/modules/researchWorkspace/legacyCapabilityAdapters";
import { ResearchWorkspaceService } from "../src/modules/researchWorkspace/service";

test("capability registry has one canonical Critical Read and Paper Mastery", () => {
  const capabilities = listResearchWorkspaceCapabilities();
  assert.equal(
    capabilities.filter((capability) => capability.label === "Critical Read")
      .length,
    1,
  );
  assert.equal(
    capabilities.filter((capability) => capability.label === "Paper Mastery")
      .length,
    1,
  );
  assert.equal(
    getResearchWorkspaceCapability("critical-read").entrypoint,
    "reader",
  );
  assert.equal(
    getResearchWorkspaceCapability("paper-mastery").entrypoint,
    "reader",
  );
  assert.equal(
    getResearchWorkspaceCapabilityForOperation("critical-read")?.id,
    "methodology-audit",
  );
});

test("Quick Compare is a versioned Evidence Matrix preset", () => {
  const full = getResearchWorkspaceCapability("evidence-matrix");
  const quick = getResearchWorkspaceCapability("quick-compare");
  assert.equal(quick.presetOf, "evidence-matrix");
  assert.equal(quick.artifactType, full.artifactType);
  assert.equal(quick.promptVersion, full.promptVersion);
  assert.equal(quick.parserVersion, full.parserVersion);
  assert.notEqual(quick.operation, full.operation);

  const preset = getEvidenceMatrixPreset("quick-compare-v1");
  assert.equal(preset.columns.length, 5);
  assert.deepEqual(
    preset.columns.map((column) => column.id),
    ["contribution", "method", "evaluation", "primary_result", "limitation"],
  );

  const service = new (ResearchWorkspaceService as any)({
    repository: {},
    agent: { run: async () => "{}" },
  });
  const matrix = service.createEvidenceMatrixShell(
    [
      {
        paperKey: "paper-a",
        title: "Paper A",
        attachmentKey: "ATTACH-A",
      },
      {
        paperKey: "paper-b",
        title: "Paper B",
        attachmentKey: "ATTACH-B",
      },
    ],
    "quick-compare-v1",
  );
  assert.deepEqual(
    matrix.columns.map((column: { id: string }) => column.id),
    preset.columns.map((column) => column.id),
  );
});

test("Screening Log is an explicit local project workflow", () => {
  const screening = getResearchWorkspaceCapability("screening-log");
  assert.equal(screening.sourceScope, "project");
  assert.equal(screening.entrypoint, "research-workspace");
  assert.equal(screening.operation, "screening-log");
  assert.equal(screening.renderer, "review-log");
  assert.equal(screening.artifactType, undefined);
  assert.equal(screening.editable, true);
  assert.equal(screening.exportable, true);
});

test("canonical Reader bridge opens the captured PDF before activating one workflow", async () => {
  const events: string[] = [];
  const result = await openCanonicalReaderCapability({
    paper: { itemID: 7, attachmentID: 42, sourceID: "zotero:1:ITEM:PDF" },
    capability: "critical-read",
    dependencies: {
      openReader: async (attachmentID) => {
        events.push(`open:${attachmentID}`);
      },
      activateCapability: (itemID, capability) => {
        events.push(`activate:${itemID}:${capability}`);
        return true;
      },
    },
  });
  assert.equal(result.activated, true);
  assert.deepEqual(events, ["open:42", "activate:7:critical-read"]);
});

test("legacy capability reads are side-effect free and preserve stored payloads", () => {
  const stored = {
    artifactID: "artifact-legacy",
    projectID: "project-1",
    type: "critical-read",
    title: "Profiled Critical Read",
    version: 1,
    status: "complete",
    sourceIDs: ["source-1"],
    lineage: {
      inputs: [],
      operation: "critical-read",
      operationVersion: "critical-read-v1",
      promptVersion: "critical-read-prompt-v1",
      parserVersion: "critical-read-parser-v1",
      evidenceVerifierVersion: "paperpilot-evidence-v2",
      providerMode: "codex_cli",
      runID: "run-1",
    },
    payload: { report: { findings: ["legacy finding"] } },
    createdAt: "2026-08-30T00:00:00.000Z",
    updatedAt: "2026-08-30T00:00:00.000Z",
  } as const;
  const before = JSON.stringify(stored);
  const read = readResearchWorkspaceArtifact(stored as any);
  assert.equal(read.legacy, true);
  assert.equal(read.capabilityID, "methodology-audit");
  assert.equal(read.artifact.type, "methodology-audit");
  assert.deepEqual(read.artifact.payload, stored.payload);
  assert.equal(JSON.stringify(stored), before);
});

test("workspace UI exposes canonical names and no duplicate v2 workflow", () => {
  const source = readFileSync(
    join(process.cwd(), "src", "modules", "researchWorkspace", "view.ts"),
    "utf8",
  );
  assert.match(source, /Open Critical Read/);
  assert.match(source, /Methodology Audit/);
  assert.match(source, /Open Paper Mastery/);
  assert.match(source, /runMulti\("quick-compare"/);
  assert.doesNotMatch(
    source,
    /Profiled Critical Read|Profiled audit|Paper Mastery 2\.0/,
  );
  assert.doesNotMatch(source, /startOrResumeResearchWorkspaceMastery/);
});

test("project UI exposes the explicit screening workflow without prompt dialogs", () => {
  const source = readFileSync(
    join(
      process.cwd(),
      "src",
      "modules",
      "researchWorkspace",
      "projectReviewPanels.ts",
    ),
    "utf8",
  );
  assert.match(source, /Screening & exclusion log/i);
  assert.match(source, /Record decision/);
  assert.match(source, /Export screening JSON \+ CSV/);
  assert.doesNotMatch(source, /prompt\(\s*["']Reason for exclusion/);
});

test("Contradictions and Evidence Gaps is a local project capability", () => {
  const capability = getResearchWorkspaceCapability(
    "contradiction-gap-dashboard",
  );
  assert.equal(capability.sourceScope, "project");
  assert.equal(capability.entrypoint, "research-workspace");
  assert.equal(capability.operation, "contradiction-gap-dashboard");
  assert.equal(capability.artifactType, "contradiction-gap-dashboard");
  assert.equal(capability.renderer, "contradiction-gap-dashboard");
  assert.equal(capability.reviewable, true);
  assert.equal(capability.exportable, true);

  const source = readFileSync(
    join(
      process.cwd(),
      "src",
      "modules",
      "researchWorkspace",
      "projectReviewPanels.ts",
    ),
    "utf8",
  );
  assert.match(source, /Contradictions & Evidence Gaps/);
  assert.match(source, /no PDF extraction, model, CLI, or network request/i);
  assert.match(source, /Confirm rule result/);
  assert.match(source, /Save reclassification/);
  assert.match(source, /Dismiss candidate/);
});

test("Living Review is a local metadata-only project workflow", () => {
  const capability = getResearchWorkspaceCapability("living-review");
  assert.equal(capability.sourceScope, "project");
  assert.equal(capability.entrypoint, "research-workspace");
  assert.equal(capability.operation, "living-review");
  assert.equal(capability.promptVersion, "local-zotero-metadata-v1");
  assert.equal(capability.artifactType, undefined);
  assert.equal(capability.exportable, false);

  const source = readFileSync(
    join(
      process.cwd(),
      "src",
      "modules",
      "researchWorkspace",
      "projectReviewPanels.ts",
    ),
    "utf8",
  );
  assert.match(source, /Living review/);
  assert.match(source, /does not read PDF or annotation text/i);
  assert.match(source, /Check now/);
  assert.match(source, /Mark reviewed/);
  assert.match(source, /Dismiss/);
});

test("Citation and Reference Health is a local derived project capability", () => {
  const capability = getResearchWorkspaceCapability(
    "citation-reference-health",
  );
  assert.equal(capability.sourceScope, "project");
  assert.equal(capability.entrypoint, "research-workspace");
  assert.equal(capability.operation, "citation-reference-health");
  assert.equal(capability.artifactType, "citation-health");
  assert.equal(capability.renderer, "citation-health");
  assert.equal(capability.promptVersion, "local-artifact-derivation-v1");
  assert.equal(capability.exportable, true);

  const source = readFileSync(
    join(
      process.cwd(),
      "src",
      "modules",
      "researchWorkspace",
      "projectReviewPanels.ts",
    ),
    "utf8",
  );
  assert.match(source, /Citation & Reference Health/);
  assert.match(source, /does not create an aggregate truth score/i);
  assert.match(source, /Import a local draft text file/);
  assert.match(source, /bounded fingerprint and bounded excerpt/i);
  assert.match(source, /Build \/ refresh citation health checklist/);

  const facadeSource = readFileSync(
    join(process.cwd(), "src", "modules", "researchWorkspace", "facade.ts"),
    "utf8",
  );
  assert.match(facadeSource, /runResearchWorkspaceCitationHealth/);
  assert.match(facadeSource, /operationCoordinator\(\)\.runDerived/);
  assert.match(facadeSource, /citationHealthDerivedLineage\(report\)/);
  assert.match(
    facadeSource,
    /membersRevision: derivedLineage\.membersRevision/,
  );
  assert.match(facadeSource, /artifactInputs: derivedLineage\.artifactInputs/);
});
