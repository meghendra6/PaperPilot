/* eslint-disable @typescript-eslint/triple-slash-reference */
/// <reference path="../typings/global.d.ts" />

import { test } from "node:test";
import * as assert from "node:assert/strict";

import * as geminiRunner from "../src/modules/gemini/runner";
import { checkShellSyntax } from "./helpers/shellSyntax";

type BuildGeminiCommand = (params: {
  promptPath: string;
  outputPath: string;
  stderrPath: string;
  exitCodePath: string;
  pidPath: string;
  workspacePath: string;
  question: string;
  model: string;
  resumeSessionId?: string;
  executablePath: string;
  profile: "chat" | "analysis" | "discovery";
  approvalMode: string;
  sandboxSupported?: boolean;
}) => string;

test("buildGeminiCommand uses plan mode for hidden analysis runs", () => {
  const buildGeminiCommand = (
    geminiRunner as unknown as { buildGeminiCommand?: BuildGeminiCommand }
  ).buildGeminiCommand;

  assert.equal(typeof buildGeminiCommand, "function");

  const script = buildGeminiCommand!({
    promptPath: "/tmp/Paper Pilot/Smith's paper/gemini-prompt.txt",
    outputPath: "/tmp/Paper Pilot/Smith's paper/gemini-output.txt",
    stderrPath: "/tmp/Paper Pilot/Smith's paper/gemini-stderr.log",
    exitCodePath: "/tmp/Paper Pilot/Smith's paper/gemini-exit.txt",
    pidPath: "/tmp/Paper Pilot/Smith's paper/gemini-pid.txt",
    workspacePath: "/tmp/Paper Pilot/Smith's paper",
    question: "Summarize this paper",
    model: "gemini-3.1-pro-preview",
    executablePath: "/opt/Homebrew Tools/gemini's bin/gemini",
    profile: "analysis",
    approvalMode: "yolo",
    sandboxSupported: true,
  });

  const syntax = checkShellSyntax(script);

  assert.equal(syntax.status, 0, syntax.stderr);
  assert.doesNotMatch(script, /PROMPT=\$\(cat/);
  assert.match(
    script,
    /cat '\/tmp\/Paper Pilot\/Smith'\\''s paper\/gemini-prompt\.txt' \|/,
  );
  assert.match(script, /'\/opt\/Homebrew Tools\/gemini'\\''s bin\/gemini'/);
  assert.match(script, /--skip-trust/);
  assert.match(script, /--approval-mode 'plan'/);
  assert.doesNotMatch(script, /--yolo/);
  assert.match(script, /--sandbox/);
  assert.match(script, /-p ''/);
  assert.match(
    script,
    /2> '\/tmp\/Paper Pilot\/Smith'\\''s paper\/gemini-stderr\.log'/,
  );
});

test("buildGeminiCommand defaults chat to approval prompts without yolo", () => {
  const buildGeminiCommand = (
    geminiRunner as unknown as { buildGeminiCommand?: BuildGeminiCommand }
  ).buildGeminiCommand!;
  const script = buildGeminiCommand({
    promptPath: "/tmp/paper/prompt.txt",
    outputPath: "/tmp/paper/output.txt",
    stderrPath: "/tmp/paper/stderr.log",
    exitCodePath: "/tmp/paper/exit.txt",
    pidPath: "/tmp/paper/pid.txt",
    workspacePath: "/tmp/paper",
    question: "Explain this result",
    model: "gemini-3.1-pro-preview",
    executablePath: "gemini",
    profile: "chat",
    approvalMode: "unsupported",
  });

  assert.equal(checkShellSyntax(script).status, 0);
  assert.match(script, /--approval-mode 'default'/);
  assert.doesNotMatch(script, /(?:^|\s)--yolo(?:\s|$)/);
});

for (const approvalMode of ["default", "auto_edit", "yolo", "plan"]) {
  test(`buildGeminiCommand allows ${approvalMode} for visible chat`, () => {
    const buildGeminiCommand = (
      geminiRunner as unknown as { buildGeminiCommand?: BuildGeminiCommand }
    ).buildGeminiCommand!;
    const script = buildGeminiCommand({
      promptPath: "/tmp/paper/prompt.txt",
      outputPath: "/tmp/paper/output.txt",
      stderrPath: "/tmp/paper/stderr.log",
      exitCodePath: "/tmp/paper/exit.txt",
      pidPath: "/tmp/paper/pid.txt",
      workspacePath: "/tmp/paper",
      question: "Explain this result",
      model: "gemini-3.1-pro-preview",
      executablePath: "gemini",
      profile: "chat",
      approvalMode,
    });

    assert.equal(checkShellSyntax(script).status, 0);
    assert.match(script, new RegExp(`--approval-mode '?${approvalMode}'?`));
  });
}

test("normalizeGeminiApprovalMode rejects values outside the CLI allowlist", () => {
  assert.equal(
    geminiRunner.normalizeGeminiApprovalMode("auto_edit"),
    "auto_edit",
  );
  assert.equal(geminiRunner.normalizeGeminiApprovalMode(" yolo "), "yolo");
  assert.equal(geminiRunner.normalizeGeminiApprovalMode("always"), "default");
});

test("Gemini progress keeps successful stderr out of parsed assistant text", async () => {
  const previousZotero = (globalThis as { Zotero?: unknown }).Zotero;
  (globalThis as { Zotero?: unknown }).Zotero = {
    File: {
      getContentsAsync: async (path: string) =>
        path.endsWith("output.txt")
          ? "answer"
          : path.endsWith("stderr.log")
            ? "secret-local-stderr-marker"
            : "0",
    },
  };

  try {
    const progress = await geminiRunner.readGeminiRunProgress({
      outputPath: "/tmp/output.txt",
      stderrPath: "/tmp/stderr.log",
      exitCodePath: "/tmp/exit.txt",
    });
    assert.equal(progress.parsedOutput, "answer");
    assert.match(progress.rawOutput, /secret-local-stderr-marker/);
    assert.doesNotMatch(progress.parsedOutput, /secret-local-stderr-marker/);
  } finally {
    (globalThis as { Zotero?: unknown }).Zotero = previousZotero;
  }
});
