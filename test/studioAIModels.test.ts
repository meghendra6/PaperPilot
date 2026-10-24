import * as assert from "node:assert/strict";
import { test } from "node:test";
import { studioModelDefaults } from "../src/modules/studio/aiModels";
import { providerLabel } from "../src/modules/studio/aiContracts";

test("assistant defaults follow the engine mode and list the reader's models", () => {
  const defaults = studioModelDefaults({
    engineMode: "claude_code",
    codexModel: "gpt-6-sol",
    claudeModel: "opus",
    codexAllowed: "gpt-6-sol, gpt-6-luna, retired-model",
    claudeAllowed: "opus, claude-sonnet-5.5",
  });
  assert.equal(defaults.provider, "claude");
  assert.equal(defaults.codex, "gpt-6-sol");
  assert.equal(defaults.claude, "opus");
  assert.deepEqual(
    defaults.models?.codex.map((choice) => choice.value),
    ["gpt-6-sol", "gpt-6-luna"],
  );
  const claude = defaults.models?.claude ?? [];
  assert.deepEqual(
    claude.slice(0, 2).map((choice) => choice.value),
    ["opus", "claude-sonnet-5-5"],
  );
  assert.equal(claude[0].label, "Opus (latest)");
  assert.ok(claude.some((choice) => choice.value === "haiku"));
});

test("assistant defaults keep an unlisted default model selectable", () => {
  const defaults = studioModelDefaults({
    codexModel: "gpt-6-astra",
    claudeModel: "claude-experimental",
    codexAllowed: "gpt-6-luna",
    claudeAllowed: "",
  });
  assert.equal(defaults.provider, "codex");
  assert.equal(defaults.models?.codex[0].value, "gpt-6-astra");
  assert.equal(defaults.models?.claude[0].value, "claude-experimental");
  assert.equal(providerLabel("claude"), "Claude Code");
  assert.equal(providerLabel("unknown"), "unknown");
});
