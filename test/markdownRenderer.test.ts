import * as assert from "node:assert/strict";
import { test } from "node:test";
import { renderMarkdownFragment } from "../src/modules/components/markdownRenderer";

class FakeElement {
  children: FakeElement[] = [];
  className = "";
  private value = "";

  constructor(
    readonly tagName: string,
    readonly ownerDocument: FakeDocument,
  ) {}

  set textContent(value: string) {
    this.value = value;
    this.children = [];
  }

  get textContent(): string {
    return this.children.length
      ? this.children.map((child) => child.textContent).join("")
      : this.value;
  }

  set innerHTML(value: string) {
    this.value = value.replace(/<[^>]+>/g, "");
    this.children = [];
  }

  appendChild(child: FakeElement) {
    this.children.push(child);
    return child;
  }
}

class FakeDocument {
  createElement(tagName: string) {
    return new FakeElement(tagName, this);
  }

  createDocumentFragment() {
    return new FakeElement("#fragment", this);
  }
}

function descendants(root: FakeElement, tagName: string): FakeElement[] {
  return root.children.flatMap((child) => [
    ...(child.tagName === tagName ? [child] : []),
    ...descendants(child, tagName),
  ]);
}

function render(text: string) {
  const doc = new FakeDocument();
  return renderMarkdownFragment(
    text,
    doc as unknown as Document,
  ) as unknown as FakeElement;
}

test("Markdown tables skip each separator row without dropping data rows", () => {
  const fragment = render(
    "| Name | Value |\n| --- | --- |\n| alpha | one |\n| --- | --- |\n| beta | two |",
  );
  const bodies = descendants(fragment, "tbody");
  assert.equal(bodies.length, 1);
  assert.equal(bodies[0].children.length, 2);
  assert.match(bodies[0].textContent, /alphaone/);
  assert.match(bodies[0].textContent, /betatwo/);
});

test("Markdown only treats exact math and code markers as block openers", () => {
  const fragment = render(
    "$$x$$ is displayed, then prose\n\n```ts trailing prose\nStill visible",
  );
  assert.equal(descendants(fragment, "pre").length, 0);
  assert.equal(descendants(fragment, "div").length, 0);
  assert.match(fragment.textContent, /\$\$x\$\$ is displayed, then prose/);
  assert.match(fragment.textContent, /```ts trailing prose/);
  assert.match(fragment.textContent, /Still visible/);
});

test("Markdown preserves headings, blockquotes, fenced code, and nested-list text", () => {
  const fragment = render(
    "# Heading\n\n> Quoted evidence\n\n- parent\n  - nested\n\n```ts\nconst answer = 42;\n```",
  );
  assert.equal(descendants(fragment, "h1").length, 1);
  assert.equal(descendants(fragment, "blockquote").length, 1);
  assert.equal(descendants(fragment, "li").length, 2);
  assert.equal(descendants(fragment, "pre").length, 1);
  assert.match(fragment.textContent, /nested/);
  assert.match(fragment.textContent, /const answer = 42;/);
});
