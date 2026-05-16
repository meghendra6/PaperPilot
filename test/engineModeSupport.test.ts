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
  setModeOverrideForItem,
} from "../src/modules/ai/modeStore";

test("provider registry exposes ready Codex, Claude Code, and Gemini CLI descriptors", () => {
  const codex = getProvider("codex_cli").getDescriptor();
  const claude = getProvider("claude_code").getDescriptor();
  const gemini = getProvider("gemini_cli").getDescriptor();

  assert.deepEqual(
    { mode: codex.mode, status: codex.status, label: codex.label },
    { mode: "codex_cli", status: "ready", label: "Codex CLI" },
  );
  assert.deepEqual(
    { mode: gemini.mode, status: gemini.status, label: gemini.label },
    { mode: "gemini_cli", status: "ready", label: "Gemini CLI" },
  );
  assert.deepEqual(
    { mode: claude.mode, status: claude.status, label: claude.label },
    { mode: "claude_code", status: "ready", label: "Claude Code" },
  );
  assert.match(gemini.placeholderResponse, /Gemini CLI mode is ready/i);
  assert.match(claude.placeholderResponse, /Claude Code mode is ready/i);
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
      modeOverrides: new Map<
        number,
        "codex_cli" | "claude_code" | "gemini_cli"
      >(),
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
      modeOverrides: new Map<
        number,
        "codex_cli" | "claude_code" | "gemini_cli"
      >([[7, "claude_code"]]),
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
