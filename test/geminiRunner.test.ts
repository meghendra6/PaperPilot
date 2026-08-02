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
}) => string;

test("buildGeminiCommand streams the prompt file instead of expanding it into argv", () => {
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
  assert.match(script, /-p ''/);
  assert.match(
    script,
    /2> '\/tmp\/Paper Pilot\/Smith'\\''s paper\/gemini-stderr\.log'/,
  );
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
