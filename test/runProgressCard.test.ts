import * as assert from "node:assert/strict";
import { test } from "node:test";
import { createRunProgressState } from "../src/modules/ai/runProgress";
import { createRunProgressCard } from "../src/modules/ui/runProgressCard";

class FakeElement {
  ownerDocument: FakeDocument;
  children: FakeElement[] = [];
  style: Record<string, string> = {};
  dataset: Record<string, string> = {};
  attributes = new Map<string, string>();
  textContent = "";
  type = "";
  className = "";

  constructor(ownerDocument: FakeDocument) {
    this.ownerDocument = ownerDocument;
  }

  append(...children: FakeElement[]) {
    this.children.push(...children);
  }

  appendChild(child: FakeElement) {
    this.children.push(child);
    return child;
  }

  replaceChildren(...children: FakeElement[]) {
    this.children = children;
  }

  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }

  removeAttribute(name: string) {
    this.attributes.delete(name);
  }

  addEventListener() {}
}

class FakeDocument {
  createElement() {
    return new FakeElement(this);
  }
}

test("run progress card owns one timer and dispose is idempotent", () => {
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  const activeTimers = new Map<number, () => void>();
  let nextTimer = 1;
  globalThis.setInterval = ((callback: () => void) => {
    const timer = nextTimer++;
    activeTimers.set(timer, callback);
    return timer;
  }) as unknown as typeof setInterval;
  globalThis.clearInterval = ((timer: number) => {
    activeTimers.delete(timer);
  }) as unknown as typeof clearInterval;

  try {
    const doc = new FakeDocument();
    const container = new FakeElement(doc);
    const card = createRunProgressCard({
      container: container as unknown as HTMLElement,
      actions: {
        onCancel() {},
        onRetry() {},
        onOpenSettings() {},
        onShowLoginHelp() {},
      },
    });
    const preparing = createRunProgressState({
      itemID: 71,
      engine: "codex_cli",
      now: 100,
    });

    card.render(preparing);
    assert.equal(activeTimers.size, 1);
    assert.equal(container.dataset.phase, "preparing");
    assert.equal(container.children.length, 3);
    const initialHeader = container.children[0];
    activeTimers.values().next().value?.();
    assert.equal(container.children[0], initialHeader);

    card.render(preparing);
    assert.equal(activeTimers.size, 1);
    card.dispose();
    assert.equal(activeTimers.size, 0);
    assert.equal(container.children.length, 0);
    card.dispose();
    assert.equal(activeTimers.size, 0);
  } finally {
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
  }
});
