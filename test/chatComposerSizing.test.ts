import * as assert from "node:assert/strict";
import { test } from "node:test";
import {
  CHAT_INPUT_MAX_HEIGHT,
  CHAT_INPUT_MIN_HEIGHT,
  getChatComposerHeight,
  getChatComposerScrollTop,
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

test("composer keeps the caret visible once text outgrows the box", () => {
  assert.equal(
    getChatComposerScrollTop({
      scrollHeight: 120,
      viewportHeight: 120,
      previousScrollTop: 7,
      caretAtEnd: true,
    }),
    0,
  );
  assert.equal(
    getChatComposerScrollTop({
      scrollHeight: 400,
      viewportHeight: 178,
      previousScrollTop: 50,
      caretAtEnd: true,
    }),
    222,
  );
  assert.equal(
    getChatComposerScrollTop({
      scrollHeight: 400,
      viewportHeight: 178,
      previousScrollTop: 50,
      caretAtEnd: false,
    }),
    50,
  );
});

test("composer autosize scrolls a long draft to the caret at the end", () => {
  const input = {
    style: { height: "" },
    scrollHeight: 400,
    clientHeight: 178,
    scrollTop: 0,
    value: "long draft",
    selectionEnd: 10,
    addEventListener() {},
    removeEventListener() {},
  } as unknown as HTMLTextAreaElement;

  const cleanup = installChatComposerAutosize(input);
  assert.equal(input.style.height, `${CHAT_INPUT_MAX_HEIGHT}px`);
  assert.equal(input.scrollTop, 222);
  cleanup();
});
