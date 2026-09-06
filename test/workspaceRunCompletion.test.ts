import { test } from "node:test";
import * as assert from "node:assert/strict";
import {
  waitForWorkspaceTextRun,
  readWorkspaceRunProgress,
} from "../src/modules/ai/workspaceRun";
import type { EngineMode } from "../src/modules/ai/types";

const fixtures: {
  mode: EngineMode;
  answer: object;
  failure: object;
  success: object;
}[] = [
  {
    mode: "codex_cli",
    answer: {
      type: "item.completed",
      item: { type: "agent_message", text: '{"claims":[]}' },
    },
    failure: {
      type: "turn.failed",
      error: { message: "fixture-native-failure" },
    },
    success: { type: "turn.completed" },
  },
  {
    mode: "claude_code",
    answer: {
      type: "assistant",
      message: { content: [{ type: "text", text: '{"claims":[]}' }] },
    },
    failure: {
      type: "result",
      is_error: true,
      result: "fixture-native-failure",
    },
    success: { type: "result", is_error: false },
  },
  {
    mode: "gemini_cli",
    answer: { type: "message", role: "assistant", content: '{"claims":[]}' },
    failure: {
      type: "result",
      status: "error",
      error: { message: "fixture-native-failure" },
    },
    success: { type: "result", status: "success" },
  },
];

for (const fixture of fixtures) {
  test(`${fixture.mode} workspace outcome rejects failed/empty terminal output before artifact consumers`, async () => {
    const globals = globalThis as unknown as { Zotero?: unknown };
    const previous = globals.Zotero;
    const files: Record<string, string> = { out: "", err: "", exit: "0" };
    globals.Zotero = {
      File: { getContentsAsync: async (path: string) => files[path] },
    };
    const paths = {
      outputPath: "out",
      stderrPath: "err",
      exitCodePath: "exit",
    };
    const read = () => readWorkspaceRunProgress(fixture.mode, paths);
    try {
      files.out = [fixture.answer, fixture.failure]
        .map((event) => JSON.stringify(event))
        .join("\n");
      const failed = await waitForWorkspaceTextRun({
        mode: fixture.mode,
        paths,
        deadline: Date.now() + 1000,
      });
      assert.equal(failed.progress.completed, true);
      assert.equal(failed.progress.exitCode, "provider-failed");
      assert.equal(failed.progress.processExitCode, "0");
      assert.equal(failed.text, "");
      assert.match(failed.progress.diagnosticOutput, /fixture-native-failure/);
      assert.match(failed.progress.rawOutput, /claims/);

      files.out = JSON.stringify(fixture.success);
      assert.equal((await read()).exitCode, "empty-output");
      files.exit = "";
      const running = await read();
      assert.equal(running.completed, false);
      assert.equal(running.exitCode, "");

      files.exit = "0";
      files.out = [fixture.answer, fixture.success]
        .map((event) => JSON.stringify(event))
        .join("\n");
      const success = await read();
      assert.equal(success.exitCode, "0");
      assert.equal(success.parsedOutput, '{"claims":[]}');
      files.exit = "55";
      assert.equal((await read()).exitCode, "55");
    } finally {
      globals.Zotero = previous;
    }
  });
}
