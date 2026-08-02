import * as assert from "node:assert/strict";
import { test } from "node:test";
import {
  CHAT_INPUT_MAX_HEIGHT,
  CHAT_INPUT_MIN_HEIGHT,
  getChatComposerHeight,
  installChatComposerAutosize,
} from "../src/modules/ui/chatComposerSizing";

test("getChatComposerHeight clamps content to the composer bounds", () => {
  assert.equal(getChatComposerHeight(24), CHAT_INPUT_MIN_HEIGHT);
  assert.equal(getChatComposerHeight(120), 120);
  assert.equal(getChatComposerHeight(500), CHAT_INPUT_MAX_HEIGHT);
});

test("installChatComposerAutosize returns an idempotent cleanup", () => {
  let inputListener: (() => void) | undefined;
  let removeCount = 0;
  const input = {
    style: { height: "" },
    scrollHeight: 120,
    scrollTop: 7,
    addEventListener(type: string, listener: () => void) {
      assert.equal(type, "input");
      inputListener = listener;
    },
    removeEventListener(type: string, listener: () => void) {
      assert.equal(type, "input");
      assert.equal(listener, inputListener);
      removeCount += 1;
    },
  } as unknown as HTMLTextAreaElement;

  const cleanup = installChatComposerAutosize(input);
  assert.equal(input.style.height, "120px");
  assert.equal(input.scrollTop, 0);

  cleanup();
  cleanup();
  assert.equal(removeCount, 1);
});
