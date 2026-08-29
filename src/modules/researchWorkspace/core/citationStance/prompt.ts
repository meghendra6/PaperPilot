// @ts-nocheck -- Ported feature core is guarded by strict runtime parsers.
function sourceBlock(tag, value) {
  const escaped = String(value).replace(
    new RegExp(`</${tag}`, "gi"),
    `<\\/${tag}`,
  );
  return `<${tag} trust="source-data">\n${escaped}\n</${tag}>`;
}
function buildCitationStancePrompt(contexts, language = "English") {
  return `Classify each admitted citation context in ${language}. Allowed stances: supporting, contrasting, methodological, mentioning, background, uncertain. Supporting means the citing text supplies evidence consistent with a specific cited claim; contrasting means it disputes or reports conflicting evidence; methodological means it uses the method or data without evaluating the claim; mentioning means it briefly refers to the cited work without using it as broader background; background means it supplies neutral framing or prior-work context; uncertain means the local text is insufficient. Return JSON only: {results:[{contextId,stance,confidence,rationale,claim?,limitations}]}.
Stance is a review signal, not a truth verdict. Do not infer stance from citation count, sentiment, bibliography metadata, or resolution status. Never invent a context ID, quote, citation, or cited-work identity.\n${sourceBlock("citation_contexts", JSON.stringify(contexts))}`;
}

export { buildCitationStancePrompt };
