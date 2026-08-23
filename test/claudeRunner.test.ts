/* eslint-disable @typescript-eslint/triple-slash-reference */
/// <reference path="../typings/global.d.ts" />

import { test } from "node:test";
import * as assert from "node:assert/strict";

import * as claudeRunner from "../src/modules/claude/runner";
import { checkShellSyntax } from "./helpers/shellSyntax";

type BuildClaudeCommand = (params: {
  promptPath: string;
  outputPath: string;
  stderrPath: string;
  exitCodePath: string;
  pidPath: string;
  workspacePath: string;
  model: string;
  resumeSessionId?: string;
  executablePath: string;
  permissionMode: string;
  outputSchema?: Record<string, unknown>;
}) => string;

test("buildClaudeCommand streams the prompt file into Claude Code print mode", () => {
  const buildClaudeCommand = (
    claudeRunner as unknown as { buildClaudeCommand?: BuildClaudeCommand }
  ).buildClaudeCommand;

  assert.equal(typeof buildClaudeCommand, "function");

  const script = buildClaudeCommand!({
    promptPath: "/tmp/Paper Pilot/Smith's paper/claude-prompt.txt",
    outputPath: "/tmp/Paper Pilot/Smith's paper/claude-output.txt",
    stderrPath: "/tmp/Paper Pilot/Smith's paper/claude-stderr.log",
    exitCodePath: "/tmp/Paper Pilot/Smith's paper/claude-exit.txt",
    pidPath: "/tmp/Paper Pilot/Smith's paper/claude-pid.txt",
    workspacePath: "/tmp/Paper Pilot/Smith's paper",
    model: "sonnet",
    resumeSessionId: "claude-thread-7",
    executablePath: "/Users/me/.local/bin/claude",
    permissionMode: "default",
  });

  const syntax = checkShellSyntax(script);

  assert.equal(syntax.status, 0, syntax.stderr);
  assert.match(
    script,
    /cat '\/tmp\/Paper Pilot\/Smith'\\''s paper\/claude-prompt\.txt' \|/,
  );
  assert.match(script, /'\/Users\/me\/\.local\/bin\/claude' -p/);
  assert.match(script, /--output-format text/);
  assert.match(script, /--model 'sonnet'/);
  assert.match(script, /--resume 'claude-thread-7'/);
  assert.match(script, /--permission-mode 'default'/);
  assert.match(script, /--setting-sources project,local/);
  assert.match(
    script,
    /2> '\/tmp\/Paper Pilot\/Smith'\\''s paper\/claude-stderr\.log'/,
  );
});

test("buildClaudeCommand uses Claude Code continue mode for the latest session marker", () => {
  const buildClaudeCommand = (
    claudeRunner as unknown as { buildClaudeCommand?: BuildClaudeCommand }
  ).buildClaudeCommand;

  assert.equal(typeof buildClaudeCommand, "function");

  const script = buildClaudeCommand!({
    promptPath: "/tmp/paper/claude-prompt.txt",
    outputPath: "/tmp/paper/claude-output.txt",
    stderrPath: "/tmp/paper/claude-stderr.log",
    exitCodePath: "/tmp/paper/claude-exit.txt",
    pidPath: "/tmp/paper/claude-pid.txt",
    workspacePath: "/tmp/paper",
    model: "sonnet",
    resumeSessionId: "latest",
    executablePath: "claude",
    permissionMode: "default",
  });

  assert.match(script, / --continue /);
  assert.doesNotMatch(script, /--resume 'latest'/);
});

test("buildClaudeCommand shell-escapes the native JSON schema", () => {
  const buildClaudeCommand = (
    claudeRunner as unknown as { buildClaudeCommand?: BuildClaudeCommand }
  ).buildClaudeCommand!;
  const script = buildClaudeCommand({
    promptPath: "/tmp/paper/prompt.txt",
    outputPath: "/tmp/paper/output.txt",
    stderrPath: "/tmp/paper/stderr.log",
    exitCodePath: "/tmp/paper/exit.txt",
    pidPath: "/tmp/paper/pid.txt",
    workspacePath: "/tmp/paper",
    model: "sonnet",
    executablePath: "claude",
    permissionMode: "plan",
    outputSchema: {
      type: "object",
      properties: { quote: { type: "string" } },
    },
  });

  assert.equal(checkShellSyntax(script).status, 0);
  assert.match(script, /--json-schema '\{"type":"object"/);
  assert.match(script, /--permission-mode 'plan'/);
});

test("Claude progress keeps successful stderr out of parsed assistant text", async () => {
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
    const progress = await claudeRunner.readClaudeRunProgress({
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
