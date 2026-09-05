import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { config } from "../package.json";
import { registerPrefsScripts } from "../src/modules/preferenceScript";
import { captureExecutionSettings } from "../src/modules/ai/executionSettings";
import {
  buildResponseLanguageInstruction,
  subscribeToResponseLanguageChanges,
} from "../src/modules/translation/responseLanguage";
import { buildCriticalReadStepPrompt } from "../src/modules/criticalRead/prompt";
import { buildInitialCriticalReadState } from "../src/modules/criticalRead/workflow";
import { buildProfiledCriticalReadPrompt } from "../src/modules/researchWorkspace/core/criticalRead/profiled/prompt";
import { getCriticalReadProfile } from "../src/modules/researchWorkspace/core/criticalRead/profiled/profiles";
import { buildMasteryBlueprintPrompt } from "../src/modules/researchWorkspace/core/comprehensionCheck/v2/prompt";
import {
  buildContextPayload,
  buildCodexWorkspacePrompt,
  buildClaudeWorkspacePrompt,
  buildGeminiWorkspacePrompt,
} from "../src/modules/context/promptPreviewBuilder";

test("the packaged language selector persists changes used by all CLI providers", async () => {
  const globals = globalThis as any;
  const previous = { Zotero: globals.Zotero, addon: globals.addon };
  const prefs = new Map<string, unknown>([
    [`${config.prefsPrefix}.responseLanguage`, "Korean"],
  ]);
  const listeners: (() => void)[] = [];
  const select = {
    value: "English",
    dataset: {} as Record<string, string>,
    addEventListener: (name: string, listener: () => void) => {
      assert.equal(name, "change");
      listeners.push(listener);
    },
  };
  const template = readFileSync(
    "addon/chrome/content/preferences.xhtml",
    "utf8",
  ).replace(/__addonRef__/g, config.addonRef);
  const match = template.match(/id="([^"]+-input-response-language)"/);
  assert(match, "the preferences template must declare the language selector");
  const selector = `#${match[1]}`;
  const doc = {
    querySelector: (id: string) => (id === selector ? select : null),
  };
  globals.addon = { data: {} };
  globals.Zotero = {
    Prefs: {
      get: (key: string) => prefs.get(key),
      set: (key: string, value: unknown) => prefs.set(key, value),
    },
  };
  const observedLanguages: unknown[] = [];
  const unsubscribe = subscribeToResponseLanguageChanges(() => {
    observedLanguages.push(prefs.get(`${config.prefsPrefix}.responseLanguage`));
  });
  try {
    await registerPrefsScripts({ document: doc } as any);
    assert.equal(
      select.value,
      "Korean",
      "the actual packaged element must reflect the stored preference",
    );
    await registerPrefsScripts({ document: doc } as any);
    assert.equal(
      listeners.length,
      1,
      "reopening settings must not duplicate change handlers",
    );
    for (const language of ["Chinese", "English", "Korean"]) {
      select.value = language;
      listeners[0]();
      assert.equal(
        prefs.get(`${config.prefsPrefix}.responseLanguage`),
        language,
      );
      for (const mode of ["codex_cli", "claude_code", "gemini_cli"] as const) {
        assert.equal(captureExecutionSettings(mode).responseLanguage, language);
      }
    }
    assert.deepEqual(
      observedLanguages,
      ["Chinese", "English", "Korean"],
      "open panes must be notified after the preference is persisted",
    );
    unsubscribe();
    select.value = "English";
    listeners[0]();
    assert.equal(
      observedLanguages.length,
      3,
      "disposed panes must no longer receive notifications",
    );
  } finally {
    unsubscribe();
    Object.assign(globals, previous);
  }
});

for (const language of ["Korean", "Chinese", "English"] as const) {
  test(`${language} applies to Critical Read prose without translating schema or source evidence`, () => {
    const instruction = buildResponseLanguageInstruction(language);
    assert.match(instruction, new RegExp(`reader-facing prose in ${language}`));
    assert.match(instruction, /string values inside JSON/);
    assert.match(instruction, /Keep JSON keys, enum values/);
    assert.match(instruction, /verbatim source quotes/);
    assert.match(instruction, /regardless of the language of the paper/);
    const state = buildInitialCriticalReadState();
    const prompts = [1, 2, 4, 5, 6, 7].map((stepID) =>
      buildCriticalReadStepPrompt({
        state,
        stepID: stepID as 1 | 2 | 4 | 5 | 6 | 7,
        responseLanguage: language,
      }),
    );
    prompts.push(
      buildProfiledCriticalReadPrompt({
        paperContext: "An English paper.",
        attachmentKey: "ATTACH",
        profile: getCriticalReadProfile("general"),
        responseLanguage: language,
      }),
      buildMasteryBlueprintPrompt({
        paperContext: "An English paper about probability distribution.",
        attachmentKey: "ATTACH",
        responseLanguage: language,
      }),
    );
    for (const prompt of prompts) assert(prompt.includes(instruction));
    const preview = buildContextPayload({
      question: prompts[0],
      responseLanguage: language,
    }).promptPreview;
    for (const build of [
      buildCodexWorkspacePrompt,
      buildClaudeWorkspacePrompt,
      buildGeminiWorkspacePrompt,
    ]) {
      const finalPrompt = build(preview);
      assert(finalPrompt.includes(instruction));
      assert.match(finalPrompt, /Response language \(required\)/);
      assert.match(finalPrompt, /"summary"/);
    }
  });
}

test("Korean explanations preserve paper and reader terminology by default", () => {
  const instruction = buildResponseLanguageInstruction("Korean");
  assert.match(instruction, /Use English technical terms by default/);
  assert.match(instruction, /from the paper and the reader's question/);
  assert.match(instruction, /conventional English names/);
  assert.match(instruction, /probability distribution/);
  assert.match(instruction, /Do not replace them with Korean translations/);
  assert.match(instruction, /phonetic transliterations/);
  assert.match(instruction, /bilingual parenthetical glosses/);
  assert.match(instruction, /natural Korean sentences/);
  assert.match(instruction, /avoid forced word-for-word translation/);
  assert.match(instruction, /only when the reader explicitly requests/);
  assert.doesNotMatch(instruction, /only when needed for precision/);
});

test("other response languages retain their existing terminology policy", () => {
  for (const language of ["English", "Chinese"]) {
    const instruction = buildResponseLanguageInstruction(language);
    assert.match(instruction, /only when needed for precision/);
    assert.doesNotMatch(instruction, /by default in Korean responses/);
  }
});
