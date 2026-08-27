"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildPaperToCodePrompt = buildPaperToCodePrompt;
function sourceBlock(tag, value) {
    const escaped = String(value).replace(new RegExp(`</${tag}`, "gi"), `<\\/${tag}`);
    return `<${tag} trust="source-data">\n${escaped}\n</${tag}>`;
}
function buildPaperToCodePrompt(params) {
    return `Translate the paper's method into an implementation-grade specification. Answer in ${params.responseLanguage || "English"}.
Return JSON only: {objective,inputs,outputs,summary,pseudocode,tensorTrace:[{id,stage,inputShape,outputShape,operation,stateChanges,memoryAccess,evidence}],invariants:[{id,statement,consequence,evidence}],complexity:{time,memory,communication?,assumptions,evidence},ambiguities:[{id,question,risk,suggestedResolution,evidence}],paperCodeDivergences:[{area,paperStatement,codeBehavior,impact,evidence}],minimalReproduction,validationTests}.
Use attachmentKey ${JSON.stringify(params.attachmentKey)} in all evidence. Do not invent tensor shapes or complexity; use "unspecified" and create an ambiguity when the paper omits them. Keep pseudocode language-neutral.
${sourceBlock("paper_context", params.paperContext)}`;
}
