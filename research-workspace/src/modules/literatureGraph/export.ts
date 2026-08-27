"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.literatureGraphToMermaid = void 0;
exports.exportLiteratureGraphMermaid = exportLiteratureGraphMermaid;
exports.exportLiteratureGraphJson = exportLiteratureGraphJson;
function label(value) { return String(value).replace(/["|\r\n]/g, "'"); }
function exportLiteratureGraphMermaid(graph) {
    const lines = ["graph LR"];
    const ids = new Map(graph.nodes.map((node, index) => [node.id, `node_${index}`]));
    for (const node of graph.nodes)
        lines.push(`  ${ids.get(node.id)}["${label(node.label)}"]`);
    for (const edge of graph.edges)
        lines.push(`  ${ids.get(edge.source)} -->|${label(edge.label || edge.kind)}| ${ids.get(edge.target)}`);
    return lines.join("\n");
}
function exportLiteratureGraphJson(graph) { return JSON.stringify(graph, null, 2); }
exports.literatureGraphToMermaid = exportLiteratureGraphMermaid;
