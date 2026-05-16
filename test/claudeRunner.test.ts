/* eslint-disable @typescript-eslint/triple-slash-reference */
/// <reference path="../typings/global.d.ts" />

import { test } from "node:test";
import * as assert from "node:assert/strict";

import * as claudeRunner from "../src/modules/claude/runner";
import { checkShellSyntax } from "./helpers/shellSyntax";

type BuildClaudeCommand = (params: {
  promptPath: string;
  outputPath: string;
  exitCodePath: string;
  pidPath: string;
  workspacePath: string;
  model: string;
  resumeSessionId?: string;
  executablePath: string;
  permissionMode: string;
}) => string;

test("buildClaudeCommand streams the prompt file into Claude Code print mode", () => {
  const buildClaudeCommand = (
    claudeRunner as unknown as { buildClaudeCommand?: BuildClaudeCommand }
  ).buildClaudeCommand;

  assert.equal(typeof buildClaudeCommand, "function");

  const script = buildClaudeCommand!({
    promptPath: "/tmp/Paper Pilot/Smith's paper/claude-prompt.txt",
    outputPath: "/tmp/Paper Pilot/Smith's paper/claude-output.txt",
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
});

test("buildClaudeCommand uses Claude Code continue mode for the latest session marker", () => {
  const buildClaudeCommand = (
    claudeRunner as unknown as { buildClaudeCommand?: BuildClaudeCommand }
  ).buildClaudeCommand;

  assert.equal(typeof buildClaudeCommand, "function");

  const script = buildClaudeCommand!({
    promptPath: "/tmp/paper/claude-prompt.txt",
    outputPath: "/tmp/paper/claude-output.txt",
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
