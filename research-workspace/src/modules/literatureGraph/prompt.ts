"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildLiteratureGraphPrompt = buildLiteratureGraphPrompt;
function sourceBlock(tag, value) {
    const escaped = String(value).replace(new RegExp(`</${tag}`, "gi"), `<\\/${tag}`);
    return `<${tag} trust="source-data">\n${escaped}\n</${tag}>`;
}
function buildLiteratureGraphPrompt(params) { return `Build an evidence-grounded literature graph in ${params.responseLanguage || "English"}. Return JSON only: {nodes:[{id,kind,label,paperKey?,metadata?}],edges:[{id,source,target,kind,label?,confidence,evidence,verified}]}. Allowed kinds: paper,concept,claim,method,dataset. Edge kinds: introduces,uses,extends,improves,challenges,supports,contradicts,compares,evaluates_on,related. Every non-trivial edge must carry evidence from one supplied paper. Mark inferred edges verified:false.\n${sourceBlock("papers", JSON.stringify(params.papers))}`; }
