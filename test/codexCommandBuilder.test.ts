import { test } from "node:test";
import * as assert from "node:assert/strict";

import {
  buildCodexExecCommand,
  buildCodexLoginStatusCommand,
  buildCodexResumeCommand,
  normalizeCodexApprovalMode,
} from "../src/modules/codex/commandBuilder";
import { buildPaperWorkspacePath } from "../src/modules/workspace/pathBuilder";
import {
  buildCodexWorkspacePrompt,
  buildContextPayload,
  buildGeminiWorkspacePrompt,
} from "../src/modules/context/promptPreviewBuilder";
import { deriveCodexRunState } from "../src/modules/codex/runState";
import {
  parseCodexOutput,
  parseCodexOutputText,
} from "../src/modules/codex/outputParser";
import {
  getGeminiBuiltInModels,
  loadCodexCachedModels,
  mergeModelOptions,
  normalizeGeminiModel,
  normalizeGeminiModelList,
  parseAllowedModels,
} from "../src/modules/codex/modelOptions";
import { buildWorkspaceArtifacts } from "../src/modules/context/workspaceArtifacts";
import { selectRelevantChunks } from "../src/modules/context/retriever";
import { redactPath } from "../src/modules/workspace/redaction";

test("buildCodexLoginStatusCommand uses codex login status", () => {
  assert.deepEqual(buildCodexLoginStatusCommand(), [
    "codex",
    "login",
    "status",
  ]);
});

test("buildCodexExecCommand builds the expected first-question command", () => {
  assert.deepEqual(
    buildCodexExecCommand({
      cd: "/tmp/paper-workspace",
      model: "gpt-5-codex",
      sandbox: "read-only",
      approvalMode: "never",
      skipGitRepoCheck: true,
    }),
    [
      "codex",
      "--ask-for-approval",
      "never",
      "exec",
      "--json",
      "--cd",
      "/tmp/paper-workspace",
      "--model",
      "gpt-5-codex",
      "--sandbox",
      "read-only",
      "--skip-git-repo-check",
      "-",
    ],
  );
});

test("buildCodexExecCommand adds web search before exec when enabled", () => {
  assert.deepEqual(
    buildCodexExecCommand({
      cd: "/tmp/paper-workspace",
      model: "gpt-5-codex",
      webSearchEnabled: true,
    }),
    [
      "codex",
      "--search",
      "exec",
      "--json",
      "--cd",
      "/tmp/paper-workspace",
      "--model",
      "gpt-5-codex",
      "--sandbox",
      "read-only",
      "-",
    ],
  );
});

test("buildCodexExecCommand normalizes legacy approval mode labels", () => {
  assert.deepEqual(
    buildCodexExecCommand({
      cd: "/tmp/paper-workspace",
      model: "gpt-5-codex",
      approvalMode: "suggested",
    }),
    [
      "codex",
      "--ask-for-approval",
      "never",
      "exec",
      "--json",
      "--cd",
      "/tmp/paper-workspace",
      "--model",
      "gpt-5-codex",
      "--sandbox",
      "read-only",
      "-",
    ],
  );
});

test("normalizeCodexApprovalMode drops unsupported approval labels", () => {
  assert.equal(normalizeCodexApprovalMode("unsupported-mode"), undefined);
  assert.equal(normalizeCodexApprovalMode("manual"), "untrusted");
  assert.equal(normalizeCodexApprovalMode("auto-edit"), "never");
});

test("buildCodexExecCommand includes image flag when provided", () => {
  assert.deepEqual(
    buildCodexExecCommand({
      cd: "/tmp/paper-workspace",
      model: "gpt-5-codex",
      imagePath: "/tmp/paper-workspace/figure.png",
    }),
    [
      "codex",
      "exec",
      "--json",
      "--cd",
      "/tmp/paper-workspace",
      "--model",
      "gpt-5-codex",
      "--sandbox",
      "read-only",
      "--image",
      "/tmp/paper-workspace/figure.png",
      "-",
    ],
  );
});

test("buildCodexResumeCommand builds the expected follow-up command", () => {
  assert.deepEqual(buildCodexResumeCommand({ cd: "/tmp/paper-workspace" }), [
    "codex",
    "exec",
    "--json",
    "--cd",
    "/tmp/paper-workspace",
    "--skip-git-repo-check",
    "resume",
    "--last",
    "-",
  ]);
});

test("buildCodexResumeCommand adds web search before exec when enabled", () => {
  assert.deepEqual(
    buildCodexResumeCommand({
      cd: "/tmp/paper-workspace",
      webSearchEnabled: true,
    }),
    [
      "codex",
      "--search",
      "exec",
      "--json",
      "--cd",
      "/tmp/paper-workspace",
      "--skip-git-repo-check",
      "resume",
      "--last",
      "-",
    ],
  );
});

test("buildPaperWorkspacePath creates a stable per-paper workspace path", () => {
  assert.equal(
    buildPaperWorkspacePath({
      root: "/tmp/workspaces",
      itemID: 42,
      title: "Attention Is All You Need",
    }),
    "/tmp/workspaces/42-attention-is-all-you-need",
  );
});

test("buildContextPayload assembles a prompt preview from question and selection", () => {
  const payload = buildContextPayload({
    question: "Summarize the contribution",
    responseLanguage: "Korean",
    selectedText: "Transformers replace recurrence with attention.",
    pageNumber: 3,
    annotationIDs: ["A1", "A2"],
  });

  assert.equal(
    payload.promptPreview,
    [
      "Question: Summarize the contribution",
      "Preferred response language: Respond in Korean. Use English technical terms for technical terminology where appropriate.",
      "Selected text: Transformers replace recurrence with attention.",
      "Page: 3",
      "Annotations: A1, A2",
    ].join("\n"),
  );
});

test("deriveCodexRunState derives workspace path and status from login state", () => {
  const state = deriveCodexRunState({
    workspaceRoot: "/tmp/workspaces",
    model: "gpt-5-codex",
    itemID: 7,
    title: "Attention Is All You Need",
    loginState: "ready",
  });

  assert.deepEqual(state, {
    workspacePath: "/tmp/workspaces/7-attention-is-all-you-need",
    model: "gpt-5-codex",
    reasoningEffort: undefined,
    loginState: "ready",
    runStatus: "ready",
    latestEventType: "bootstrap",
  });
});

test("parseCodexOutput keeps assistant-facing delta and message content", () => {
  const parsed = parseCodexOutput(
    [
      JSON.stringify({ type: "delta", delta: "Hello" }),
      JSON.stringify({ type: "delta", delta: "world" }),
      JSON.stringify({ type: "message", content: [{ text: "Final answer" }] }),
    ].join("\n"),
  );

  assert.equal(parsed.text, ["Hello", "world", "Final answer"].join("\n"));
  assert.equal(parsed.latestEventType, "message");
});

test("parseCodexOutput ignores reasoning and command output noise in favor of agent messages", () => {
  const raw = [
    JSON.stringify({ type: "thread.started", thread_id: "t1" }),
    JSON.stringify({
      type: "item.completed",
      item: { id: "r1", type: "reasoning", text: "**Thinking**" },
    }),
    JSON.stringify({
      type: "item.completed",
      item: {
        id: "c1",
        type: "command_execution",
        command: "bash -lc ls",
        aggregated_output: "debug.txt\nmetadata.json",
      },
    }),
    JSON.stringify({
      type: "item.completed",
      item: { id: "a1", type: "agent_message", text: "# Answer\n\n- bullet" },
    }),
    JSON.stringify({ type: "turn.completed" }),
  ].join("\n");

  assert.equal(parseCodexOutput(raw).text, "# Answer\n\n- bullet");
});

test("parseCodexOutputText returns only final assistant message text from agent_message events", () => {
  const raw = [
    JSON.stringify({
      type: "item.completed",
      item: { id: "a1", type: "agent_message", text: "Final answer only" },
    }),
    JSON.stringify({ type: "turn.completed" }),
  ].join("\n");

  assert.equal(parseCodexOutputText(raw), "Final answer only");
});

test("parseAllowedModels parses a comma-separated model list", () => {
  assert.deepEqual(parseAllowedModels("gpt-5-codex, o4-mini ,"), [
    "gpt-5-codex",
    "o4-mini",
  ]);
});

test("mergeModelOptions keeps recent-first unique order", () => {
  assert.deepEqual(
    mergeModelOptions(["gpt-5-codex", "o4-mini"], ["o4-mini", "gpt-5"]),
    ["gpt-5-codex", "o4-mini", "gpt-5"],
  );
});

test("getGeminiBuiltInModels exposes the supported Gemini CLI model list", () => {
  assert.deepEqual(getGeminiBuiltInModels(), [
    "gemini-3.1-pro-preview",
    "gemini-3-flash-preview",
  ]);
});

test("normalizeGeminiModel rewrites legacy Gemini ids to preview ids", () => {
  assert.equal(
    normalizeGeminiModel("gemini-3.1-pro"),
    "gemini-3.1-pro-preview",
  );
  assert.equal(
    normalizeGeminiModel("gemini-3-flash"),
    "gemini-3-flash-preview",
  );
  assert.equal(
    normalizeGeminiModel("gemini-2.5-pro"),
    "gemini-3.1-pro-preview",
  );
  assert.equal(
    normalizeGeminiModel("gemini-2.5-flash"),
    "gemini-3-flash-preview",
  );
  assert.equal(
    normalizeGeminiModel(" gemini-3.1-pro-preview "),
    "gemini-3.1-pro-preview",
  );
});

test("normalizeGeminiModelList keeps order while deduplicating aliases", () => {
  assert.deepEqual(
    normalizeGeminiModelList([
      "gemini-2.5-pro",
      "gemini-3.1-pro",
      "gemini-3.1-pro-preview",
      "gemini-2.5-flash",
      "gemini-3-flash",
      "custom-model",
    ]),
    ["gemini-3.1-pro-preview", "gemini-3-flash-preview", "custom-model"],
  );
});

test("buildWorkspaceArtifacts assembles paper and context files", () => {
  const artifacts = buildWorkspaceArtifacts({
    title: "Attention Is All You Need",
    authors: ["Ashish Vaswani", "Noam Shazeer"],
    year: "2017",
    itemKey: "ITEMKEY",
    attachmentKey: "ATTACHKEY",
    abstractNote: "Transformer architecture.",
    fullText: "Attention replaces recurrence.",
    markdownText:
      "# Attention Is All You Need\n\nAttention replaces recurrence.",
    structuredContent: [
      { type: "heading", content: "Attention Is All You Need" },
    ],
    extractionMethod: "opendataloader-pdf",
    extractionNotes: ["Used OpenDataLoader PDF extraction."],
    payload: {
      selectedText: "Transformers replace recurrence with attention.",
      annotationIDs: ["A1"],
      retrievedChunks: [],
      promptPreview: "Question: Summarize",
    },
    recentTurns: [
      { role: "user", text: "Summarize this paper", createdAt: "now" },
    ],
  });

  assert.equal(artifacts.metadata.title, "Attention Is All You Need");
  assert.equal(artifacts.metadata.itemKey, "ITEMKEY");
  assert.equal(artifacts.metadata.attachmentKey, "ATTACHKEY");
  assert.equal(artifacts.selection.promptPreview, "Question: Summarize");
  assert.equal(artifacts.annotations.length, 0);
  assert.match(artifacts.paperText, /Structured Markdown/);
  assert.match(artifacts.contextIndexText, /paper\.md/);
  assert.match(artifacts.contextIndexText, /paper\.json/);
  assert.match(artifacts.contextIndexText, /selection\.json/);
  assert.equal(artifacts.paperMarkdownText.includes("# Attention"), true);
  assert.deepEqual(artifacts.paperJson.document, [
    { type: "heading", content: "Attention Is All You Need" },
  ]);
  assert.equal(artifacts.recentTurns.length, 1);
});

test("buildCodexWorkspacePrompt tells Codex to inspect paper workspace files first", () => {
  const prompt = buildCodexWorkspacePrompt("Question: Summarize the paper");

  assert.match(
    prompt,
    /Before answering, inspect the workspace files in this directory\./,
  );
  assert.match(prompt, /Read CONTEXT_INDEX\.md/);
  assert.match(prompt, /Read paper\.md/);
  assert.match(prompt, /Read paper\.json/);
  assert.match(prompt, /paper\.txt/);
  assert.match(prompt, /selection\.json/);
  assert.match(
    prompt,
    /Ground your answer in the workspace contents rather than guessing\./,
  );
  assert.match(prompt, /easy to read in a tall reader chat pane/i);
  assert.match(
    prompt,
    /workspace-grounded facts, reasonable inference, and unknowns/i,
  );
  assert.match(prompt, /Do not mention internal workspace filenames/i);
  assert.match(prompt, /Do not include source links, raw URLs, or file paths/i);
  assert.match(prompt, /User request:\nQuestion: Summarize the paper/);
});

test("buildGeminiWorkspacePrompt applies the same filename and link guardrails", () => {
  const prompt = buildGeminiWorkspacePrompt("Question: Summarize the paper");

  assert.match(prompt, /inspect the workspace files in this directory/i);
  assert.match(prompt, /Prefer paper\.md and paper\.json over paper\.txt/i);
  assert.match(prompt, /Do not mention internal workspace filenames/i);
  assert.match(prompt, /Do not include source links, raw URLs, or file paths/i);
});

test("buildCodexWorkspacePrompt explicitly instructs web search when enabled", () => {
  const prompt = buildCodexWorkspacePrompt(
    "Question: Search the web for follow-up work",
    true,
  );

  assert.match(prompt, /If the user explicitly asks for web search/);
  assert.match(
    prompt,
    /separate external findings from workspace-grounded claims/,
  );
});

test("selectRelevantChunks prioritizes chunks that match the query", () => {
  const chunks = selectRelevantChunks({
    text: [
      "Transformers replace recurrence with attention mechanisms.",
      "Convolution is another family of architectures.",
      "Attention enables parallelization for sequence transduction.",
    ].join("\n\n"),
    query: "attention transformers",
    chunkSize: 80,
    overlapSize: 0,
    topK: 2,
  });

  assert.equal(chunks.length, 2);
  assert.match(chunks[0], /attention|Transformers/i);
});

test("redactPath keeps only the tail segments", () => {
  assert.equal(
    redactPath("/tmp/paper-pilot/42-attention-is-all-you-need"),
    "…/paper-pilot/42-attention-is-all-you-need",
  );
});

test("buildCodexResumeCommand prefers explicit session ids over --last", () => {
  assert.deepEqual(
    buildCodexResumeCommand({
      cd: "/tmp/paper-workspace",
      sessionId: "thread-123",
    }),
    [
      "codex",
      "exec",
      "--json",
      "--cd",
      "/tmp/paper-workspace",
      "--skip-git-repo-check",
      "resume",
      "thread-123",
      "-",
    ],
  );
});

test("loadCodexCachedModels reads slugs from models cache", async () => {
  const previousZotero = (globalThis as { Zotero?: unknown }).Zotero;
  (globalThis as { Zotero?: unknown }).Zotero = {
    getProfileDirectory: () => ({
      path: "/Users/meghendra/Library/Application Support/Zotero/Profiles/test.default",
    }),
    File: {
      getContentsAsync: async () =>
        JSON.stringify({
          models: [
            { slug: "gpt-5.4", visibility: "list" },
            { slug: "gpt-5-codex", visibility: "list" },
            { slug: "hidden-model", visibility: "hidden" },
          ],
        }),
    },
  };

  try {
    assert.deepEqual(await loadCodexCachedModels(), ["gpt-5.4", "gpt-5-codex"]);
  } finally {
    (globalThis as { Zotero?: unknown }).Zotero = previousZotero;
  }
});
