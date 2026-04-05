import { test } from "node:test";
import * as assert from "node:assert/strict";

import {
  addMessage,
  setMessageContent,
} from "../src/modules/components/ChatMessage";
import { sanitizeAssistantText } from "../src/modules/message/assistantOutput";

class FakeDocument {
  createElement(tagName: string) {
    return new FakeElement(tagName, this);
  }

  createDocumentFragment() {
    return new FakeElement("#fragment", this);
  }
}

class FakeStyle {
  [key: string]: string | ((name: string, value: string) => void);

  setProperty(name: string, value: string) {
    this[name] = value;
  }
}

class FakeElement {
  style = new FakeStyle();
  children: FakeElement[] = [];
  scrollTop = 0;
  scrollHeight = 64;
  tagName: string;
  ownerDocument: FakeDocument;
  className = "";
  classList = {
    add: (...classes: string[]) => {
      const existing = this.className ? this.className.split(" ") : [];
      for (const cls of classes) {
        if (!existing.includes(cls)) {
          existing.push(cls);
        }
      }
      this.className = existing.join(" ");
    },
  };
  private _textContent = "";
  private _innerHTML = "";

  constructor(tagName = "div", ownerDocument = new FakeDocument()) {
    this.tagName = tagName;
    this.ownerDocument = ownerDocument;
  }

  get textContent() {
    if (this.children.length) {
      return this.children.map((child) => child.textContent).join("");
    }
    return this._textContent;
  }

  set textContent(value: string) {
    this._textContent = value;
    this._innerHTML = value;
    this.children = [];
  }

  get innerHTML() {
    return this._innerHTML;
  }

  set innerHTML(value: string) {
    this._innerHTML = value;
    this._textContent = value.replace(/<[^>]+>/g, "");
    this.children = [];
  }

  appendChild(child: FakeElement) {
    if (child.tagName === "#fragment") {
      this.children.push(...child.children);
      return child;
    }
    this.children.push(child);
    return child;
  }

  addEventListener(_event: string, _handler: () => void) {
    // no-op in tests
  }

  replaceChildren(...children: FakeElement[]) {
    this.children = [];
    for (const child of children) {
      this.appendChild(child);
    }
  }
}

function withFakeDocument(fn: () => void) {
  const doc = new FakeDocument();
  const previousDocument = globalThis.document;
  globalThis.document = doc as unknown as Document;

  try {
    fn();
  } finally {
    globalThis.document = previousDocument;
  }
}

test("addMessage applies CSS classes for assistant messages", () => {
  withFakeDocument(() => {
    const container = new FakeElement();
    const message = addMessage(
      container as unknown as Element,
      "plain text",
      "ai",
    ) as unknown as FakeElement;
    const wrapper = container.children[0];

    assert.ok(message);
    assert.equal(message.className, "pp-message pp-message--ai");
    assert.equal(
      wrapper.className,
      "pp-message-wrapper pp-message-wrapper--ai",
    );
  });
});

test("sanitizeAssistantText removes links and workspace filenames", () => {
  const sanitized = sanitizeAssistantText(
    "Read paper.md, paper.json, and [source](https://example.com/source).\n\nSources: https://example.com",
  );

  assert.doesNotMatch(sanitized, /paper\.(?:md|json|txt)/);
  assert.doesNotMatch(sanitized, /https?:\/\//);
  assert.match(sanitized, /the paper/);
  assert.match(sanitized, /the paper structure/);
  assert.match(sanitized, /source/);
});

test("addMessage injects rendered markdown structure for assistant output", () => {
  withFakeDocument(() => {
    const container = new FakeElement();
    const source = "# Title\n\n**bold** item";
    const message = addMessage(
      container as unknown as Element,
      source,
      "ai",
    ) as unknown as FakeElement;

    assert.ok(message);
    assert.equal(message.children[0]?.tagName, "h1");
    assert.equal(message.children[0]?.innerHTML, "Title");
    assert.equal(message.children[1]?.tagName, "p");
    assert.match(message.children[1]?.innerHTML, /<strong>bold<\/strong>/);
    assert.notEqual(message.textContent, source);
  });
});

test("addMessage strips assistant source links from rendered output", () => {
  withFakeDocument(() => {
    const container = new FakeElement();
    const message = addMessage(
      container as unknown as Element,
      "See [details](https://example.com) from paper.txt.",
      "ai",
    ) as unknown as FakeElement;

    assert.equal(message.children[0]?.tagName, "p");
    assert.doesNotMatch(message.children[0]?.innerHTML, /href=/);
    assert.doesNotMatch(message.textContent, /paper\.txt/);
    assert.match(message.textContent, /the paper/);
  });
});

test("addMessage preserves markdown line breaks in paragraphs", () => {
  withFakeDocument(() => {
    const container = new FakeElement();
    const source = "line one\nline two";
    const message = addMessage(
      container as unknown as Element,
      source,
      "ai",
    ) as unknown as FakeElement;

    assert.equal(message.children[0]?.tagName, "p");
    assert.match(message.children[0]?.innerHTML, /line one<br \/>line two/);
  });
});

test("setMessageContent preserves assistant markdown on updates", () => {
  withFakeDocument(() => {
    const message = new FakeElement() as unknown as HTMLElement;
    setMessageContent(message, "# Updated\n\n**bold**", "ai");
    const fake = message as unknown as FakeElement;
    assert.equal(fake.children[0]?.tagName, "h1");
    assert.equal(fake.children[1]?.tagName, "p");
    assert.match(fake.children[1]?.innerHTML, /<strong>bold<\/strong>/);
  });
});

test("addMessage renders --- as a horizontal rule", () => {
  withFakeDocument(() => {
    const container = new FakeElement();
    const message = addMessage(
      container as unknown as Element,
      "before\n\n---\n\nafter",
      "ai",
    ) as unknown as FakeElement;

    assert.equal(message.children[0]?.tagName, "p");
    const hr = message.children.find((child) => child.tagName === "hr");
    assert.ok(hr, "expected an hr element");
    const lastP = [...message.children]
      .reverse()
      .find((c) => c.tagName === "p");
    assert.ok(lastP, "expected a trailing p element");
  });
});

test("addMessage renders without relying on a global document", () => {
  const previousDocument = globalThis.document;
  const fakeDocument = new FakeDocument();
  globalThis.document = undefined as unknown as Document;

  try {
    const container = new FakeElement("div", fakeDocument);
    const message = addMessage(
      container as unknown as Element,
      "# Runtime\n\nlocal document",
      "ai",
    ) as unknown as FakeElement;

    assert.ok(message);
    assert.equal(message.children[0]?.tagName, "h1");
    assert.equal(message.children[0]?.textContent, "Runtime");
  } finally {
    globalThis.document = previousDocument;
  }
});

test("addMessage renders markdown links as plain text", () => {
  withFakeDocument(() => {
    const container = new FakeElement();
    const message = addMessage(
      container as unknown as Element,
      "[Source](https://example.com/paper)",
      "ai",
    ) as unknown as FakeElement;

    assert.equal(message.children[0]?.tagName, "p");
    assert.equal(message.children[0]?.innerHTML, "Source");
  });
});
