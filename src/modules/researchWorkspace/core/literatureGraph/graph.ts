import type {
  GraphEdge,
  GraphNode,
  LiteratureGraph,
  NamedArtifactInput,
} from "../contracts";
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
function createLiteratureGraph(
  paramsOrId: NamedArtifactInput | string,
  legacyName?: string,
  legacyNow?: string,
): LiteratureGraph {
  const params =
    typeof paramsOrId === "string"
      ? {
          id: paramsOrId,
          title: legacyName || "Literature Graph",
          now: legacyNow,
        }
      : paramsOrId;
  const now = params.now ?? new Date().toISOString();
  const title = (params.title || params.name || "Literature Graph").trim();
  return {
    schemaVersion: 2,
    id: params.id,
    title,
    name: title,
    nodes: [],
    edges: [],
    createdAt: now,
    updatedAt: now,
  };
}
function normalizeNode(node: GraphNode) {
  const kind = node.kind ?? node.type;
  if (!NODE_KINDS.has(kind ?? ""))
    throw new Error(`Node ${node.id} has an invalid type: ${kind}.`);
  const id = typeof node.id === "string" ? node.id.trim() : "";
  const label = typeof node.label === "string" ? node.label.trim() : "";
  if (!id || !label) throw new Error("Graph nodes require id and label.");
  return { ...node, id, label, kind, type: kind };
}
function normalizeEdge(edge: GraphEdge) {
  const kind = edge.kind ?? edge.type;
  if (!EDGE_KINDS.has(kind ?? ""))
    throw new Error(`Edge ${edge.id} has an invalid type: ${kind}.`);
  const id = typeof edge.id === "string" ? edge.id.trim() : "";
  const source = typeof edge.source === "string" ? edge.source.trim() : "";
  const target = typeof edge.target === "string" ? edge.target.trim() : "";
  if (!id || !source || !target)
    throw new Error("Graph edges require id, source, and target.");
  return {
    ...edge,
    id,
    source,
    target,
    kind,
    type: kind,
    ...(typeof edge.confidence === "number" && Number.isFinite(edge.confidence)
      ? { confidence: Math.max(0, Math.min(1, edge.confidence)) }
      : {}),
    evidence: [...(edge.evidence || [])],
    verified: edge.verified === true,
  };
}
function addLiteratureNode(
  graph: LiteratureGraph,
  rawNode: GraphNode,
  now = new Date().toISOString(),
) {
  const node = normalizeNode(rawNode);
  const nodes = graph.nodes.some((entry) => entry.id === node.id)
    ? graph.nodes.map((entry) =>
        entry.id === node.id ? { ...entry, ...node } : entry,
      )
    : [...graph.nodes, node];
  return { ...graph, nodes, updatedAt: now };
}
function addLiteratureEdge(
  graph: LiteratureGraph,
  rawEdge: GraphEdge,
  now = new Date().toISOString(),
) {
  const edge = normalizeEdge(rawEdge);
  const ids = new Set(graph.nodes.map((node) => node.id));
  if (!ids.has(edge.source) || !ids.has(edge.target))
    throw new Error(`Edge ${edge.id} references missing node`);
  if (edge.source === edge.target)
    throw new Error("Self edges are not allowed");
  return {
    ...graph,
    edges: [...graph.edges.filter((entry) => entry.id !== edge.id), edge],
    updatedAt: now,
  };
}
function mergeLiteratureGraph(params: {
  graph: LiteratureGraph;
  nodes?: GraphNode[];
  edges?: GraphEdge[];
  now?: string;
}) {
  let graph = params.graph;
  for (const node of params.nodes ?? [])
    graph = addLiteratureNode(graph, node, params.now);
  for (const edge of params.edges ?? [])
    graph = addLiteratureEdge(graph, edge, params.now);
  return graph;
}
function validateLiteratureGraph(graph: LiteratureGraph) {
  const errors = [];
  const warnings = [];
  const ids = new Set();
  for (const node of graph.nodes) {
    if (ids.has(node.id)) errors.push(`Duplicate node ${node.id}`);
    ids.add(node.id);
    if (!NODE_KINDS.has(node.kind ?? node.type ?? ""))
      errors.push(`Invalid node type ${node.id}`);
  }
  const edgeIds = new Set();
  for (const edge of graph.edges) {
    if (edgeIds.has(edge.id)) errors.push(`Duplicate edge ${edge.id}`);
    edgeIds.add(edge.id);
    if (!EDGE_KINDS.has(edge.kind ?? edge.type ?? ""))
      errors.push(`Invalid edge type ${edge.id}`);
    if (!ids.has(edge.source) || !ids.has(edge.target))
      errors.push(`Dangling edge ${edge.id}`);
    if (edge.source === edge.target) errors.push(`Self edge ${edge.id}`);
    if (!edge.evidence.length) warnings.push(`Edge ${edge.id} has no evidence`);
    if (!edge.verified) warnings.push(`Edge ${edge.id} is unverified`);
  }
  return { valid: errors.length === 0, errors, warnings };
}
function shortestLiteraturePath(
  graph: LiteratureGraph,
  source: string,
  target: string,
) {
  if (
    !graph.nodes.some((node) => node.id === source) ||
    !graph.nodes.some((node) => node.id === target)
  )
    return [];
  if (source === target) return [source];
  const adjacency = new Map<string, string[]>();
  for (const edge of graph.edges) {
    adjacency.set(edge.source, [
      ...(adjacency.get(edge.source) || []),
      edge.target,
    ]);
    adjacency.set(edge.target, [
      ...(adjacency.get(edge.target) || []),
      edge.source,
    ]);
  }
  const queue = [[source]];
  const seen = new Set([source]);
  while (queue.length) {
    const path = queue.shift()!;
    for (const next of adjacency.get(path[path.length - 1]) || []) {
      if (seen.has(next)) continue;
      const candidate = [...path, next];
      if (next === target) return candidate;
      seen.add(next);
      queue.push(candidate);
    }
  }
  return [];
}
function connectedComponents(graph: LiteratureGraph) {
  const result = [];
  const seen = new Set();
  for (const node of graph.nodes) {
    if (seen.has(node.id)) continue;
    const stack = [node.id];
    const component = [];
    while (stack.length) {
      const current = stack.pop()!;
      if (seen.has(current)) continue;
      seen.add(current);
      component.push(current);
      for (const edge of graph.edges) {
        if (edge.source === current && !seen.has(edge.target))
          stack.push(edge.target);
        if (edge.target === current && !seen.has(edge.source))
          stack.push(edge.source);
      }
    }
    result.push(component);
  }
  return result;
}

function literatureGraphIntegrityIssues(graph: LiteratureGraph) {
  const integrity = validateLiteratureGraph(graph);
  return [...integrity.errors, ...integrity.warnings];
}
/** Backward-compatible, descriptive aliases used by the workspace UI. */

export {
  addLiteratureEdge,
  addLiteratureNode,
  connectedComponents,
  createLiteratureGraph,
  shortestLiteraturePath as findLiteratureGraphPath,
  shortestLiteraturePath as findShortestLiteraturePath,
  literatureGraphIntegrityIssues as graphIntegrityIssues,
  literatureGraphIntegrityIssues,
  mergeLiteratureGraph,
  shortestLiteraturePath,
  validateLiteratureGraph,
};
