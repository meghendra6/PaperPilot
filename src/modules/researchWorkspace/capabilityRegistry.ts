import type { ResearchWorkspaceArtifactType } from "./persistence/contracts";

export type ResearchWorkspaceCapabilityID =
  | "claim-ledger"
  | "critical-read"
  | "methodology-audit"
  | "paper-mastery"
  | "reproducibility-audit"
  | "paper-to-code"
  | "evidence-matrix"
  | "quick-compare"
  | "relationship-graph"
  | "project-synthesis"
  | "cross-paper-mastery"
  | "citation-context"
  | "citation-stance"
  | "screening-log"
  | "contradiction-gap-dashboard"
  | "living-review";

export type ResearchWorkspaceSourceScope =
  | "single-source"
  | "multi-source"
  | "project";

export type ResearchWorkspaceCapabilityEntrypoint =
  | "reader"
  | "research-workspace";

export type ResearchWorkspaceRendererID =
  | "generic"
  | "evidence-matrix"
  | "relationship-graph"
  | "synthesis"
  | "mastery"
  | "review-log"
  | "contradiction-gap-dashboard";

export interface ResearchWorkspaceCapabilityDefinition {
  id: ResearchWorkspaceCapabilityID;
  label: string;
  sourceScope: ResearchWorkspaceSourceScope;
  entrypoint: ResearchWorkspaceCapabilityEntrypoint;
  operation: string;
  operationVersion: string;
  promptVersion: string;
  parserVersion: string;
  schemaVersion: string;
  artifactType?: ResearchWorkspaceArtifactType;
  renderer: ResearchWorkspaceRendererID;
  reviewable: boolean;
  editable: boolean;
  exportable: boolean;
  presetOf?: ResearchWorkspaceCapabilityID;
  presetID?: string;
  legacyOperations?: readonly string[];
}

const definitions: readonly ResearchWorkspaceCapabilityDefinition[] = [
  {
    id: "claim-ledger",
    label: "Claim–Evidence Ledger",
    sourceScope: "single-source",
    entrypoint: "research-workspace",
    operation: "claims",
    operationVersion: "claim-ledger-v1",
    promptVersion: "claims-prompt-v1",
    parserVersion: "claims-parser-v1",
    schemaVersion: "claim-ledger-v1",
    artifactType: "claim-ledger",
    renderer: "generic",
    reviewable: true,
    editable: true,
    exportable: true,
  },
  {
    id: "critical-read",
    label: "Critical Read",
    sourceScope: "single-source",
    entrypoint: "reader",
    operation: "reader-critical-read",
    operationVersion: "critical-read-workflow-v1",
    promptVersion: "critical-read-seven-step-prompt-v1",
    parserVersion: "critical-read-seven-step-parser-v1",
    schemaVersion: "critical-read-state-v1",
    artifactType: "critical-read",
    renderer: "generic",
    reviewable: true,
    editable: true,
    exportable: true,
  },
  {
    id: "methodology-audit",
    label: "Methodology Audit",
    sourceScope: "single-source",
    entrypoint: "research-workspace",
    operation: "methodology-audit",
    operationVersion: "methodology-audit-v1",
    promptVersion: "methodology-audit-prompt-v1",
    parserVersion: "methodology-audit-parser-v1",
    schemaVersion: "methodology-audit-v1",
    artifactType: "methodology-audit",
    renderer: "generic",
    reviewable: true,
    editable: true,
    exportable: true,
    legacyOperations: ["critical-read"],
  },
  {
    id: "paper-mastery",
    label: "Paper Mastery",
    sourceScope: "single-source",
    entrypoint: "reader",
    operation: "reader-paper-mastery",
    operationVersion: "paper-mastery-v3",
    promptVersion: "paper-mastery-prompt-v3",
    parserVersion: "paper-mastery-parser-v3",
    schemaVersion: "paper-mastery-state-v2",
    artifactType: "paper-mastery",
    renderer: "mastery",
    reviewable: true,
    editable: false,
    exportable: true,
    legacyOperations: ["paper-mastery", "paper-mastery-grade"],
  },
  {
    id: "reproducibility-audit",
    label: "Reproducibility Audit",
    sourceScope: "single-source",
    entrypoint: "research-workspace",
    operation: "reproducibility",
    operationVersion: "reproducibility-v1",
    promptVersion: "reproducibility-prompt-v1",
    parserVersion: "reproducibility-parser-v1",
    schemaVersion: "reproducibility-v1",
    artifactType: "reproducibility",
    renderer: "generic",
    reviewable: true,
    editable: true,
    exportable: true,
  },
  {
    id: "paper-to-code",
    label: "Paper-to-Code",
    sourceScope: "single-source",
    entrypoint: "research-workspace",
    operation: "paper-to-code",
    operationVersion: "paper-to-code-v1",
    promptVersion: "paper-to-code-prompt-v1",
    parserVersion: "paper-to-code-parser-v1",
    schemaVersion: "paper-to-code-v1",
    artifactType: "paper-to-code",
    renderer: "generic",
    reviewable: true,
    editable: true,
    exportable: true,
  },
  {
    id: "evidence-matrix",
    label: "Evidence Matrix",
    sourceScope: "multi-source",
    entrypoint: "research-workspace",
    operation: "evidence-matrix",
    operationVersion: "evidence-matrix-v1",
    promptVersion: "evidence-matrix-prompt-v1",
    parserVersion: "evidence-matrix-parser-v1",
    schemaVersion: "evidence-matrix-v2",
    artifactType: "evidence-matrix",
    renderer: "evidence-matrix",
    reviewable: true,
    editable: true,
    exportable: true,
  },
  {
    id: "quick-compare",
    label: "Quick Compare",
    sourceScope: "multi-source",
    entrypoint: "research-workspace",
    operation: "quick-compare",
    operationVersion: "quick-compare-v1",
    promptVersion: "evidence-matrix-prompt-v1",
    parserVersion: "evidence-matrix-parser-v1",
    schemaVersion: "evidence-matrix-v2",
    artifactType: "evidence-matrix",
    renderer: "evidence-matrix",
    reviewable: true,
    editable: true,
    exportable: true,
    presetOf: "evidence-matrix",
    presetID: "quick-compare-v1",
    legacyOperations: ["paper-compare", "quick-compare-v0"],
  },
  {
    id: "relationship-graph",
    label: "Relationship Graph",
    sourceScope: "multi-source",
    entrypoint: "research-workspace",
    operation: "literature-graph",
    operationVersion: "relationship-graph-v1",
    promptVersion: "literature-graph-prompt-v1",
    parserVersion: "literature-graph-parser-v1",
    schemaVersion: "relationship-graph-v1",
    artifactType: "relationship-graph",
    renderer: "relationship-graph",
    reviewable: true,
    editable: true,
    exportable: true,
  },
  {
    id: "project-synthesis",
    label: "Project Synthesis",
    sourceScope: "project",
    entrypoint: "research-workspace",
    operation: "project-synthesis",
    operationVersion: "project-synthesis-v1",
    promptVersion: "project-synthesis-prompt-v1",
    parserVersion: "project-synthesis-parser-v1",
    schemaVersion: "project-synthesis-v1",
    artifactType: "synthesis",
    renderer: "synthesis",
    reviewable: true,
    editable: true,
    exportable: true,
  },
  {
    id: "cross-paper-mastery",
    label: "Cross-paper Mastery",
    sourceScope: "multi-source",
    entrypoint: "research-workspace",
    operation: "cross-paper-mastery",
    operationVersion: "cross-paper-mastery-v1",
    promptVersion: "cross-paper-mastery-prompt-v1",
    parserVersion: "cross-paper-mastery-parser-v1",
    schemaVersion: "cross-paper-mastery-v1",
    artifactType: "cross-paper-mastery",
    renderer: "mastery",
    reviewable: true,
    editable: false,
    exportable: true,
  },
  {
    id: "screening-log",
    label: "Screening & Exclusion Log",
    sourceScope: "project",
    entrypoint: "research-workspace",
    operation: "screening-log",
    operationVersion: "screening-log-v1",
    promptVersion: "local-user-decision-v1",
    parserVersion: "screening-log-parser-v1",
    schemaVersion: "screening-log-v1",
    renderer: "review-log",
    reviewable: true,
    editable: true,
    exportable: true,
  },
  {
    id: "contradiction-gap-dashboard",
    label: "Contradictions & Evidence Gaps",
    sourceScope: "project",
    entrypoint: "research-workspace",
    operation: "contradiction-gap-dashboard",
    operationVersion: "contradiction-gap-dashboard-v1",
    promptVersion: "local-artifact-derivation-v1",
    parserVersion: "contradiction-gap-parser-v1",
    schemaVersion: "contradiction-gap-dashboard-v1",
    artifactType: "contradiction-gap-dashboard",
    renderer: "contradiction-gap-dashboard",
    reviewable: true,
    editable: true,
    exportable: true,
  },
  {
    id: "living-review",
    label: "Living Review",
    sourceScope: "project",
    entrypoint: "research-workspace",
    operation: "living-review",
    operationVersion: "living-review-v1",
    promptVersion: "local-zotero-metadata-v1",
    parserVersion: "living-review-parser-v1",
    schemaVersion: "living-review-inbox-v1",
    renderer: "generic",
    reviewable: true,
    editable: true,
    exportable: false,
  },
  {
    id: "citation-context",
    label: "Citation Context",
    sourceScope: "project",
    entrypoint: "research-workspace",
    operation: "citation-context-extraction",
    operationVersion: "citation-context-v1",
    promptVersion: "local-extractor-v1",
    parserVersion: "citation-context-parser-v1",
    schemaVersion: "citation-context-v1",
    artifactType: "citation-context",
    renderer: "generic",
    reviewable: true,
    editable: true,
    exportable: true,
  },
  {
    id: "citation-stance",
    label: "Citation Stance",
    sourceScope: "project",
    entrypoint: "research-workspace",
    operation: "citation-stance",
    operationVersion: "citation-stance-v1",
    promptVersion: "citation-stance-prompt-v1",
    parserVersion: "citation-stance-parser-v1",
    schemaVersion: "citation-stance-v1",
    artifactType: "citation-stance",
    renderer: "generic",
    reviewable: true,
    editable: true,
    exportable: true,
  },
] as const;

export const RESEARCH_WORKSPACE_CAPABILITIES: ReadonlyMap<
  ResearchWorkspaceCapabilityID,
  ResearchWorkspaceCapabilityDefinition
> = new Map(definitions.map((definition) => [definition.id, definition]));

const operationIndex = new Map<string, ResearchWorkspaceCapabilityDefinition>();
for (const definition of definitions) {
  operationIndex.set(definition.operation, definition);
  for (const legacyOperation of definition.legacyOperations ?? []) {
    operationIndex.set(legacyOperation, definition);
  }
}

export function getResearchWorkspaceCapability(
  id: ResearchWorkspaceCapabilityID,
) {
  const definition = RESEARCH_WORKSPACE_CAPABILITIES.get(id);
  if (!definition)
    throw new Error(`Unknown Research Workspace capability: ${id}`);
  return definition;
}

export function getResearchWorkspaceCapabilityForOperation(operation: string) {
  return operationIndex.get(operation);
}

export function listResearchWorkspaceCapabilities() {
  return [...definitions];
}
