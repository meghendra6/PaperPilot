import { test } from "node:test";
import * as assert from "node:assert/strict";

import {
  buildChatContextStatus,
  formatChatContextDetails,
  renderChatContextStatus,
  withChatContextTiming,
} from "../src/modules/ui/chatContextStatus";

class FakeElement {
  className = "";
  title = "";
  textContent = "";
  children: FakeElement[] = [];

  constructor(readonly ownerDocument: FakeDocument) {}

  replaceChildren(...nodes: FakeElement[]) {
    this.children = nodes;
    this.textContent = nodes.map((node) => node.textContent).join("");
  }
}

class FakeDocument {
  createElement() {
    return new FakeElement(this);
  }
}

const baseStatus = () =>
  buildChatContextStatus({
    continuityMode: "Native conversation resume",
    paperTitle: "Attention Is All You Need",
    attachmentKey: "ABCD1234",
    includedTurns: 3,
    includedPins: 1,
    usedSummary: true,
    omitted: 2,
    warnings: [
      "A selected annotation is missing from this PDF and was excluded.",
      " ",
      "A selected annotation is missing from this PDF and was excluded.",
      "Image annotation pixels are not included.",
    ],
  });

test("context status lists unique warnings ahead of routine diagnostics", () => {
  const status = baseStatus();

  assert.deepEqual(status.warnings, [
    "A selected annotation is missing from this PDF and was excluded.",
    "Image annotation pixels are not included.",
  ]);
  assert.equal(
    formatChatContextDetails(status),
    "Native conversation resume · 3 prior turns, 1 pins, summary; 2 omitted · Attention Is All You Need · ABCD1234",
  );
});

test("run timing joins the diagnostics line before the paper identity", () => {
  const timed = withChatContextTiming(baseStatus(), "Total 3.1s");

  assert.equal(
    formatChatContextDetails(timed),
    "Native conversation resume · 3 prior turns, 1 pins, summary; 2 omitted · Total 3.1s · Attention Is All You Need · ABCD1234",
  );
  assert.equal(timed.warnings.length, 2);
  assert.equal(
    formatChatContextDetails(withChatContextTiming(undefined, "Total 1.0s")),
    "Total 1.0s",
  );
});

test("rendered status keeps warnings first and puts full diagnostics in the title", () => {
  const doc = new FakeDocument();
  const element = doc.createElement();

  renderChatContextStatus(element as unknown as Element, baseStatus());

  assert.deepEqual(
    element.children.map((child) => child.className),
    [
      "pp-chat-context-status__warning",
      "pp-chat-context-status__warning",
      "pp-chat-context-status__details",
    ],
  );
  const details = element.children[2];
  assert.equal(details.title, details.textContent);
  assert.match(details.textContent, /^Native conversation resume · /);
});

test("rendered status omits empty sections", () => {
  const doc = new FakeDocument();
  const element = doc.createElement();

  renderChatContextStatus(
    element as unknown as Element,
    buildChatContextStatus({
      continuityMode: "Fresh provider conversation; prior context unavailable",
      paperTitle: "",
      attachmentKey: "",
      includedTurns: 0,
      includedPins: 0,
      usedSummary: false,
      omitted: 0,
      warnings: [],
    }),
  );

  assert.equal(element.children.length, 1);
  assert.equal(
    element.textContent,
    "Fresh provider conversation; prior context unavailable · 0 prior turns, 0 pins; 0 omitted",
  );
});
