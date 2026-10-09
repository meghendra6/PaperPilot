import { afterEach, test } from "node:test";
import * as assert from "node:assert/strict";

import {
  SECTION_STACK_ALL_COLLAPSED_CLASS,
  createCollapsibleSection,
  syncSectionStackCollapsedState,
} from "../src/modules/ui/collapsibleSection";
import { createGlobalStateRestorer } from "./helpers/globalState";

const restoreGlobals = createGlobalStateRestorer(["Zotero"]);
afterEach(restoreGlobals);

class FakeClassList {
  constructor(private readonly element: FakeElement) {}

  private read() {
    return new Set(this.element.className.split(/\s+/).filter(Boolean));
  }

  private write(classes: Set<string>) {
    this.element.className = Array.from(classes).join(" ");
  }

  add(...names: string[]) {
    const classes = this.read();
    for (const name of names) classes.add(name);
    this.write(classes);
  }

  remove(...names: string[]) {
    const classes = this.read();
    for (const name of names) classes.delete(name);
    this.write(classes);
  }

  contains(name: string) {
    return this.read().has(name);
  }

  toggle(name: string, force?: boolean) {
    const next = force ?? !this.contains(name);
    if (next) this.add(name);
    else this.remove(name);
    return next;
  }
}

class FakeElement {
  id = "";
  className = "";
  type = "";
  title = "";
  textContent = "";
  hidden = false;
  tabIndex = -1;
  dataset: Record<string, string> = {};
  style: Record<string, string> & { removeProperty(name: string): void } =
    Object.assign(Object.create(null), {
      removeProperty(this: Record<string, string>, name: string) {
        delete this[name];
      },
    });
  classList = new FakeClassList(this);
  children: FakeElement[] = [];
  parentElement: FakeElement | null = null;
  private readonly attributes = new Map<string, string>();
  private readonly listeners = new Map<string, Array<() => void>>();

  constructor(
    readonly tagName: string,
    readonly ownerDocument: FakeDocument,
  ) {}

  append(...nodes: FakeElement[]) {
    for (const node of nodes) {
      node.parentElement = this;
      this.children.push(node);
    }
  }

  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }

  getAttribute(name: string) {
    return this.attributes.get(name) ?? null;
  }

  addEventListener(type: string, listener: () => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  removeEventListener(type: string, listener: () => void) {
    this.listeners.set(
      type,
      (this.listeners.get(type) ?? []).filter((entry) => entry !== listener),
    );
  }

  click() {
    for (const listener of this.listeners.get("click") ?? []) listener();
  }

  getBoundingClientRect() {
    return { height: 0 };
  }
}

class FakeDocument {
  defaultView = null;

  createElement(tagName: string) {
    return new FakeElement(tagName, this);
  }
}

function installPrefs() {
  const prefs = new Map<string, unknown>();
  (globalThis as Record<string, unknown>).Zotero = {
    Prefs: {
      get: (key: string) => prefs.get(key),
      set: (key: string, value: unknown) => prefs.set(key, value),
    },
  };
  return prefs;
}

function mountStack(expanded: Record<string, boolean>) {
  const doc = new FakeDocument();
  const stack = doc.createElement("div");
  const sections = Object.entries(expanded).map(([id, defaultExpanded]) =>
    createCollapsibleSection({
      doc: doc as unknown as Document,
      id: id as "workbench" | "related" | "sessions",
      title: id,
      defaultExpanded,
    }),
  );
  for (const section of sections)
    stack.append(section.root as unknown as FakeElement);
  return { stack, sections };
}

test("a mounted stack is marked once every section starts collapsed", async () => {
  installPrefs();
  const { stack, sections } = mountStack({
    workbench: false,
    related: false,
    sessions: false,
  });

  await Promise.resolve();

  assert.equal(
    stack.classList.contains(SECTION_STACK_ALL_COLLAPSED_CLASS),
    true,
  );
  for (const section of sections) section.dispose();
});

test("expanding any section clears the collapsed mark and keeps a manual size", async () => {
  installPrefs();
  const { stack, sections } = mountStack({
    workbench: false,
    related: false,
    sessions: false,
  });
  stack.style.height = "320px";
  stack.style.flexBasis = "320px";
  await Promise.resolve();

  sections[1].setExpanded(true, false);
  assert.equal(
    stack.classList.contains(SECTION_STACK_ALL_COLLAPSED_CLASS),
    false,
  );

  sections[1].setExpanded(false, false);
  assert.equal(
    stack.classList.contains(SECTION_STACK_ALL_COLLAPSED_CLASS),
    true,
  );
  assert.equal(stack.style.height, "320px");
  assert.equal(stack.style.flexBasis, "320px");
  for (const section of sections) section.dispose();
});

test("trigger clicks update the stack mark and persist the section state", async () => {
  const prefs = installPrefs();
  const { stack, sections } = mountStack({
    workbench: true,
    related: false,
    sessions: false,
  });
  await Promise.resolve();
  assert.equal(
    stack.classList.contains(SECTION_STACK_ALL_COLLAPSED_CLASS),
    false,
  );

  (sections[0].root as unknown as FakeElement).children[0].click();

  assert.equal(
    stack.classList.contains(SECTION_STACK_ALL_COLLAPSED_CLASS),
    true,
  );
  assert.match(
    String(prefs.get("extensions.zotero.paperpilot.paneSectionState")),
    /"workbench":false/,
  );
  for (const section of sections) section.dispose();
});

test("syncSectionStackCollapsedState ignores stacks without sections", () => {
  const doc = new FakeDocument();
  const stack = doc.createElement("div");
  stack.append(doc.createElement("div"));

  syncSectionStackCollapsedState(stack as unknown as Element);
  syncSectionStackCollapsedState(null);

  assert.equal(
    stack.classList.contains(SECTION_STACK_ALL_COLLAPSED_CLASS),
    false,
  );
});
