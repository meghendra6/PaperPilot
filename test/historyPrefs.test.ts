import { test } from "node:test";
import * as assert from "node:assert/strict";

import {
  SESSION_HISTORY_PREF_KEYS,
  isSessionHistoryMode,
  resolveSessionHistoryPrefs,
  sessionHistoryPrefWrites,
} from "../src/modules/session/historyPrefs";
import type { SessionHistoryPersistenceMode } from "../src/modules/session/historyTypes";

type HistoryPrefs = Record<(typeof SESSION_HISTORY_PREF_KEYS)[number], boolean>;

function everyHistoryPrefCombination(): HistoryPrefs[] {
  const combinations: HistoryPrefs[] = [];
  for (let bits = 0; bits < 2 ** SESSION_HISTORY_PREF_KEYS.length; bits += 1) {
    combinations.push(
      Object.fromEntries(
        SESSION_HISTORY_PREF_KEYS.map((key, index) => [
          key,
          Boolean(bits & (1 << index)),
        ]),
      ) as HistoryPrefs,
    );
  }
  return combinations;
}

function apply(
  prefs: HistoryPrefs,
  mode: SessionHistoryPersistenceMode,
): HistoryPrefs {
  return { ...prefs, ...Object.fromEntries(sessionHistoryPrefWrites(mode)) };
}

test("session history resolves the four legacy checkboxes to three outcomes", () => {
  const read = (prefs: HistoryPrefs) => (key: keyof HistoryPrefs) => prefs[key];
  const base: HistoryPrefs = {
    saveDocumentSessions: true,
    privacyStoreLocalHistory: true,
    privacySavePromptsOnly: false,
    privacySaveResponses: true,
  };
  assert.equal(resolveSessionHistoryPrefs(read(base)).mode, "full");
  assert.equal(
    resolveSessionHistoryPrefs(read({ ...base, saveDocumentSessions: false }))
      .mode,
    "disabled",
  );
  assert.equal(
    resolveSessionHistoryPrefs(
      read({ ...base, privacyStoreLocalHistory: false }),
    ).mode,
    "disabled",
  );
  // "Save prompts only" wins even while "Save responses" stays checked.
  assert.equal(
    resolveSessionHistoryPrefs(read({ ...base, privacySavePromptsOnly: true }))
      .mode,
    "prompts-only",
  );
  assert.equal(
    resolveSessionHistoryPrefs(read({ ...base, privacySaveResponses: false }))
      .mode,
    "prompts-only",
  );
});

test("each session history choice writes prefs that resolve to that choice", () => {
  for (const prefs of everyHistoryPrefCombination()) {
    for (const mode of ["disabled", "prompts-only", "full"] as const) {
      const next = apply(prefs, mode);
      assert.equal(
        resolveSessionHistoryPrefs((key) => next[key]).mode,
        mode,
        `${JSON.stringify(prefs)} -> ${mode}`,
      );
    }
  }
});

test("re-saving the current session history choice keeps its outcome", () => {
  for (const prefs of everyHistoryPrefCombination()) {
    const current = resolveSessionHistoryPrefs((key) => prefs[key]);
    const next = apply(prefs, current.mode);
    assert.deepEqual(
      resolveSessionHistoryPrefs((key) => next[key]),
      current,
    );
  }
});

test("session history writes only the existing preference keys", () => {
  for (const mode of ["disabled", "prompts-only", "full"] as const) {
    for (const [key, value] of sessionHistoryPrefWrites(mode)) {
      assert.ok(SESSION_HISTORY_PREF_KEYS.includes(key));
      assert.equal(typeof value, "boolean");
    }
  }
  assert.deepEqual(Object.fromEntries(sessionHistoryPrefWrites("full")), {
    saveDocumentSessions: true,
    privacyStoreLocalHistory: true,
    privacySavePromptsOnly: false,
    privacySaveResponses: true,
  });
  assert.deepEqual(
    Object.fromEntries(sessionHistoryPrefWrites("prompts-only")),
    {
      saveDocumentSessions: true,
      privacyStoreLocalHistory: true,
      privacySavePromptsOnly: true,
      privacySaveResponses: false,
    },
  );
});

test("isSessionHistoryMode accepts only the three outcomes", () => {
  assert.equal(isSessionHistoryMode("disabled"), true);
  assert.equal(isSessionHistoryMode("prompts-only"), true);
  assert.equal(isSessionHistoryMode("full"), true);
  assert.equal(isSessionHistoryMode("off"), false);
  assert.equal(isSessionHistoryMode(undefined), false);
});
