import type { ContextPayload } from "./types";
import { buildResponseLanguageInstruction } from "../translation/responseLanguage";

export function buildPromptPreview(params: {
  question: string;
  selectedText?: string;
  surroundingText?: string;
  annotationIDs?: string[];
  pageNumber?: number;
  responseLanguage?: string;
}) {
  const sections = [
    `Question: ${params.question}`,
    params.responseLanguage
      ? `Preferred response language: ${buildResponseLanguageInstruction(params.responseLanguage)}`
      : undefined,
    params.selectedText ? `Selected text: ${params.selectedText}` : undefined,
    params.surroundingText
      ? `Surrounding context: ${params.surroundingText}`
      : undefined,
    typeof params.pageNumber === "number"
      ? `Page: ${params.pageNumber}`
      : undefined,
    params.annotationIDs?.length
      ? `Annotations: ${params.annotationIDs.join(", ")}`
      : undefined,
  ].filter(Boolean);

  return sections.join("\n");
}

export function buildContextPayload(params: {
  question: string;
  selectedText?: string;
  surroundingText?: string;
  pageNumber?: number;
  annotationIDs?: string[];
  retrievedChunks?: string[];
  responseLanguage?: string;
  recentTurns?: Array<{ role: string; text: string }>;
}): ContextPayload {
  const payload = {
    selectedText: params.selectedText,
    surroundingText: params.surroundingText,
    pageNumber: params.pageNumber,
    annotationIDs: params.annotationIDs,
    retrievedChunks: params.retrievedChunks ?? [],
    recentTurns: params.recentTurns ?? [],
    promptPreview: buildPromptPreview(params),
  };

  if (payload.retrievedChunks.length) {
    payload.promptPreview = [
      payload.promptPreview,
      "",
      "Retrieved chunks:",
      ...payload.retrievedChunks.map(
        (chunk, index) => `[${index + 1}] ${chunk}`,
      ),
    ].join("\n");
  }

  if (payload.recentTurns.length) {
    payload.promptPreview = [
      payload.promptPreview,
      "",
      "Recent turns:",
      ...payload.recentTurns.map((turn) => `${turn.role}: ${turn.text}`),
    ].join("\n");
  }
  return payload;
}

function buildWorkspaceAnswerStyleRules() {
  return [
    "Keep the final answer compact and easy to read in a tall reader chat pane.",
    "Distinguish clearly between workspace-grounded facts, reasonable inference, and unknowns.",
    "Do not mention internal workspace filenames like paper.md, paper.json, paper.txt, selection.json, recent-turns.json, metadata.json, annotations.json, or CONTEXT_INDEX.md in the final answer; refer to them naturally instead.",
    "Do not include source links, raw URLs, or file paths in the final answer unless the user explicitly asks for them.",
    "If the user asks for a structured format, follow that schema exactly.",
  ];
}

export function buildCodexWorkspacePrompt(
  promptPreview: string,
  webSearchEnabled = false,
) {
  return [
    "You are running inside a Zotero paper workspace.",
    "Before answering, inspect the workspace files in this directory.",
    "Priority order:",
    "1. Read CONTEXT_INDEX.md for the file map.",
    "2. Read paper.md for the structured paper content.",
    "3. Read paper.json when layout-aware or element-level details matter.",
    "4. Use paper.txt as a compatibility fallback summary.",
    "5. Use selection.json for the active selection/page context.",
    "6. Use recent-turns.json for conversation continuity.",
    "7. Use annotations.json and metadata.json when relevant.",
    "Ground your answer in the workspace contents rather than guessing.",
    ...buildWorkspaceAnswerStyleRules(),
    webSearchEnabled
      ? "If the user explicitly asks for web search, current external information, or sources beyond the workspace, use web search instead of staying limited to the local files."
      : undefined,
    webSearchEnabled
      ? "When you use web search, clearly separate external findings from workspace-grounded claims."
      : undefined,
    "",
    "User request:",
    promptPreview,
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildGeminiWorkspacePrompt(promptPreview: string) {
  return [
    "You are helping inside a Zotero paper workspace.",
    "Before answering, inspect the workspace files in this directory when they are relevant.",
    "Prefer paper.md and paper.json over paper.txt when they are available.",
    "Ground your answer in the local paper workspace contents rather than guessing.",
    ...buildWorkspaceAnswerStyleRules(),
    "",
    "User request:",
    promptPreview,
  ].join("\n");
}
