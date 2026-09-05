import type { LiteratureGraph } from "../contracts";
function label(value: unknown) {
  return String(value).replace(/["|\r\n]/g, "'");
}
function exportLiteratureGraphMermaid(graph: {
  nodes: { id: string; label: string }[];
  edges: { source: string; target: string; kind?: string; label?: string }[];
}) {
  const lines = ["graph LR"];
  const ids = new Map(
    graph.nodes.map((node, index) => [node.id, `node_${index}`]),
  );
  for (const node of graph.nodes)
    lines.push(`  ${ids.get(node.id)}["${label(node.label)}"]`);
  for (const edge of graph.edges)
    lines.push(
      `  ${ids.get(edge.source)} -->|${label(edge.label || edge.kind)}| ${ids.get(edge.target)}`,
    );
  return lines.join("\n");
}
function exportLiteratureGraphJson(graph: LiteratureGraph) {
  return JSON.stringify(graph, null, 2);
}

export {
  exportLiteratureGraphJson,
  exportLiteratureGraphMermaid,
  exportLiteratureGraphMermaid as literatureGraphToMermaid,
};
