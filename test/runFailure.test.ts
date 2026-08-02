import * as assert from "node:assert/strict";
import { test } from "node:test";
import { classifyRunFailure } from "../src/modules/ai/runFailure";

test("run failure sources override message guessing", () => {
  for (const engine of ["codex_cli", "claude_code", "gemini_cli"] as const) {
    assert.equal(
      classifyRunFailure({
        engine,
        rawError: "command not found",
        source: "workspace",
      }).kind,
      "workspace_error",
    );
    assert.equal(
      classifyRunFailure({
        engine,
        rawError: "not logged in",
        source: "timeout",
      }).kind,
      "timeout",
    );
  }
});

test("run failure classifies missing executables for every engine", () => {
  for (const engine of ["codex_cli", "claude_code", "gemini_cli"] as const) {
    const failure = classifyRunFailure({
      engine,
      rawError: "spawn failed: ENOENT command not found",
      source: "spawn",
    });
    assert.equal(failure.kind, "executable_missing");
    assert.equal(failure.action, "open_settings");
  }
});

test("run failure recognizes engine authentication guidance", () => {
  const cases = [
    ["codex_cli", "Not logged in. Run `codex login`"],
    ["claude_code", "Authentication required. Please run /login"],
    ["gemini_cli", "GEMINI_API_KEY is required"],
  ] as const;
  for (const [engine, rawError] of cases) {
    const failure = classifyRunFailure({
      engine,
      rawError,
      source: "process_exit",
    });
    assert.equal(failure.kind, "login_required");
    assert.equal(failure.action, "show_login_help");
    assert.equal(failure.rawError, rawError);
  }
});

test("run failure keeps unknown raw diagnostics out of its user message", () => {
  const rawError = "secret-local-stderr-marker";
  for (const engine of ["codex_cli", "claude_code", "gemini_cli"] as const) {
    const failure = classifyRunFailure({
      engine,
      rawError,
      source: "process_exit",
    });
    assert.equal(failure.kind, "unknown");
    assert.equal(failure.userMessage.includes(rawError), false);
    assert.equal(failure.rawError, rawError);
  }
});
