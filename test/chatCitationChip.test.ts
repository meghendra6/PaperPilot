import { test } from "node:test";
import * as assert from "node:assert/strict";

import {
  createCitationChip,
  describeCitationChip,
} from "../src/modules/components/ChatMessage";
import type { ChatCitation } from "../src/modules/message/chatTypes";

class FakeButton {
  type = "";
  className = "";
  textContent = "";
  title = "";
  disabled = false;
  private readonly attributes = new Map<string, string>();
  private readonly listeners: Array<() => unknown> = [];
  classList = {
    contains: (name: string) => this.className.split(" ").includes(name),
    toggle: (name: string, force: boolean) => {
      const classes = this.className.split(" ").filter((entry) => entry);
      const next = classes.filter((entry) => entry !== name);
      if (force) next.push(name);
      this.className = next.join(" ");
      return force;
    },
  };

  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }

  getAttribute(name: string) {
    return this.attributes.get(name) ?? null;
  }

  removeAttribute(name: string) {
    this.attributes.delete(name);
  }

  addEventListener(_type: string, listener: () => unknown) {
    this.listeners.push(listener);
  }

  async click() {
    await Promise.all(this.listeners.map((listener) => listener()));
  }
}

const doc = {
  createElement: () => new FakeButton(),
} as unknown as Document;

function citation(status: ChatCitation["status"]): ChatCitation {
  return {
    id: "c1",
    sourceID: "zotero:1:ITEM:PDF",
    quote: "Exact grounding improves retrieval.",
    sourceFingerprint: "fingerprint-v1",
    status,
  };
}

function chip(entry: ChatCitation | undefined, open = async () => {}) {
  const explanations: string[] = [];
  const opened: ChatCitation[] = [];
  const button = createCitationChip({
    doc,
    id: "c1",
    citation: entry,
    open: async (value) => {
      opened.push(value);
      await open();
    },
    explain: (text) => explanations.push(text),
  }) as unknown as FakeButton;
  return { button, explanations, opened };
}

test("verified citation chips open the matched passage", async () => {
  const { button, explanations, opened } = chip(citation("verified"));

  assert.equal(button.textContent, "[c1]");
  assert.equal(button.className, "pp-btn pp-citation");
  assert.equal(button.getAttribute("aria-disabled"), null);
  assert.match(button.title, /Exact grounding improves retrieval\./);

  await button.click();

  assert.equal(opened.length, 1);
  assert.deepEqual(explanations, []);
});

test("unverified citation chips stay focusable and explain instead of opening", async () => {
  const { button, explanations, opened } = chip(citation("not-found"));

  assert.equal(button.disabled, false);
  assert.equal(button.getAttribute("aria-disabled"), "true");
  assert.equal(button.classList.contains("pp-citation--unavailable"), true);
  assert.match(button.getAttribute("aria-label") ?? "", /^Citation c1: /);

  await button.click();

  assert.equal(opened.length, 0);
  assert.deepEqual(explanations, [button.title]);
  assert.equal(button.textContent, "[c1]");
});

test("a failed open keeps the citation text and explains the failure", async () => {
  const { button, explanations, opened } = chip(citation("verified"), () =>
    Promise.reject(
      new Error("The quote cannot be verified in the current PDF."),
    ),
  );

  await button.click();
  await button.click();

  assert.equal(opened.length, 1);
  assert.equal(button.textContent, "[c1]");
  assert.equal(button.disabled, false);
  assert.equal(button.getAttribute("aria-disabled"), "true");
  assert.equal(explanations.length, 2);
  assert.match(
    explanations[0],
    /The quote cannot be verified in the current PDF\./,
  );
});

test("citation chip states describe every unavailable source", () => {
  assert.equal(
    describeCitationChip("c1", citation("verified")).unavailable,
    false,
  );
  for (const status of [
    "unverified",
    "not-found",
    "stale",
    "source-unavailable",
  ] as const) {
    const state = describeCitationChip("c1", citation(status));
    assert.equal(state.unavailable, true, status);
    assert.match(state.description, /cannot be opened/, status);
  }
  assert.match(
    describeCitationChip("c9", undefined).label,
    /^Citation c9: Location unverified$/,
  );
  const checking = describeCitationChip("c1", citation("verified"), {
    checking: true,
  });
  assert.equal(checking.unavailable, true);
  assert.match(checking.description, /Checking the original PDF source/);
});
