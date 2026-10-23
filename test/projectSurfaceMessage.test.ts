import { test } from "node:test";
import * as assert from "node:assert/strict";

import { setMessage } from "../src/modules/researchWorkspace/projectSurfaceShared";

class FakeNode {
  attributes = new Map<string, string>();
  dataset: Record<string, string> = {};
  className = "";
  textContent = "";
  children: FakeNode[] = [];
  constructor(readonly ownerDocument: FakeDocument) {}
  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }
  prepend(node: FakeNode) {
    this.children.unshift(node);
  }
  querySelector(selector: string) {
    return selector === "[data-project-message]"
      ? (this.children.find((child) => child.dataset.projectMessage) ?? null)
      : null;
  }
}

class FakeDocument {
  createElementNS() {
    return new FakeNode(this);
  }
}

test("the project status line becomes an assertive alert for an error", () => {
  const root = new FakeNode(new FakeDocument()) as unknown as HTMLElement;
  setMessage(root, "Project ready.", "success");
  const node = (root as unknown as FakeNode).children[0];
  assert.equal(node.attributes.get("role"), "status");
  setMessage(root, "Saving failed.", "error");
  assert.equal((root as unknown as FakeNode).children.length, 1);
  assert.equal(node.attributes.get("role"), "alert");
  assert.equal(node.attributes.get("aria-live"), "assertive");
  setMessage(root, "Saved.", "success");
  assert.equal(node.attributes.get("role"), "status");
  assert.equal(node.attributes.get("aria-live"), "polite");
});
