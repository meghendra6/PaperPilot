import * as assert from "node:assert/strict";
import { test } from "node:test";
import {
  discoveryLaneSignature,
  renderDiscoverySection,
} from "../src/modules/ui/discoverySection";
import type {
  RecommendationGroup,
  RecommendedPaper,
} from "../src/modules/relatedRecommendations";

interface FakeElement {
  tagName: string;
  ownerDocument: FakeDocument;
  children: FakeElement[];
  className: string;
  textContent: string;
  open: boolean;
  style: Record<string, string>;
  listeners: Map<string, Array<() => void>>;
  appendChild(child: FakeElement): FakeElement;
  append(...nodes: FakeElement[]): void;
  replaceChildren(...nodes: FakeElement[]): void;
  remove(): void;
  addEventListener(name: string, listener: () => void): void;
  dispatch(name: string): void;
}

interface FakeDocument {
  createElement(tag: string): FakeElement;
}

function createFakeDocument(): FakeDocument {
  const doc: FakeDocument = {
    createElement(tag) {
      const element: FakeElement = {
        tagName: tag.toUpperCase(),
        ownerDocument: doc,
        children: [],
        className: "",
        textContent: "",
        open: false,
        style: {},
        listeners: new Map(),
        appendChild(child) {
          element.children.push(child);
          return child;
        },
        append(...nodes) {
          element.children.push(...nodes);
        },
        replaceChildren(...nodes) {
          element.children = [...nodes];
        },
        remove() {
          element.style.removed = "true";
        },
        addEventListener(name, listener) {
          element.listeners.set(name, [
            ...(element.listeners.get(name) ?? []),
            listener,
          ]);
        },
        dispatch(name) {
          for (const listener of element.listeners.get(name) ?? []) listener();
        },
      };
      return element;
    },
  };
  return doc;
}

function paper(title: string, extra: Partial<RecommendedPaper> = {}) {
  return { title, candidateID: title, ...extra } as RecommendedPaper;
}

function groups(otherCount = 8, patch: Partial<RecommendedPaper> = {}) {
  return [
    {
      category: "Verified main-conference papers",
      papers: [paper("Main A", patch)],
    },
    {
      category: "Other peer-reviewed work",
      papers: Array.from({ length: otherCount }, (_, index) =>
        paper(`Other ${index}`),
      ),
    },
  ] as RecommendationGroup[];
}

function lanes(container: FakeElement) {
  return container.children.filter((node) => node.tagName === "DETAILS");
}

function render(container: FakeElement, value: RecommendationGroup[]) {
  renderDiscoverySection({
    container: container as unknown as HTMLElement,
    groups: value,
    buildRow: (entry) => {
      const row = container.ownerDocument.createElement("div");
      row.className = "pp-recommendation-row";
      row.textContent = entry.title;
      return row as unknown as HTMLElement;
    },
  });
}

test("lanes keep their open state and revealed rows after a row action re-renders", () => {
  const container = createFakeDocument().createElement("div");
  render(container, groups());
  const [main, other] = lanes(container);
  assert.equal(main.open, true);
  assert.equal(other.open, false);

  other.open = true;
  other.dispatch("toggle");
  main.open = false;
  main.dispatch("toggle");
  const showMore = other.children.find((node) => node.tagName === "BUTTON");
  assert.ok(showMore);
  showMore.dispatch("click");

  render(container, groups(8, { existingItemID: 42 }));
  const [mainAfter, otherAfter] = lanes(container);
  assert.equal(mainAfter.open, false);
  assert.equal(otherAfter.open, true);
  assert.ok(
    otherAfter.children
      .filter((node) => node.className === "pp-recommendation-row")
      .every((row) => row.style.display !== "none"),
  );
  assert.equal(
    otherAfter.children.some((node) => node.tagName === "BUTTON"),
    false,
  );
});

test("a new discovery result starts from the default lane layout", () => {
  const container = createFakeDocument().createElement("div");
  render(container, groups());
  const [, other] = lanes(container);
  other.open = true;
  other.dispatch("toggle");
  render(container, groups(7));
  assert.equal(lanes(container)[1].open, false);
});

test("lane signatures ignore row patches and change with the result set", () => {
  assert.equal(
    discoveryLaneSignature(groups()),
    discoveryLaneSignature(groups(8, { existingItemID: 9 })),
  );
  assert.notEqual(
    discoveryLaneSignature(groups()),
    discoveryLaneSignature(groups(3)),
  );
});
