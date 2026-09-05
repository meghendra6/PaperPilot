import type { MatrixColumn, PaperPromptInput } from "../contracts";
function sourceBlock(tag: string, value: unknown) {
  const escaped = String(value).replace(
    new RegExp(`</${tag}`, "gi"),
    `<\\/${tag}`,
  );
  return `<${tag} trust="source-data">\n${escaped}\n</${tag}>`;
}
function buildEvidenceMatrixExtractionPrompt(
  params: PaperPromptInput & { columns: MatrixColumn[] },
) {
  const cols = params.columns
    .map(
      (c) =>
        `- ${c.id} (${c.valueType}): ${c.question}${c.enumValues ? ` Allowed: ${c.enumValues.join(", ")}` : ""}${c.requiredEvidence ? " Evidence required." : ""}`,
    )
    .join("\n");
  const sourceIdentity = params.sourceID
    ? `Every evidence reference must also use sourceID ${JSON.stringify(params.sourceID)} and libraryID ${JSON.stringify(params.libraryID)}.`
    : "";
  return `Extract a row for an evidence matrix. Answer in ${params.responseLanguage || "English"}. Return JSON only: {title,cells:[{columnId,value,confidence,evidence,notes?}]}.
Do not infer unavailable values; use null. Use attachmentKey ${JSON.stringify(params.attachmentKey)} for evidence.
${sourceIdentity}
Columns:\n${cols}\n${sourceBlock("paper_context", params.paperContext)}`;
}

export { buildEvidenceMatrixExtractionPrompt };
