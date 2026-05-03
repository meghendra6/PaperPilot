import { test } from "node:test";
import * as assert from "node:assert/strict";

test("cleanupWorkspaceIfEnabled removes the workspace when the cleanup pref is enabled", async () => {
  const previousZotero = (globalThis as { Zotero?: unknown }).Zotero;
  const previousIOUtils = (globalThis as { IOUtils?: unknown }).IOUtils;
  const removed: Array<{ path: string; options: unknown }> = [];

  (globalThis as { Zotero?: unknown }).Zotero = {
    Prefs: {
      get: (key: string) => key.endsWith("codexAutoCleanWorkspace"),
    },
  };
  (globalThis as { IOUtils?: unknown }).IOUtils = {
    remove: async (path: string, options: unknown) => {
      removed.push({ path, options });
    },
  };

  try {
    const { cleanupWorkspaceIfEnabled } = await import(
      "../src/modules/workspace/cleanup"
    );
    const cleaned = await cleanupWorkspaceIfEnabled(
      "/tmp/zotero-paper-ai/42-test-paper",
    );

    assert.equal(cleaned, true);
    assert.deepEqual(removed, [
      {
        path: "/tmp/zotero-paper-ai/42-test-paper",
        options: { recursive: true, ignoreAbsent: true },
      },
    ]);
  } finally {
    (globalThis as { Zotero?: unknown }).Zotero = previousZotero;
    (globalThis as { IOUtils?: unknown }).IOUtils = previousIOUtils;
  }
});

test("cleanupWorkspaceIfEnabled leaves the workspace when the cleanup pref is disabled", async () => {
  const previousZotero = (globalThis as { Zotero?: unknown }).Zotero;
  const previousIOUtils = (globalThis as { IOUtils?: unknown }).IOUtils;
  let removeCalled = false;

  (globalThis as { Zotero?: unknown }).Zotero = {
    Prefs: {
      get: () => false,
    },
  };
  (globalThis as { IOUtils?: unknown }).IOUtils = {
    remove: async () => {
      removeCalled = true;
    },
  };

  try {
    const { cleanupWorkspaceIfEnabled } = await import(
      "../src/modules/workspace/cleanup"
    );
    const cleaned = await cleanupWorkspaceIfEnabled(
      "/tmp/zotero-paper-ai/42-test-paper",
    );

    assert.equal(cleaned, false);
    assert.equal(removeCalled, false);
  } finally {
    (globalThis as { Zotero?: unknown }).Zotero = previousZotero;
    (globalThis as { IOUtils?: unknown }).IOUtils = previousIOUtils;
  }
});

test("cleanupWorkspaceIfEnabled refuses paths that do not look like generated paper workspaces", async () => {
  const previousZotero = (globalThis as { Zotero?: unknown }).Zotero;
  const previousIOUtils = (globalThis as { IOUtils?: unknown }).IOUtils;
  let removeCalled = false;

  (globalThis as { Zotero?: unknown }).Zotero = {
    Prefs: {
      get: () => true,
    },
  };
  (globalThis as { IOUtils?: unknown }).IOUtils = {
    remove: async () => {
      removeCalled = true;
    },
  };

  try {
    const { cleanupWorkspaceIfEnabled } = await import(
      "../src/modules/workspace/cleanup"
    );
    const cleaned = await cleanupWorkspaceIfEnabled("/tmp/zotero-paper-ai");

    assert.equal(cleaned, false);
    assert.equal(removeCalled, false);
  } finally {
    (globalThis as { Zotero?: unknown }).Zotero = previousZotero;
    (globalThis as { IOUtils?: unknown }).IOUtils = previousIOUtils;
  }
});
