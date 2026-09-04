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
      get: (key: string) => {
        if (key.endsWith("codexAutoCleanWorkspace")) return false;
        if (key.endsWith("saveDocumentSessions")) return true;
        if (key.endsWith("privacyStoreLocalHistory")) return true;
        if (key.endsWith("privacySavePromptsOnly")) return false;
        if (key.endsWith("privacySaveResponses")) return true;
        return undefined;
      },
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

test("cleanupWorkspaceIfEnabled forces cleanup when history persistence is disabled", async () => {
  const previousZotero = (globalThis as { Zotero?: unknown }).Zotero;
  const previousIOUtils = (globalThis as { IOUtils?: unknown }).IOUtils;
  const removed: string[] = [];

  (globalThis as { Zotero?: unknown }).Zotero = {
    Prefs: {
      get: (key: string) => {
        if (key.endsWith("codexAutoCleanWorkspace")) return false;
        if (key.endsWith("saveDocumentSessions")) return false;
        return true;
      },
    },
  };
  (globalThis as { IOUtils?: unknown }).IOUtils = {
    remove: async (path: string) => removed.push(path),
  };

  try {
    const { cleanupWorkspaceIfEnabled } = await import(
      "../src/modules/workspace/cleanup"
    );
    assert.equal(
      await cleanupWorkspaceIfEnabled(
        "/private/user-temp/paperpilot-workspaces/42-test-paper",
      ),
      true,
    );
    assert.deepEqual(removed, [
      "/private/user-temp/paperpilot-workspaces/42-test-paper",
    ]);
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

test("item cleanup resolves the same stable workspace path after preparation throws", async () => {
  const previousZotero = (globalThis as { Zotero?: unknown }).Zotero;
  const previousIOUtils = (globalThis as { IOUtils?: unknown }).IOUtils;
  const removed: string[] = [];

  (globalThis as { Zotero?: unknown }).Zotero = {
    Prefs: {
      get: (key: string) => {
        if (key.endsWith("codexAutoCleanWorkspace")) return true;
        if (key.endsWith("codexWorkspaceRoot")) return "/tmp/custom-root";
        return undefined;
      },
    },
  };
  (globalThis as { IOUtils?: unknown }).IOUtils = {
    remove: async (path: string) => {
      removed.push(path);
    },
  };

  try {
    const { cleanupPaperWorkspaceForItemIfEnabled } = await import(
      "../src/modules/workspace/cleanup"
    );
    assert.equal(
      await cleanupPaperWorkspaceForItemIfEnabled({
        itemID: 73,
        title: "Stable Workspace",
      }),
      true,
    );
    assert.deepEqual(removed, ["/tmp/custom-root/73-stable-workspace"]);
  } finally {
    (globalThis as { Zotero?: unknown }).Zotero = previousZotero;
    (globalThis as { IOUtils?: unknown }).IOUtils = previousIOUtils;
  }
});
