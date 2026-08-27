"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildCrossPaperQuestionPrompt = buildCrossPaperQuestionPrompt;
exports.buildCrossPaperGradePrompt = buildCrossPaperGradePrompt;
function dataBlock(tag, value, trust = "source-data") {
    const escaped = String(value).replace(new RegExp(`</${tag}`, "gi"), `<\\/${tag}`);
    return `<${tag} trust="${trust}">\n${escaped}\n</${tag}>`;
}
function buildCrossPaperQuestionPrompt(params) { return `Create one advanced cross-paper mastery question in ${params.responseLanguage || "English"}. Test causal/mechanistic distinctions, evidence, limitations, or transfer—not trivia. Return JSON only: {id,mode,prompt,paperKeys,difficulty,criteria:[{id,description,maxScore,paperKeys,requiredClaims}],evidence:{paperKey:[evidence references]}}. Keep rubrics hidden from learner UI.\n${dataBlock("papers", JSON.stringify(params.papers))}`; }
function buildCrossPaperGradePrompt(params) { return `Grade the answer against the hidden rubric. Return JSON only: {criterionScores:[{criterionId,score,feedback,evidence}],feedback,misconceptions,graderConfidence}. Never award more than maxScore. Answer in ${params.responseLanguage || "English"}.\n${dataBlock("question", JSON.stringify(params.question), "validated-data")}\n${dataBlock("learner_answer", params.answer, "untrusted-data")}\n${dataBlock("papers", JSON.stringify(params.paperContexts))}`; }
