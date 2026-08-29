import type { ResearchWorkspacePaper } from "../../paperSource";

const PAPER_SOURCE_EDGE_KINDS = new Set([
  "introduces",
  "uses",
  "extends",
  "improves",
  "challenges",
  "compares",
  "evaluates_on",
]);
const PAPER_TARGET_EDGE_KINDS = new Set([
  "extends",
  "improves",
  "challenges",
  "compares",
]);
const BIBLIOGRAPHIC_KINDS = new Set([
  "local-reference",
  "zotero-relation",
  "admitted-metadata",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function qualifyingBibliographicProvenance(
  value: unknown,
  allowedSourceIDs: Set<string>,
) {
  if (!isRecord(value)) return undefined;
  const kind = String(value.kind ?? "").trim();
  const sourceID = String(value.sourceID ?? "").trim();
  if (!BIBLIOGRAPHIC_KINDS.has(kind) || !allowedSourceIDs.has(sourceID)) {
    return undefined;
  }
  const identifier =
    typeof value.identifier === "string" && value.identifier.trim()
      ? value.identifier.trim()
      : undefined;
  return { kind, sourceID, ...(identifier ? { identifier } : {}) };
}

export function validateAndAnnotateRelationshipGraph(params: {
  graph: any;
  papers: readonly ResearchWorkspacePaper[];
  operationVersion: string;
}) {
  const allowedSourceIDs = new Set(
    params.papers.map((paper) => paper.sourceID),
  );
  const attachmentBySource = new Map(
    params.papers.map((paper) => [paper.sourceID, paper.attachmentKey]),
  );
  const nodes = new Map<string, any>();
  for (const node of params.graph.nodes ?? []) {
    if (!node?.id || nodes.has(node.id)) {
      throw new Error(`Duplicate or missing graph node ${node?.id ?? ""}.`);
    }
    if (
      node.kind === "paper" &&
      (!node.paperKey || !allowedSourceIDs.has(node.paperKey))
    ) {
      throw new Error(`Unknown project source node ${node.id}.`);
    }
    nodes.set(node.id, node);
  }

  const edgeIDs = new Set<string>();
  const relationshipKeys = new Map<string, string>();
  const edges = (params.graph.edges ?? []).map((edge: any) => {
    if (!edge?.id || edgeIDs.has(edge.id)) {
      throw new Error(`Duplicate or missing graph edge ${edge?.id ?? ""}.`);
    }
    edgeIDs.add(edge.id);
    const source = nodes.get(edge.source);
    const target = nodes.get(edge.target);
    if (!source || !target) {
      throw new Error(`Graph edge ${edge.id} references an unknown node.`);
    }
    if (edge.source === edge.target) {
      throw new Error(`Graph edge ${edge.id} is a disallowed self-edge.`);
    }
    if (PAPER_SOURCE_EDGE_KINDS.has(edge.kind) && source.kind !== "paper") {
      throw new Error(`Graph edge ${edge.id} has an invalid direction.`);
    }
    if (PAPER_TARGET_EDGE_KINDS.has(edge.kind) && target.kind !== "paper") {
      throw new Error(`Graph edge ${edge.id} has an invalid direction.`);
    }
    const relationshipKey = `${edge.source}\u0000${edge.target}`;
    const priorKind = relationshipKeys.get(relationshipKey);
    if (priorKind && priorKind !== edge.kind) {
      throw new Error(
        `Graph edge ${edge.id} duplicates an incompatible ${priorKind} edge.`,
      );
    }
    relationshipKeys.set(relationshipKey, edge.kind);

    for (const reference of edge.evidence ?? []) {
      const sourceID = String(reference.sourceID ?? "");
      const attachmentKey = String(reference.attachmentKey ?? "");
      if (
        !allowedSourceIDs.has(sourceID) ||
        attachmentBySource.get(sourceID) !== attachmentKey
      ) {
        throw new Error(
          `Graph edge ${edge.id} contains evidence from an unsupported attachment.`,
        );
      }
    }
    const hasVerifiedLocalEvidence = Boolean(
      edge.evidence?.some(
        (reference: any) => reference.verification?.status === "verified",
      ),
    );
    const bibliographicProvenance = qualifyingBibliographicProvenance(
      edge.bibliographicProvenance,
      allowedSourceIDs,
    );
    const qualifies = hasVerifiedLocalEvidence || bibliographicProvenance;
    if (edge.verified === true && !qualifies) {
      throw new Error(
        `Graph edge ${edge.id} is labelled verified without qualifying provenance.`,
      );
    }
    const provenance = hasVerifiedLocalEvidence
      ? "local-evidence"
      : bibliographicProvenance
        ? "bibliographic"
        : "inferred";
    return {
      ...edge,
      ...(bibliographicProvenance ? { bibliographicProvenance } : {}),
      provenance,
      verificationState: qualifies ? "verified" : "inferred",
      verified: Boolean(qualifies),
      operationVersion: params.operationVersion,
      userReviewState: edge.userReviewState ?? "unreviewed",
    };
  });
  return { ...params.graph, edges };
}
