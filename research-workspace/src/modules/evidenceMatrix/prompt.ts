"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildEvidenceMatrixExtractionPrompt = buildEvidenceMatrixExtractionPrompt;
function sourceBlock(tag, value) {
    const escaped = String(value).replace(new RegExp(`</${tag}`, "gi"), `<\\/${tag}`);
    return `<${tag} trust="source-data">\n${escaped}\n</${tag}>`;
}
function buildEvidenceMatrixExtractionPrompt(params) {
    const cols = params.columns.map(c => `- ${c.id} (${c.valueType}): ${c.question}${c.enumValues ? ` Allowed: ${c.enumValues.join(", ")}` : ""}${c.requiredEvidence ? " Evidence required." : ""}`).join("\n");
    return `Extract a row for an evidence matrix. Answer in ${params.responseLanguage || "English"}. Return JSON only: {title,cells:[{columnId,value,confidence,evidence,notes?}]}.
Do not infer unavailable values; use null. Use attachmentKey ${JSON.stringify(params.attachmentKey)} for evidence.
Columns:\n${cols}\n${sourceBlock("paper_context", params.paperContext)}`;
}
