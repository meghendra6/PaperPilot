import { test } from "node:test";
import * as assert from "node:assert/strict";
import { startCodexRunForQuestion } from "../src/modules/codex/runner";
import { startClaudeRunForQuestion } from "../src/modules/claude/runner";

test("both providers await ownership before staging and confirm an abandoned launch", async (t) => {
  const runtime = globalThis as any;
  const previous = {
    Zotero: runtime.Zotero,
    IOUtils: runtime.IOUtils,
    addon: runtime.addon,
  };
  t.after(() => Object.assign(runtime, previous));
  const files = new Map<string, string>();
  let directories = 0;
  let launched = 0;
  runtime.addon = { data: {} };
  runtime.Zotero = {
    Prefs: {
      get: (key: string) =>
        key.endsWith("codexWorkspaceRoot")
          ? "/tmp/project-allocation-contract"
          : undefined,
    },
    File: {
      createDirectoryIfMissingAsync: async () => {
        directories++;
      },
      putContentsAsync: async (path: string, text: string) => {
        files.set(path, text);
      },
      getContentsAsync: async (path: string) => files.get(path),
    },
    Utilities: {
      Internal: {
        exec: async () => {
          launched++;
        },
        subprocess: async () =>
          "codex-cli 0.119.0 --output-format stream-json --verbose --include-partial-messages --sandbox",
      },
    },
  };
  runtime.IOUtils = {
    exists: async (path: string) => files.has(path),
    remove: async (path: string) => {
      files.delete(path);
    },
  };
  for (const [start, mode] of [
    [startCodexRunForQuestion, "codex_cli"],
    [startClaudeRunForQuestion, "claude_code"],
  ] as const) {
    const params = {
      itemID: 88,
      title: "Paper",
      sessionId: "owned",
      question: "Question",
      profile: "analysis" as const,
      useResume: false,
      executionSettings: {
        mode,
        model: "synthetic",
        responseLanguage: "English" as const,
      },
      prebuiltInput: {
        files: { "PROJECT_INDEX.md": "Read A", "papers/A.md": "source" },
        sourceIDs: ["A"],
        scopeFingerprint: "A",
      },
    };
    directories = 0;
    files.clear();
    let entered!: () => void;
    const enteredGate = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let rejectRegistration!: (error: Error) => void;
    const registration = new Promise<void>((_resolve, reject) => {
      rejectRegistration = reject;
    });
    const blocked = start({
      ...params,
      onWorkspaceAllocated: async () => {
        entered();
        await registration;
      },
    });
    const rejected = assert.rejects(blocked, /ownership write failed/);
    await enteredGate;
    assert.equal(directories, 0);
    assert.equal(files.size, 0);
    assert.equal(launched, 0);
    rejectRegistration(new Error("ownership write failed"));
    await rejected;
    let cancelled = false;
    let abandoned: string | undefined;
    await assert.rejects(
      start({
        ...params,
        shouldContinue: () => !cancelled,
        onWorkspaceAllocated: async () => {},
        onWorkspaceWillLaunch: async () => {
          cancelled = true;
        },
        onWorkspaceLaunchAbandoned: async (path) => {
          abandoned = path;
        },
      }),
      /cancelled before provider launch/,
    );
    assert.match(abandoned ?? "", /88-analysis-/);
    assert.equal(launched, 0);
  }
});
