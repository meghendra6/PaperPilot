import { test } from "node:test";
import * as assert from "node:assert/strict";
import {
  captureExecutionSettings,
  executionSettingsForMode,
} from "../src/modules/ai/executionSettings";
import {
  getAllowedCodexModels,
  resolveCodexModel,
} from "../src/modules/codex/modelOptions";
import {
  getRecentModels,
  rememberRecentModel,
} from "../src/modules/codex/modelHistory";
import { renderModelHistory } from "../src/modules/ui/paneHeader";
import { summarizeCitationStances } from "../src/modules/researchWorkspace/core/citationStance/engine";

test("Codex allowed models determine both effective selection and picker options", () => {
  assert.deepEqual(
    getAllowedCodexModels("gpt-5.6-luna,gpt-5.6-luna,obsolete"),
    ["gpt-5.6-luna"],
  );
  assert.equal(
    resolveCodexModel("gpt-6-astra", "gpt-5.6-luna"),
    "gpt-5.6-luna",
  );
  assert(getAllowedCodexModels("gpt-5.6").includes("gpt-6-astra"));
  const globals = globalThis as any;
  const previous = { Zotero: globals.Zotero, addon: globals.addon };
  let allowedModels = "gpt-5.6-luna";
  globals.addon = { data: {} };
  globals.Zotero = {
    Prefs: {
      get: (key: string) =>
        key.endsWith(".codexAllowedModels") ? allowedModels : undefined,
    },
  };
  const options: { value: string }[] = [];
  const input = {
    ownerDocument: { createElement: () => ({}) },
    replaceChildren: (...entries: { value: string }[]) => {
      options.splice(0, options.length, ...entries);
    },
    appendChild: (entry: { value: string }) => options.push(entry),
  };
  const container = { style: {}, replaceChildren() {} };
  try {
    renderModelHistory(container as any, input as any, "codex_cli");
    assert.deepEqual(
      [...new Set(options.map((entry) => entry.value.split("|")[0]))],
      ["gpt-5.6-luna"],
    );
    allowedModels = "gpt-6-sol,gpt-6-luna";
    renderModelHistory(container as any, input as any, "codex_cli");
    assert.deepEqual(
      options.map((entry) => entry.value),
      [
        "gpt-6-sol|low",
        "gpt-6-sol|medium",
        "gpt-6-sol|high",
        "gpt-6-sol|xhigh",
        "gpt-6-sol|max",
        "gpt-6-sol|ultra",
        "gpt-6-luna|low",
        "gpt-6-luna|medium",
        "gpt-6-luna|high",
        "gpt-6-luna|xhigh",
        "gpt-6-luna|max",
      ],
    );
    for (const model of ["gpt-6-sol", "gpt-6-luna"]) {
      const prefs: Record<string, string> = {
        codexAllowedModels: allowedModels,
        codexDefaultModel: model,
        codexReasoningEffort: "ultra",
      };
      const settings = captureExecutionSettings(
        "codex_cli",
        ((key: string) => prefs[key]) as any,
      );
      assert.equal(settings.model, model);
      assert.equal(
        settings.reasoningEffort,
        model === "gpt-6-sol" ? "ultra" : "medium",
      );
    }
    rememberRecentModel("codex_cli", "gpt-6-astra");
    rememberRecentModel("claude_code", "sonnet");
    assert.deepEqual(getRecentModels("gemini_cli"), []);
    renderModelHistory(container as any, input as any, "claude_code");
    assert(!options.some((entry) => entry.value.startsWith("gpt-")));
    renderModelHistory(container as any, input as any, "gemini_cli");
    assert(!options.some((entry) => /^(sonnet|gpt-)/.test(entry.value)));
  } finally {
    Object.assign(globals, previous);
  }
});

test("execution settings pin normalized model, effort, language, and provider", () => {
  const prefs: Record<string, string> = {
    codexAllowedModels: "gpt-5.6-luna",
    codexDefaultModel: "gpt-6-astra",
    codexReasoningEffort: "ultra",
    responseLanguage: "Korean",
  };
  const settings = captureExecutionSettings(
    "codex_cli",
    ((key: string) => prefs[key]) as any,
  );
  assert.equal(settings.model, "gpt-5.6-luna");
  assert.equal(settings.reasoningEffort, "medium");
  prefs.responseLanguage = "English";
  prefs.codexDefaultModel = "gpt-5.6-sol";
  assert.equal(settings.responseLanguage, "Korean");
  assert.equal(executionSettingsForMode("codex_cli", settings), settings);
  assert(Object.isFrozen(settings));
  assert.throws(
    () => executionSettingsForMode("claude_code", settings),
    /do not match/,
  );
});

test("missing citation confidence cannot turn the summary into NaN", () => {
  const summary = summarizeCitationStances([
    { stance: "supporting" },
    { stance: "contrasting", confidence: 0.8 },
  ]);
  assert.equal(summary.weightedBalance, -0.4);
});
