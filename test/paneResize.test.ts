import * as assert from "node:assert/strict";
import { test } from "node:test";
import {
  PANE_RESIZE_STEP,
  clampPaneAreaHeight,
  getKeyboardResizeHeight,
} from "../src/modules/ui/paneResize";

test("clampPaneAreaHeight keeps pane areas inside usable bounds", () => {
  assert.equal(clampPaneAreaHeight(40, 96, 640), 96);
  assert.equal(clampPaneAreaHeight(320.4, 96, 640), 320);
  assert.equal(clampPaneAreaHeight(900, 96, 640), 640);
  assert.equal(clampPaneAreaHeight(400, 560, 320), 560);
});

test("getKeyboardResizeHeight supports precise and boundary controls", () => {
  assert.equal(
    getKeyboardResizeHeight({
      currentHeight: 320,
      key: "ArrowUp",
      minHeight: 96,
      maxHeight: 640,
    }),
    320 - PANE_RESIZE_STEP,
  );
  assert.equal(
    getKeyboardResizeHeight({
      currentHeight: 320,
      key: "ArrowDown",
      minHeight: 96,
      maxHeight: 640,
      step: 48,
    }),
    368,
  );
  assert.equal(
    getKeyboardResizeHeight({
      currentHeight: 320,
      key: "Home",
      minHeight: 96,
      maxHeight: 640,
    }),
    96,
  );
  assert.equal(
    getKeyboardResizeHeight({
      currentHeight: 320,
      key: "End",
      minHeight: 96,
      maxHeight: 640,
    }),
    640,
  );
  assert.equal(
    getKeyboardResizeHeight({
      currentHeight: 320,
      key: "Escape",
      minHeight: 96,
      maxHeight: 640,
    }),
    undefined,
  );
});
