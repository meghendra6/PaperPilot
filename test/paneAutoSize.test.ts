import * as assert from "node:assert/strict";
import { test } from "node:test";
import {
  getAutomaticPaneHeight,
  MIN_READER_PANE_HEIGHT,
} from "../src/modules/ui/paneAutoSize";

test("automatic pane height uses the remaining viewport below other Zotero sections", () => {
  assert.equal(getAutomaticPaneHeight(768, 240), 516);
  assert.equal(getAutomaticPaneHeight(768, 96), 660);
  assert.equal(getAutomaticPaneHeight(900, 300), 588);
});

test("short windows retain a readable minimum and tall windows stay bounded", () => {
  assert.equal(getAutomaticPaneHeight(400, 240), MIN_READER_PANE_HEIGHT);
  assert.equal(getAutomaticPaneHeight(2000, 100), 1400);
  assert.equal(getAutomaticPaneHeight(768, -300), 756);
});
