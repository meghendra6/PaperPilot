import * as assert from "node:assert/strict";
import { test } from "node:test";
import {
  captureChatTextSelection,
  getNativeSelectionPosition,
  includeChatSelectionRange,
  restoreChatTextSelection,
} from "../src/modules/ui/chatTextSelection";

class TextNode {
  nodeType = 3;
  parentElement: ElementNode | null = null;
  constructor(public nodeValue: string) {}
  get textContent() {
    return this.nodeValue;
  }
}
class ElementNode {
  nodeType = 1;
  nodeValue = null;
  parentElement: ElementNode | null = null;
  childNodes: Array<ElementNode | TextNode> = [];
  dataset: Record<string, string> = {};
  constructor(
    public ownerDocument: SelectionDocument,
    public wrapper = false,
  ) {}
  get textContent(): string {
    return this.childNodes.map((node) => node.textContent).join("");
  }
  append(...nodes: Array<ElementNode | TextNode>) {
    for (const node of nodes) {
      node.parentElement = this;
      this.childNodes.push(node);
    }
  }
  closest(): ElementNode | null {
    return this.wrapper ? this : (this.parentElement?.closest() ?? null);
  }
  contains(node: ElementNode | TextNode): boolean {
    return (
      node === this ||
      this.childNodes.some(
        (child) =>
          child === node ||
          (child instanceof ElementNode && child.contains(node)),
      )
    );
  }
  querySelectorAll(): ElementNode[] {
    return this.childNodes.flatMap((node) =>
      node instanceof ElementNode
        ? [...(node.wrapper ? [node] : []), ...node.querySelectorAll()]
        : [],
    );
  }
}
class SelectionDocument {
  selection = {
    anchorNode: null as ElementNode | TextNode | null,
    anchorOffset: 0,
    focusNode: null as ElementNode | TextNode | null,
    focusOffset: 0,
    get isCollapsed() {
      return (
        this.anchorNode === this.focusNode &&
        this.anchorOffset === this.focusOffset
      );
    },
    setBaseAndExtent(
      anchor: ElementNode | TextNode,
      a: number,
      focus: ElementNode | TextNode,
      f: number,
    ) {
      this.anchorNode = anchor;
      this.anchorOffset = a;
      this.focusNode = focus;
      this.focusOffset = f;
    },
  };
  getSelection() {
    return this.selection;
  }
  createRange() {
    let root: ElementNode;
    let end: ElementNode | TextNode;
    let offset: number;
    return {
      selectNodeContents(node: ElementNode) {
        root = node;
      },
      setEnd(node: ElementNode | TextNode, value: number) {
        end = node;
        offset = value;
      },
      toString() {
        let text = "";
        const visit = (node: ElementNode | TextNode): boolean => {
          if (node === end) {
            text +=
              node instanceof TextNode
                ? node.nodeValue.slice(0, offset)
                : node.childNodes
                    .slice(0, offset)
                    .map((child) => child.textContent)
                    .join("");
            return true;
          }
          if (node instanceof TextNode) text += node.nodeValue;
          else
            for (const child of node.childNodes) if (visit(child)) return true;
          return false;
        };
        visit(root);
        return text;
      },
    };
  }
  createTreeWalker(root: ElementNode) {
    const flatten = (node: ElementNode | TextNode): TextNode[] =>
      node instanceof TextNode ? [node] : node.childNodes.flatMap(flatten);
    const nodes = flatten(root);
    let index = -1;
    return {
      currentNode: null as TextNode | null,
      nextNode() {
        this.currentNode = nodes[++index] ?? null;
        return this.currentNode;
      },
    };
  }
}
function message(doc: SelectionDocument, key: string, parts: string[]) {
  const wrapper = new ElementNode(doc, true);
  wrapper.dataset.ppTranscriptKey = key;
  const texts = parts.map((text) => new TextNode(text));
  // Each part is a separate Markdown inline element, so rebuilds can regroup text.
  for (const text of texts) {
    const inline = new ElementNode(doc);
    inline.append(text);
    wrapper.append(inline);
  }
  return { wrapper, texts };
}

test("backwards Unicode selection spanning messages survives replacement and changed inline node boundaries", () => {
  const doc = new SelectionDocument();
  const container = new ElementNode(doc);
  const first = message(doc, "first", ["한국어 ", "😀 설명"]);
  const second = message(doc, "second", ["Second ", "answer"]);
  container.append(first.wrapper, second.wrapper);
  doc.selection.setBaseAndExtent(second.texts[1], 3, first.texts[1], 2);
  const saved = captureChatTextSelection(container as unknown as HTMLElement);
  assert.deepEqual(saved, {
    anchor: { key: "second", offset: 10 },
    focus: { key: "first", offset: 6 },
  });
  const rebuiltFirst = message(doc, "first", ["한국어 😀 설명"]);
  const rebuiltSecond = message(doc, "second", ["Sec", "ond answer"]);
  container.childNodes = [];
  container.append(rebuiltFirst.wrapper, rebuiltSecond.wrapper);
  doc.selection.setBaseAndExtent(container, 0, container, 0);
  const afterRebuild = getNativeSelectionPosition(doc as unknown as Document);
  assert.equal(
    restoreChatTextSelection(
      container as unknown as HTMLElement,
      saved,
      afterRebuild,
    ),
    true,
  );
  assert.equal(doc.selection.anchorNode, rebuiltSecond.texts[1]);
  assert.equal(doc.selection.anchorOffset, 7);
  assert.equal(doc.selection.focusNode, rebuiltFirst.texts[0]);
  assert.equal(doc.selection.focusOffset, 6);
});

test("restoration does not overwrite a new native selection and refuses missing message endpoints", () => {
  const doc = new SelectionDocument();
  const container = new ElementNode(doc);
  const item = message(doc, "m", ["original answer"]);
  container.append(item.wrapper);
  doc.selection.setBaseAndExtent(item.texts[0], 0, item.texts[0], 8);
  const saved = captureChatTextSelection(container as unknown as HTMLElement);
  const previous = getNativeSelectionPosition(doc as unknown as Document);
  doc.selection.setBaseAndExtent(item.texts[0], 9, item.texts[0], 15);
  assert.equal(
    restoreChatTextSelection(
      container as unknown as HTMLElement,
      saved,
      previous,
    ),
    false,
  );
  assert.equal(doc.selection.anchorOffset, 9);
  container.childNodes = [];
  assert.equal(
    restoreChatTextSelection(
      container as unknown as HTMLElement,
      saved,
      getNativeSelectionPosition(doc as unknown as Document),
    ),
    false,
  );
});

test("a synchronous rebuild keeps both selected message endpoints within a bounded window", () => {
  const keys = Array.from({ length: 200 }, (_, index) => `m${index}`);
  assert.deepEqual(
    includeChatSelectionRange({ start: 152, end: 200 }, keys, {
      anchor: { key: "m20", offset: 0 },
      focus: { key: "m60", offset: 1 },
    }),
    { start: 20, end: 68 },
  );
  assert.deepEqual(
    includeChatSelectionRange({ start: 152, end: 200 }, keys, undefined),
    { start: 152, end: 200 },
  );
});
