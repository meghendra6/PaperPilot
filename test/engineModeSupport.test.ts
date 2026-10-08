/* eslint-disable @typescript-eslint/triple-slash-reference */
/// <reference path="../typings/global.d.ts" />
import { test } from "node:test";
import * as assert from "node:assert/strict";

import {
  getProvider,
  getProviderDescriptorForItem,
} from "../src/modules/ai/providerRegistry";
import {
  clearModeOverrideForItem,
  getDefaultMode,
  getModeForItem,
  migrateLegacyDefaultMode,
  setModeOverrideForItem,
} from "../src/modules/ai/modeStore";

test("provider registry reports only observed readiness", () => {
  const codex = getProvider("codex_cli").getDescriptor();
  const claude = getProvider("claude_code").getDescriptor();

  assert.deepEqual(
    { mode: codex.mode, status: codex.status, label: codex.label },
    { mode: "codex_cli", status: "checking", label: "Codex CLI" },
  );
  assert.deepEqual(
    { mode: claude.mode, status: claude.status, label: claude.label },
    { mode: "claude_code", status: "idle", label: "Claude Code" },
  );
  assert.match(claude.placeholderResponse, /Open the Claude header/i);
  assert.match(codex.placeholderResponse, /Open the Codex header/i);
  assert.equal(codex.discoveryCapabilities.agentWebSearch, false);
  assert.equal(claude.discoveryCapabilities.agentWebSearch, false);
  assert.equal(
    codex.discoveryCapabilities.structuredCandidateSearch,
    typeof fetch === "function",
  );
});

test("mode store accepts Claude Code as the default mode and falls back to Codex", () => {
  const previousZotero = (globalThis as { Zotero?: unknown }).Zotero;
  (globalThis as { Zotero?: unknown }).Zotero = {
    Prefs: {
      get: (_key: string) => "claude_code",
    },
  };

  try {
    assert.equal(getDefaultMode(), "claude_code");

    (
      globalThis as { Zotero?: { Prefs: { get: (_key: string) => unknown } } }
    ).Zotero = {
      Prefs: {
        get: (_key: string) => "legacy-mode",
      },
    };

    assert.equal(getDefaultMode(), "codex_cli");
  } finally {
    (globalThis as { Zotero?: unknown }).Zotero = previousZotero;
  }
});

test("mode overrides are stored per item without changing the default mode", () => {
  const previousAddon = (globalThis as { addon?: unknown }).addon;
  const previousZotero = (globalThis as { Zotero?: unknown }).Zotero;
  (globalThis as { addon?: unknown }).addon = {
    data: {
      modeOverrides: new Map<number, "codex_cli" | "claude_code">(),
    },
  };
  (globalThis as { Zotero?: unknown }).Zotero = {
    Prefs: {
      get: (_key: string) => "codex_cli",
    },
  };

  try {
    assert.equal(getModeForItem(42), "codex_cli");
    setModeOverrideForItem(42, "claude_code");
    assert.equal(getModeForItem(42), "claude_code");
    clearModeOverrideForItem(42);
    assert.equal(getModeForItem(42), "codex_cli");
  } finally {
    (globalThis as { addon?: unknown }).addon = previousAddon;
    (globalThis as { Zotero?: unknown }).Zotero = previousZotero;
  }
});

test("provider descriptor resolution respects per-item mode overrides", () => {
  const previousAddon = (globalThis as { addon?: unknown }).addon;
  const previousZotero = (globalThis as { Zotero?: unknown }).Zotero;
  (globalThis as { addon?: unknown }).addon = {
    data: {
      modeOverrides: new Map<number, "codex_cli" | "claude_code">([
        [7, "claude_code"],
      ]),
    },
  };
  (globalThis as { Zotero?: unknown }).Zotero = {
    Prefs: {
      get: (_key: string) => "codex_cli",
    },
  };

  try {
    assert.equal(getProviderDescriptorForItem().mode, "codex_cli");
    assert.equal(getProviderDescriptorForItem(7).mode, "claude_code");
    assert.equal(getProviderDescriptorForItem(8).mode, "codex_cli");
  } finally {
    (globalThis as { addon?: unknown }).addon = previousAddon;
    (globalThis as { Zotero?: unknown }).Zotero = previousZotero;
  }
});

test("a saved Gemini default mode is rewritten to Codex once", () => {
  const prefs: Record<string, string> = { defaultMode: "gemini_cli" };
  const read = ((key: string) => prefs[key]) as any;
  const write = ((key: string, value: string) => {
    prefs[key] = value;
  }) as any;
  migrateLegacyDefaultMode(read, write);
  assert.equal(prefs.defaultMode, "codex_cli");
  prefs.defaultMode = "claude_code";
  migrateLegacyDefaultMode(read, write);
  assert.equal(prefs.defaultMode, "claude_code");
});
