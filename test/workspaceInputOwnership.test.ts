import { test } from "node:test";
import * as assert from "node:assert/strict";
import { buildRunWorkspacePath } from "../src/modules/workspace/pathBuilder";
import { writeOwnedWorkspaceInputs } from "../src/modules/workspace/supplementalFiles";

test("chat path is session-bound and nonchat runs do not reuse old input directories", () => {
  const first = buildRunWorkspacePath({
    root: "/tmp/work",
    itemID: 9,
    sessionId: "대화 A",
    profile: "chat",
    runID: "first",
  });
  assert.equal(
    first,
    buildRunWorkspacePath({
      root: "/tmp/work",
      itemID: 9,
      sessionId: "대화 A",
      profile: "chat",
      runID: "second",
    }),
  );
  assert.notEqual(
    first,
    buildRunWorkspacePath({
      root: "/tmp/work",
      itemID: 9,
      sessionId: "대화 B",
      profile: "chat",
      runID: "second",
    }),
  );
  assert.notEqual(
    buildRunWorkspacePath({
      root: "/tmp/work",
      itemID: 9,
      sessionId: "project",
      profile: "analysis",
      runID: "first",
    }),
    buildRunWorkspacePath({
      root: "/tmp/work",
      itemID: 9,
      sessionId: "project",
      profile: "analysis",
      runID: "second",
    }),
  );
});

test("owned manifest removes prior B and runtime output but preserves unknown user files", async () => {
  const runtime = globalThis as any;
  const oldZ = runtime.Zotero;
  const oldIO = runtime.IOUtils;
  const files = new Map<string, string>();
  runtime.Zotero = {
    File: {
      getContentsAsync: async (path: string) => files.get(path),
      putContentsAsync: async (path: string, text: string) => {
        files.set(path, text);
      },
      createDirectoryIfMissingAsync: async () => {},
    },
  };
  runtime.IOUtils = {
    exists: async (path: string) => files.has(path),
    remove: async (path: string) => {
      files.delete(path);
    },
  };
  try {
    await writeOwnedWorkspaceInputs({
      workspacePath: "/tmp/work/9-chat-test",
      files: { "papers/A.md": "A", "papers/B.md": "B" },
      runID: "first",
      scopeFingerprint: "a-b",
      sourceIDs: ["A", "B"],
    });
    files.set("/tmp/work/9-chat-test/claude-output.txt", "old B answer");
    files.set("/tmp/work/9-chat-test/user.txt", "preserve");
    await writeOwnedWorkspaceInputs({
      workspacePath: "/tmp/work/9-chat-test",
      files: { "papers/A.md": "A new" },
      runID: "second",
      scopeFingerprint: "a",
      sourceIDs: ["A"],
    });
    assert.equal(files.has("/tmp/work/9-chat-test/papers/B.md"), false);
    assert.equal(files.has("/tmp/work/9-chat-test/claude-output.txt"), false);
    assert.equal(files.get("/tmp/work/9-chat-test/user.txt"), "preserve");
    const manifest = JSON.parse(
      files.get("/tmp/work/9-chat-test/paperpilot-input-manifest.json") ?? "",
    );
    assert.deepEqual(manifest.sourceIDs, ["A"]);
    assert.equal(manifest.runID, "second");
    await assert.rejects(
      () =>
        writeOwnedWorkspaceInputs({
          workspacePath: "/tmp/work/9-chat-test",
          files: { "../unsafe.md": "bad" },
          runID: "invalid",
          scopeFingerprint: "a",
          sourceIDs: ["A"],
        }),
      /Unsafe/,
    );
    assert.equal(files.get("/tmp/work/9-chat-test/papers/A.md"), "A new");
    const invalidManifest = {
      ...manifest,
      files: [
        ...manifest.files,
        { path: "../unsafe", contentFingerprint: "bad" },
      ],
    };
    files.set(
      "/tmp/work/9-chat-test/paperpilot-input-manifest.json",
      JSON.stringify(invalidManifest),
    );
    await assert.rejects(
      () =>
        writeOwnedWorkspaceInputs({
          workspacePath: "/tmp/work/9-chat-test",
          files: { "papers/A.md": "bad" },
          runID: "invalid-manifest",
          scopeFingerprint: "a",
          sourceIDs: ["A"],
        }),
      /preserved/,
    );
    assert.equal(files.get("/tmp/work/9-chat-test/papers/A.md"), "A new");
    files.set("/tmp/work/9-chat-test/paperpilot-input-manifest.json", "broken");
    await assert.rejects(
      () =>
        writeOwnedWorkspaceInputs({
          workspacePath: "/tmp/work/9-chat-test",
          files: { "papers/A.md": "bad" },
          runID: "third",
          scopeFingerprint: "a",
          sourceIDs: ["A"],
        }),
      /preserved/,
    );
    assert.equal(files.get("/tmp/work/9-chat-test/papers/A.md"), "A new");
  } finally {
    runtime.Zotero = oldZ;
    runtime.IOUtils = oldIO;
  }
});

test("project-only engine preparation never reads Zotero parent data and creates fresh directories", async () => {
  const { startClaudeRunForQuestion } = await import(
    "../src/modules/claude/runner"
  );
  const { startGeminiRunForQuestion } = await import(
    "../src/modules/gemini/runner"
  );
  const runtime = globalThis as any;
  const oldZ = runtime.Zotero;
  const oldIO = runtime.IOUtils;
  const files = new Map<string, string>();
  const commands: string[] = [];
  runtime.Zotero = {
    Prefs: {
      get: (name: string) =>
        name.endsWith("codexWorkspaceRoot")
          ? "/tmp/prebuilt-contract"
          : undefined,
    },
    Items: {
      getAsync: () => {
        throw new Error("Forbidden parent extraction");
      },
    },
    File: {
      createDirectoryIfMissingAsync: async () => {},
      putContentsAsync: async (path: string, text: string) => {
        files.set(path, text);
      },
      getContentsAsync: async (path: string) => {
        if (!files.has(path)) throw new Error("missing");
        return files.get(path);
      },
    },
    Utilities: {
      Internal: {
        exec: async (_path: string, args: string[]) => {
          commands.push(args[1]);
        },
        subprocess: async () =>
          "--output-format stream-json --verbose --include-partial-messages --sandbox",
      },
    },
  };
  runtime.IOUtils = {
    exists: async (path: string) => files.has(path),
    remove: async (path: string) => {
      files.delete(path);
    },
  };
  try {
    for (const [start, mode] of [
      [startClaudeRunForQuestion, "claude_code"],
      [startGeminiRunForQuestion, "gemini_cli"],
    ] as const) {
      const previousPaths: string[] = [];
      for (const names of [["A", "B"], ["A"]]) {
        const result = await start({
          itemID: 1,
          title: "Changing display title",
          sessionId: "project",
          question: "Compare admitted sources only",
          profile: "analysis",
          executionSettings: {
            mode,
            model: mode === "claude_code" ? "sonnet" : "gemini-3.1-pro-preview",
            responseLanguage: "English",
          },
          prebuiltInput: {
            files: Object.fromEntries(
              names.map((name) => [
                `papers/${name}.md`,
                `${name} exact content`,
              ]),
            ),
            sourceIDs: names,
            scopeFingerprint: names.join("+"),
          },
        });
        assert.equal(result.ok, true);
        previousPaths.push(result.workspacePath);
        assert.equal(files.has(`${result.workspacePath}/paper.md`), false);
        if (names.length === 1)
          assert.equal(files.has(`${result.workspacePath}/papers/B.md`), false);
        assert.match(result.promptPreview, /admitted project files only/);
        if (result.ok) assert.ok(result.timings?.contextReadyAt);
      }
      assert.notEqual(previousPaths[0], previousPaths[1]);
    }
    assert.equal(commands.length, 4);
    assert.ok(commands.every((command) => command.includes("stream-json")));
  } finally {
    runtime.Zotero = oldZ;
    runtime.IOUtils = oldIO;
  }
});

test("all providers suppress launch when Stop arrives during preparation or final input writes", async () => {
  const { startCodexRunForQuestion } = await import(
    "../src/modules/codex/runner"
  );
  const { startClaudeRunForQuestion } = await import(
    "../src/modules/claude/runner"
  );
  const { startGeminiRunForQuestion } = await import(
    "../src/modules/gemini/runner"
  );
  const runtime = globalThis as any;
  const previous = {
    Zotero: runtime.Zotero,
    IOUtils: runtime.IOUtils,
    addon: runtime.addon,
  };
  let cancelled = false;
  let interruptAt: "prepare" | "write" = "prepare";
  let launched = 0;
  const files = new Map<string, string>();
  runtime.addon = { data: {} };
  runtime.Zotero = {
    Prefs: {
      get: (key: string) =>
        key.endsWith("codexWorkspaceRoot") ? "/tmp/cancel-contract" : undefined,
    },
    Items: {
      getAsync: () => {
        throw new Error("Forbidden parent read");
      },
    },
    File: {
      createDirectoryIfMissingAsync: async () => {
        if (interruptAt === "prepare") cancelled = true;
      },
      putContentsAsync: async (path: string, text: string) => {
        files.set(path, text);
        if (interruptAt === "write" && path.endsWith("prompt.txt"))
          cancelled = true;
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
  try {
    for (const [start, mode] of [
      [startCodexRunForQuestion, "codex_cli"],
      [startClaudeRunForQuestion, "claude_code"],
      [startGeminiRunForQuestion, "gemini_cli"],
    ] as const)
      for (const stage of ["prepare", "write"] as const) {
        cancelled = false;
        interruptAt = stage;
        await assert.rejects(
          () =>
            start({
              itemID: 1,
              title: "Paper",
              sessionId: `cancel-${mode}-${stage}`,
              question: "Question",
              profile: "analysis",
              useResume: false,
              executionSettings: {
                mode,
                model: "synthetic",
                responseLanguage: "English",
              },
              prebuiltInput: {
                files: {
                  "PROJECT_INDEX.md": "Read A",
                  "papers/A.md": "exact source",
                },
                sourceIDs: ["A"],
                scopeFingerprint: "A",
              },
              shouldContinue: () => !cancelled,
            }),
          /cancelled before provider launch/,
        );
      }
    assert.equal(launched, 0);
  } finally {
    Object.assign(runtime, previous);
  }
});
