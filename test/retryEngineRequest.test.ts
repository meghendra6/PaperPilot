import { test } from "node:test";
import * as assert from "node:assert/strict";
import { retryLastEngineQuestion } from "../src/modules/ai/retryEngineRequest";
import { createGlobalStateRestorer } from "./helpers/globalState";

test("a refused Retry reports in the composer hint, not the transcript", async () => {
  const restore = createGlobalStateRestorer(["addon"]);
  (globalThis as Record<string, unknown>).addon = { data: {} };
  const notices: string[] = [];
  const appended: unknown[] = [];
  const chatMessages = {
    appendChild: (node: unknown) => appended.push(node),
  } as unknown as HTMLElement;
  try {
    await retryLastEngineQuestion({
      itemID: 9101,
      itemTitle: "Paper",
      chatMessages,
      streamingIndicator: { style: {} } as unknown as HTMLElement,
      onNotice: (text) => notices.push(text),
    });
    assert.deepEqual(notices, ["No previous engine request to retry."]);
    assert.deepEqual(appended, []);
  } finally {
    restore();
  }
});
