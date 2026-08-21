import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import * as assert from "node:assert/strict";

const readerPaneSource = readFileSync(
  join(process.cwd(), "src", "modules", "readerPane.ts"),
  "utf8",
);
const paneHeaderSource = readFileSync(
  join(process.cwd(), "src", "modules", "ui", "paneHeader.ts"),
  "utf8",
);

test("reader pane exposes conversation and progress updates to assistive technology", () => {
  assert.match(
    readerPaneSource,
    /id="chat-messages" role="log" aria-live="polite"/,
  );
  assert.match(
    readerPaneSource,
    /id="chat-streaming-indicator"[^>]*role="status"[^>]*aria-live="polite"/,
  );
  assert.match(
    readerPaneSource,
    /id="chat-compare-helper"[^>]*role="status"[^>]*aria-live="polite"/,
  );
});

test("empty chat guidance is separate from the conversation and clears on first input", () => {
  assert.match(readerPaneSource, /help\.dataset\.ppChatHelp = "true"/);
  assert.match(
    readerPaneSource,
    /querySelector\('\[data-pp-chat-help="true"\]'\)[\s\S]*?\.remove\(\)/,
  );
});

test("engine settings move focus into the dialog when opened", () => {
  assert.match(paneHeaderSource, /popover\.tabIndex = -1/);
  assert.match(paneHeaderSource, /if \(open\) \{[\s\S]*?popover\.focus\(\)/);
});
