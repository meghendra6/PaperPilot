import { test } from "node:test";
import * as assert from "node:assert/strict";

import {
  captureSurfaceState,
  restoreSurfaceState,
} from "../src/modules/researchWorkspace/projectSurfaceState";

/** The parts of a form control that surface state reads and writes. */
class FakeControl {
  readonly dataset: Record<string, string> = {};
  readonly type = "text";
  value: string;
  disabled = false;
  focused = false;
  constructor(
    readonly tagName: string,
    readonly label: string,
    value: string,
  ) {
    this.value = value;
  }
  getAttribute(name: string) {
    return name === "aria-label" ? this.label : null;
  }
  closest() {
    return null;
  }
  focus() {
    this.focused = true;
  }
}

/** A panel root holding controls, with one kept analysis area. */
function fakeRoot(controls: FakeControl[]) {
  const operations = { contains: () => false };
  const root = {
    ownerDocument: { activeElement: null, defaultView: undefined },
    querySelectorAll: () => controls,
    querySelector: () => null,
    contains: (node: unknown) => controls.includes(node as FakeControl),
  };
  return {
    root: root as unknown as HTMLElement,
    operations: operations as unknown as HTMLElement,
  };
}

test("a rebuild keeps unsaved text and marks it unsaved", () => {
  const typed = new FakeControl("TEXTAREA", "Research question", "Draft");
  typed.dataset.dirty = "true";
  const before = fakeRoot([typed]);
  const state = captureSurfaceState(before.root, before.operations);

  const rendered = new FakeControl("TEXTAREA", "Research question", "Saved");
  const after = fakeRoot([rendered]);
  restoreSurfaceState(after.root, after.operations, state);

  assert.equal(rendered.value, "Draft");
  assert.equal(rendered.dataset.dirty, "true");
});

test("a saved value is not unsaved after the rebuild", () => {
  // The reader typed "Saved" and saved it; the panel re-renders with it.
  const typed = new FakeControl("INPUT", "Project name", "Saved");
  typed.dataset.dirty = "true";
  const before = fakeRoot([typed]);
  const state = captureSurfaceState(before.root, before.operations);

  const rendered = new FakeControl("INPUT", "Project name", "Saved");
  const after = fakeRoot([rendered]);
  restoreSurfaceState(after.root, after.operations, state);

  assert.equal(rendered.value, "Saved");
  assert.equal(rendered.dataset.dirty, undefined);

  // A later rebuild therefore shows a change made elsewhere.
  const next = fakeRoot([new FakeControl("INPUT", "Project name", "Renamed")]);
  const later = captureSurfaceState(after.root, after.operations);
  restoreSurfaceState(next.root, next.operations, later);
  assert.equal(
    (next.root.querySelectorAll("*")[0] as unknown as FakeControl).value,
    "Renamed",
  );
});
