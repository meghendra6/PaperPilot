import * as assert from "node:assert/strict";
import { test } from "node:test";
import {
  getEngineSelectionPresentation,
  isModelSelectionDirty,
  shouldShowCodexAuthActions,
} from "../src/modules/ui/engineSettingsState";

test("engine buttons expose the active engine as a pressed state", () => {
  const codex = getEngineSelectionPresentation({
    mode: "codex_cli",
    defaultMode: "codex_cli",
    hasOverride: false,
  });
  assert.equal(codex.codexPressed, true);
  assert.equal(codex.claudePressed, false);
  assert.equal(codex.resetLabel, "Use default (Codex CLI)");
  assert.equal(codex.resetDisabled, true);

  const claude = getEngineSelectionPresentation({
    mode: "claude_code",
    defaultMode: "codex_cli",
    hasOverride: true,
  });
  assert.equal(claude.claudePressed, true);
  assert.equal(claude.codexPressed, false);
  assert.equal(claude.resetDisabled, false);
  assert.match(claude.resetTitle, /default engine, Codex CLI/);
});

test("the reset label names the configured default engine", () => {
  assert.equal(
    getEngineSelectionPresentation({
      mode: "codex_cli",
      defaultMode: "claude_code",
      hasOverride: true,
    }).resetLabel,
    "Use default (Claude Code)",
  );
});

test("Save enables only when the picker differs from the saved default", () => {
  assert.equal(
    isModelSelectionDirty({
      selectedModel: "gpt|high",
      savedModel: "gpt|high",
      effortVisible: false,
    }),
    false,
  );
  assert.equal(
    isModelSelectionDirty({
      selectedModel: "gpt|low",
      savedModel: "gpt|high",
      effortVisible: false,
    }),
    true,
  );
  assert.equal(
    isModelSelectionDirty({
      selectedModel: "opus|",
      savedModel: "opus|",
      effortVisible: true,
      selectedEffort: "high",
      savedEffort: "",
    }),
    true,
  );
  assert.equal(
    isModelSelectionDirty({
      selectedModel: "opus|",
      savedModel: "opus|",
      effortVisible: false,
      selectedEffort: "high",
      savedEffort: "",
    }),
    false,
  );
});

test("Codex authentication controls appear only when Codex is not ready", () => {
  assert.equal(shouldShowCodexAuthActions("codex_cli", "ready"), false);
  assert.equal(shouldShowCodexAuthActions("codex_cli", undefined), false);
  assert.equal(shouldShowCodexAuthActions("codex_cli", "checking"), false);
  assert.equal(shouldShowCodexAuthActions("codex_cli", "login_required"), true);
  assert.equal(shouldShowCodexAuthActions("codex_cli", "unavailable"), true);
  assert.equal(shouldShowCodexAuthActions("codex_cli", "error"), true);
  assert.equal(
    shouldShowCodexAuthActions("claude_code", "login_required"),
    false,
  );
});
