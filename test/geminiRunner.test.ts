/* eslint-disable @typescript-eslint/triple-slash-reference */
/// <reference path="../typings/global.d.ts" />

import { test } from "node:test";
import * as assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

import * as geminiRunner from "../src/modules/gemini/runner";

type BuildGeminiCommand = (params: {
  promptPath: string;
  outputPath: string;
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
    exitCodePath: "/tmp/Paper Pilot/Smith's paper/gemini-exit.txt",
    pidPath: "/tmp/Paper Pilot/Smith's paper/gemini-pid.txt",
    workspacePath: "/tmp/Paper Pilot/Smith's paper",
    question: "Summarize this paper",
    model: "gemini-3.1-pro-preview",
    executablePath: "/opt/Homebrew Tools/gemini's bin/gemini",
  });

  const syntax = spawnSync("/bin/zsh", ["-n"], {
    input: script,
    encoding: "utf8",
  });

  assert.equal(syntax.status, 0, syntax.stderr);
  assert.doesNotMatch(script, /PROMPT=\$\(cat/);
  assert.match(
    script,
    /cat '\/tmp\/Paper Pilot\/Smith'\\''s paper\/gemini-prompt\.txt' \|/,
  );
  assert.match(script, /'\/opt\/Homebrew Tools\/gemini'\\''s bin\/gemini'/);
});
