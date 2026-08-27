// @ts-nocheck -- Ported feature core is guarded by strict runtime parsers.
import * as json_1 from "../comprehensionCheck/v2/json";
import * as types_1 from "../evidence/types";
import * as graph_1 from "./graph";
const NODE_KINDS = new Set(["paper", "concept", "claim", "method", "dataset"]);
const EDGE_KINDS = new Set([
  "introduces",
  "uses",
  "extends",
  "improves",
  "challenges",
  "supports",
  "contradicts",
  "compares",
  "evaluates_on",
  "related",
]);
function parseLiteratureGraphResponse(params) {
  const root = (0, json_1.extractLastJsonObject)(params.response);
  const nodeIds = new Set();
  const nodes = (0, json_1.readArray)(root.nodes, "nodes").map(
    (entry, index) => {
      const object = (0, json_1.readObject)(entry, `nodes[${index}]`);
      const kind = String(object.kind ?? object.type);
      if (!NODE_KINDS.has(kind)) throw new Error(`Invalid node kind ${kind}`);
      const paperKey =
        typeof object.paperKey === "string"
          ? object.paperKey.trim()
          : undefined;
      if (kind === "paper" && !paperKey)
        throw new Error(
          `Paper node ${String(object.id ?? "").trim()} requires a paperKey`,
        );
      if (paperKey && !params.allowedPaperKeys.has(paperKey))
        throw new Error(`Unknown paper ${paperKey}`);
      const id = String(object.id ?? "").trim();
      if (nodeIds.has(id)) throw new Error(`Duplicate node ${id}`);
      nodeIds.add(id);
      return {
        id,
        kind,
        type: kind,
        label: String(object.label ?? "").trim(),
        ...(paperKey ? { paperKey } : {}),
        ...(object.metadata &&
        typeof object.metadata === "object" &&
        !Array.isArray(object.metadata)
          ? { metadata: object.metadata }
          : {}),
      };
    },
  );
  const edgeIds = new Set();
  const edges = (0, json_1.readArray)(root.edges, "edges").map(
    (entry, index) => {
      const object = (0, json_1.readObject)(entry, `edges[${index}]`);
      const kind = String(object.kind ?? object.type);
      if (!EDGE_KINDS.has(kind)) throw new Error(`Invalid edge kind ${kind}`);
      const id = String(object.id ?? "").trim();
      if (edgeIds.has(id)) throw new Error(`Duplicate edge ${id}`);
      edgeIds.add(id);
      return {
        id,
        source: String(object.source ?? "").trim(),
        target: String(object.target ?? "").trim(),
        kind,
        type: kind,
        ...(typeof object.label === "string" && object.label.trim()
          ? { label: object.label.trim() }
          : {}),
        confidence: Number(object.confidence) || 0,
        evidence: (0, types_1.normalizeEvidenceReferences)(object.evidence, {
          allowedAttachmentKeys: params.allowedAttachmentKeys,
        }),
        verified: object.verified === true,
      };
    },
  );
  const graph = (0, graph_1.mergeLiteratureGraph)({
    graph: (0, graph_1.createLiteratureGraph)({
      id: params.id,
      title: params.title || params.name,
      now: params.now,
    }),
    nodes,
    edges,
    now: params.now,
  });
  const integrity = (0, graph_1.validateLiteratureGraph)(graph);
  if (!integrity.valid) throw new Error(integrity.errors.join("; "));
  return graph;
}

export { parseLiteratureGraphResponse };
