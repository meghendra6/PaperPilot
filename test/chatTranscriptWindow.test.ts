import * as assert from "node:assert/strict";
import { test } from "node:test";
import {
  CHAT_TRANSCRIPT_WINDOW_SIZE,
  CHAT_TRANSCRIPT_WINDOW_STEP,
  getLatestChatTranscriptWindow,
  notifyChatTranscriptAppend,
  prepareChatTranscriptAppend,
  renderChatTranscriptWindow,
  shiftChatTranscriptWindow,
} from "../src/modules/ui/chatTranscriptWindow";

class FakeDocument {
  defaultView:
    | {
        requestAnimationFrame(callback: () => void): number;
        cancelAnimationFrame(frame: number): void;
      }
    | undefined;

  createElement(tagName: string) {
    return new FakeElement(tagName, this);
  }
}

class FakeElement {
  children: FakeElement[] = [];
  className = "";
  dataset: Record<string, string> = {};
  ownerDocument: FakeDocument;
  parentElement: FakeElement | null = null;
  scrollTop = 0;
  clientHeight = 100;
  layoutScrollHeight: number | undefined;
  type = "";
  private ownText = "";
  private listeners = new Map<string, Array<(...args: unknown[]) => void>>();

  constructor(
    readonly tagName = "div",
    ownerDocument = new FakeDocument(),
  ) {
    this.ownerDocument = ownerDocument;
  }

  get textContent() {
    return this.children.length
      ? this.children.map((child) => child.textContent).join("")
      : this.ownText;
  }

  set textContent(value: string) {
    this.ownText = value;
    this.children = [];
  }

  get scrollHeight() {
    return this.layoutScrollHeight ?? this.children.length * 10;
  }

  append(...children: FakeElement[]) {
    for (const child of children) {
      child.parentElement = this;
      this.children.push(child);
    }
  }

  prepend(child: FakeElement) {
    child.parentElement = this;
    this.children.unshift(child);
  }

  replaceChildren(...children: FakeElement[]) {
    for (const child of this.children) child.parentElement = null;
    this.children = [];
    this.append(...children);
  }

  remove() {
    if (!this.parentElement) return;
    this.parentElement.children = this.parentElement.children.filter(
      (child) => child !== this,
    );
    this.parentElement = null;
  }

  replaceWith(replacement: FakeElement) {
    if (!this.parentElement) return;
    const index = this.parentElement.children.indexOf(this);
    replacement.parentElement = this.parentElement;
    this.parentElement.children[index] = replacement;
    this.parentElement = null;
  }

  addEventListener(
    type: string,
    listener: (...args: unknown[]) => void,
    _options?: unknown,
  ) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: (...args: unknown[]) => void) {
    this.listeners.set(
      type,
      (this.listeners.get(type) || []).filter(
        (candidate) => candidate !== listener,
      ),
    );
  }

  click() {
    for (const listener of this.listeners.get("click") || []) listener();
  }

  focus(_options?: unknown) {
    // no-op
  }

  getBoundingClientRect() {
    const index = this.parentElement
      ? this.parentElement.children.indexOf(this)
      : 0;
    const top = index * 10;
    return { top, bottom: top + 10 };
  }

  querySelectorAll(selector: string): FakeElement[] {
    const matches: FakeElement[] = [];
    const className = selector.startsWith(".") ? selector.slice(1) : undefined;
    const visit = (element: FakeElement) => {
      if (
        className &&
        element.className.split(/\s+/).filter(Boolean).includes(className)
      ) {
        matches.push(element);
      }
      for (const child of element.children) visit(child);
    };
    for (const child of this.children) visit(child);
    return matches;
  }

  querySelector(selector: string): FakeElement | null {
    if (selector === '[data-pp-chat-window-control="earlier"]') {
      return (
        this.find(
          (element) => element.dataset.ppChatWindowControl === "earlier",
        ) || null
      );
    }
    return null;
  }

  private find(
    predicate: (element: FakeElement) => boolean,
  ): FakeElement | undefined {
    for (const child of this.children) {
      if (predicate(child)) return child;
      const nested: FakeElement | undefined = child.find(predicate);
      if (nested) return nested;
    }
    return undefined;
  }
}

test("latest chat transcript window keeps a bounded tail", () => {
  assert.deepEqual(getLatestChatTranscriptWindow(0), { start: 0, end: 0 });
  assert.deepEqual(getLatestChatTranscriptWindow(12), { start: 0, end: 12 });
  assert.deepEqual(getLatestChatTranscriptWindow(100), {
    start: 100 - CHAT_TRANSCRIPT_WINDOW_SIZE,
    end: 100,
  });
});

test("chat transcript window shifts in overlapping bounded steps", () => {
  const latest = getLatestChatTranscriptWindow(100);
  const earlier = shiftChatTranscriptWindow({
    range: latest,
    total: 100,
    direction: "earlier",
  });
  assert.deepEqual(earlier, {
    start: latest.start - CHAT_TRANSCRIPT_WINDOW_STEP,
    end: latest.end - CHAT_TRANSCRIPT_WINDOW_STEP,
  });
  assert.equal(earlier.end - earlier.start, CHAT_TRANSCRIPT_WINDOW_SIZE);

  assert.deepEqual(
    shiftChatTranscriptWindow({
      range: earlier,
      total: 100,
      direction: "newer",
    }),
    latest,
  );
});

test("chat transcript window stops at both transcript boundaries", () => {
  assert.deepEqual(
    shiftChatTranscriptWindow({
      range: { start: 0, end: CHAT_TRANSCRIPT_WINDOW_SIZE },
      total: 100,
      direction: "earlier",
    }),
    { start: 0, end: CHAT_TRANSCRIPT_WINDOW_SIZE },
  );
  assert.deepEqual(
    shiftChatTranscriptWindow({
      range: getLatestChatTranscriptWindow(100),
      total: 100,
      direction: "newer",
    }),
    getLatestChatTranscriptWindow(100),
  );
});

test("chat transcript range normalizes invalid totals and sizes", () => {
  assert.deepEqual(getLatestChatTranscriptWindow(-10), { start: 0, end: 0 });
  assert.deepEqual(getLatestChatTranscriptWindow(10, 0), {
    start: 9,
    end: 10,
  });
});

test("rendered chat transcript detaches overflow while keeping suspension controls", () => {
  const doc = new FakeDocument();
  const container = new FakeElement("div", doc);
  const items = Array.from({ length: 100 }, (_, index) => `message-${index}`);

  const handle = renderChatTranscriptWindow({
    container: container as unknown as HTMLElement,
    getItems: () => items,
    getKey: (item) => item,
    renderItem: () => {
      const wrapper = new FakeElement("div", doc);
      wrapper.className = "pp-message-wrapper";
      container.append(wrapper);
      return wrapper as unknown as HTMLElement;
    },
  });

  let wrappers = container.querySelectorAll(".pp-message-wrapper");
  assert.equal(wrappers.length, CHAT_TRANSCRIPT_WINDOW_SIZE);
  assert.equal(wrappers[0]?.dataset.ppTranscriptKey, "message-52");
  assert.equal(wrappers.at(-1)?.dataset.ppTranscriptKey, "message-99");
  assert.match(
    container.children[0]?.textContent || "",
    /52 messages suspended/,
  );

  const liveWrapper = new FakeElement("div", doc);
  liveWrapper.className = "pp-message-wrapper";
  container.append(liveWrapper);
  notifyChatTranscriptAppend(
    container as unknown as HTMLElement,
    liveWrapper as unknown as HTMLElement,
  );

  wrappers = container.querySelectorAll(".pp-message-wrapper");
  assert.equal(wrappers.length, CHAT_TRANSCRIPT_WINDOW_SIZE);
  assert.equal(wrappers[0]?.dataset.ppTranscriptKey, "message-53");
  assert.match(
    container.children[0]?.textContent || "",
    /53 messages suspended/,
  );

  const earlierButton = container.children[0]?.children[0];
  earlierButton?.click();
  wrappers = container.querySelectorAll(".pp-message-wrapper");
  assert.equal(wrappers[0]?.dataset.ppTranscriptKey, "message-36");
  assert.equal(wrappers.at(-1)?.dataset.ppTranscriptKey, "message-83");

  prepareChatTranscriptAppend(container as unknown as HTMLElement);
  wrappers = container.querySelectorAll(".pp-message-wrapper");
  assert.equal(wrappers[0]?.dataset.ppTranscriptKey, "message-52");
  assert.equal(wrappers.at(-1)?.dataset.ppTranscriptKey, "message-99");
  handle.dispose();
});

test("latest transcript follows answer height that settles after rerender", () => {
  const doc = new FakeDocument();
  const frames = new Map<number, () => void>();
  let nextFrame = 1;
  doc.defaultView = {
    requestAnimationFrame(callback) {
      const frame = nextFrame++;
      frames.set(frame, callback);
      return frame;
    },
    cancelAnimationFrame(frame) {
      frames.delete(frame);
    },
  };
  const runNextFrame = () => {
    const entry = frames.entries().next().value as
      | [number, () => void]
      | undefined;
    assert.ok(entry);
    frames.delete(entry[0]);
    entry[1]();
  };
  const container = new FakeElement("div", doc);
  container.layoutScrollHeight = 120;

  const handle = renderChatTranscriptWindow({
    container: container as unknown as HTMLElement,
    getItems: () => ["question", "long answer"],
    getKey: (item) => item,
    renderItem: () => {
      const wrapper = new FakeElement("div", doc);
      wrapper.className = "pp-message-wrapper";
      container.append(wrapper);
      return wrapper as unknown as HTMLElement;
    },
  });

  assert.equal(container.scrollTop, 120);
  container.layoutScrollHeight = 640;
  runNextFrame();
  assert.equal(container.scrollTop, 640);
  runNextFrame();
  assert.equal(container.scrollTop, 640);
  assert.equal(frames.size, 0);

  handle.dispose();
});

test("suspension control restores a stored entry displaced by a transient append", () => {
  const doc = new FakeDocument();
  const container = new FakeElement("div", doc);
  const items = Array.from(
    { length: CHAT_TRANSCRIPT_WINDOW_SIZE },
    (_, index) => `message-${index}`,
  );

  const handle = renderChatTranscriptWindow({
    container: container as unknown as HTMLElement,
    getItems: () => items,
    getKey: (item) => item,
    renderItem: () => {
      const wrapper = new FakeElement("div", doc);
      wrapper.className = "pp-message-wrapper";
      container.append(wrapper);
      return wrapper as unknown as HTMLElement;
    },
  });

  const transient = new FakeElement("div", doc);
  transient.className = "pp-message-wrapper";
  container.append(transient);
  notifyChatTranscriptAppend(
    container as unknown as HTMLElement,
    transient as unknown as HTMLElement,
  );
  assert.equal(
    container.querySelectorAll(".pp-message-wrapper")[0]?.dataset
      .ppTranscriptKey,
    "message-1",
  );

  container.children[0]?.children[0]?.click();
  const wrappers = container.querySelectorAll(".pp-message-wrapper");
  assert.equal(wrappers.length, CHAT_TRANSCRIPT_WINDOW_SIZE);
  assert.equal(wrappers[0]?.dataset.ppTranscriptKey, "message-0");
  assert.equal(wrappers.at(-1)?.dataset.ppTranscriptKey, "message-47");
  assert.equal(
    container.querySelector('[data-pp-chat-window-control="earlier"]'),
    null,
  );
  handle.dispose();
});
