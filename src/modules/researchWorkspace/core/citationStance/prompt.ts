// @ts-nocheck -- Ported feature core is guarded by strict runtime parsers.
function sourceBlock(tag, value) {
  const escaped = String(value).replace(
    new RegExp(`</${tag}`, "gi"),
    `<\\/${tag}`,
  );
  return `<${tag} trust="source-data">\n${escaped}\n</${tag}>`;
}
function buildCitationStancePrompt(contexts, language = "English") {
  return `Classify citation contexts in ${language}. Supporting means the citing text supplies evidence consistent with a specific cited claim; contrasting means it disputes or reports conflicting evidence; methodological means it uses the method/data without evaluating the claim; mentioning is neutral background. Return JSON only: {results:[{contextId,stance,confidence,rationale,claim?,limitations}]}.
Do not infer stance from citation count or sentiment alone.\n${sourceBlock("citation_contexts", JSON.stringify(contexts))}`;
}

export { buildCitationStancePrompt };
