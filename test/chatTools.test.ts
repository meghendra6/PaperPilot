import * as assert from "node:assert/strict";
import { test } from "node:test";
import {
  createChatTools,
  filterSlashCommands,
  formatUnknownSlashCommand,
  parseSlashCommandInput,
  resolveSlashCommandSubmission,
  SLASH_COMMANDS,
  type ChatSearchResult,
} from "../src/modules/ui/chatTools";

// Event/state fixture only: native Zotero focus and layout require manual QA.
class TestElement extends EventTarget {
  children: TestElement[] = [];
  attributes = new Map<string, string>();
  className = "";
  hidden = false;
  value = "";
  disabled = false;
  private text = "";
  constructor(
    readonly tag: string,
    readonly ownerDocument: TestDocument,
  ) {
    super();
  }
  get textContent(): string {
    return this.text + this.children.map((child) => child.textContent).join("");
  }
  set textContent(text: string) {
    this.text = text;
    this.children = [];
  }
  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }
  getAttribute(name: string) {
    return this.attributes.get(name);
  }
  append(...children: TestElement[]) {
    this.children.push(...children);
  }
  replaceChildren() {
    this.children = [];
    this.text = "";
  }
  querySelector(tag: string): TestElement | undefined {
    for (const child of this.children) {
      if (child.tag === tag) return child;
      const found = child.querySelector(tag);
      if (found) return found;
    }
    return undefined;
  }
  focus() {
    this.ownerDocument.activeElement = this;
  }
  click() {
    this.dispatchEvent(new Event("click"));
  }
}
class TestDocument {
  activeElement?: TestElement;
  createElement(tag: string) {
    return new TestElement(tag, this);
  }
  createTextNode(text: string) {
    const node = this.createElement("text");
    node.textContent = text;
    return node;
  }
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
const result: ChatSearchResult = {
  sessionId: "saved",
  messageId: "answer",
  title: "Paper",
  role: "assistant",
  text: "The current matching answer",
};
function setup(options: {
  onSearch(query: string): Promise<ChatSearchResult[]>;
  onResult?(result: ChatSearchResult): Promise<void>;
  onSearchClose?(): Promise<boolean>;
}) {
  const doc = new TestDocument();
  const input = doc.createElement("textarea");
  const actions: string[] = [];
  const tools = createChatTools({
    doc: doc as unknown as Document,
    input: input as unknown as HTMLTextAreaElement,
    getLength: () => "default",
    onLength: () => {},
    onAction: (action) => {
      actions.push(action);
    },
    onSearch: options.onSearch,
    onResult: options.onResult ?? (async () => {}),
    onSearchClose: options.onSearchClose ?? (() => true),
    onSummary: async () => {},
  });
  const root = tools.root as unknown as TestElement;
  const [bar, commands, search] = root.children;
  const [query, scope, close, results] = search.children;
  const searchButton = bar.children[2];
  const enterQuery = (value: string) => {
    query.value = value;
    query.dispatchEvent(new Event("input"));
  };
  const typeInput = (value: string) => {
    input.value = value;
    input.dispatchEvent(new Event("input"));
  };
  return {
    tools,
    doc,
    input,
    actions,
    typeInput,
    status: root.children[3],
    root,
    commands,
    actionButton: bar.children[0],
    search,
    query,
    scope,
    searchButton,
    close,
    results,
    enterQuery,
  };
}

test("an older rejected search cannot replace a newer successful result", async () => {
  const first = deferred<ChatSearchResult[]>();
  const second = deferred<ChatSearchResult[]>();
  const ui = setup({
    onSearch: (query) => (query === "a" ? first.promise : second.promise),
  });
  ui.searchButton.click();
  ui.enterQuery("a");
  ui.enterQuery("b");
  second.resolve([result]);
  await settle();
  first.reject(new Error("obsolete failure"));
  await settle();
  assert.match(ui.results.textContent, /current matching answer/);
  assert.doesNotMatch(ui.results.textContent, /obsolete/);
});

test("result navigation errors belong to the search that displayed the result", async () => {
  const navigation = deferred<void>();
  const ui = setup({
    onSearch: async () => [result],
    onResult: () => navigation.promise,
  });
  ui.searchButton.click();
  ui.enterQuery("first");
  await settle();
  ui.results.children[0].click();
  ui.enterQuery("second");
  await settle();
  navigation.reject(new Error("stale navigation failure"));
  await settle();
  assert.match(ui.results.textContent, /current matching answer/);
});

test("closing and disposing invalidate pending search errors", async () => {
  for (const dispose of [false, true]) {
    const request = deferred<ChatSearchResult[]>();
    const ui = setup({ onSearch: () => request.promise });
    ui.searchButton.click();
    ui.enterQuery("pending");
    if (dispose) ui.tools.dispose();
    else ui.close.click();
    await settle();
    const before = ui.results.textContent;
    request.reject(new Error("late failure"));
    await settle();
    assert.equal(ui.results.textContent, before);
  }
});

test("return to reading stays open until restoration succeeds", async () => {
  const restore = deferred<boolean>();
  const ui = setup({
    onSearch: async () => [],
    onSearchClose: () => restore.promise,
  });
  ui.searchButton.click();
  ui.close.click();
  await settle();
  assert.equal(ui.search.hidden, false);
  restore.reject(new Error("Could not restore the conversation"));
  await settle();
  assert.equal(ui.search.hidden, false);
  assert.match(ui.results.textContent, /Could not restore/);
});

test("pending search return blocks a second navigation and restores controls when declined", async () => {
  const restore = deferred<boolean>();
  let navigations = 0;
  const ui = setup({
    onSearch: async () => [result],
    onSearchClose: () => restore.promise,
    onResult: async () => {
      navigations++;
    },
  });
  ui.searchButton.click();
  ui.enterQuery("answer");
  await settle();
  ui.close.click();
  assert.equal(ui.query.disabled, true);
  assert.equal(ui.scope.disabled, true);
  ui.results.children[0].click();
  assert.equal(navigations, 0);
  restore.resolve(false);
  await settle();
  assert.equal(ui.search.hidden, false);
  assert.equal(ui.query.disabled, false);
  assert.equal(ui.scope.disabled, false);
  ui.results.children[0].click();
  assert.equal(navigations, 1);
});

test("actions collapse consistently after selection and Escape from their controls", () => {
  const ui = setup({ onSearch: async () => [] });
  ui.actionButton.click();
  assert.equal(ui.actionButton.getAttribute("aria-expanded"), "true");
  ui.commands.children[0].click();
  assert.equal(ui.commands.hidden, true);
  assert.equal(ui.actionButton.getAttribute("aria-expanded"), "false");
  ui.actionButton.click();
  const escape = new Event("keydown", { cancelable: true });
  Object.defineProperty(escape, "key", { value: "Escape" });
  ui.root.dispatchEvent(escape);
  assert.equal(ui.commands.hidden, true);
  assert.equal(ui.actionButton.getAttribute("aria-expanded"), "false");
  assert.equal(ui.doc.activeElement, ui.input);
  assert.equal(escape.defaultPrevented, true);
});

test("slash command parsing accepts only a bare /word draft", () => {
  assert.equal(parseSlashCommandInput("/Sum"), "sum");
  assert.equal(parseSlashCommandInput("/"), "");
  assert.equal(parseSlashCommandInput("/summarize this"), undefined);
  assert.equal(parseSlashCommandInput("What is /etc?"), undefined);
});

test("slash commands filter by the typed prefix", () => {
  assert.deepEqual(filterSlashCommands(""), [...SLASH_COMMANDS]);
  assert.deepEqual(filterSlashCommands("s"), ["summarize"]);
  assert.deepEqual(filterSlashCommands("TR"), ["translate"]);
  assert.deepEqual(filterSlashCommands("cr"), ["critique"]);
  assert.deepEqual(filterSlashCommands("x"), []);
});

test("a bare slash draft picks the first match or reports an unknown command", () => {
  assert.deepEqual(resolveSlashCommandSubmission("/sum"), {
    kind: "pick",
    command: "summarize",
  });
  assert.deepEqual(resolveSlashCommandSubmission("/"), {
    kind: "pick",
    command: "explain",
  });
  assert.deepEqual(resolveSlashCommandSubmission("/foo"), {
    kind: "unknown",
    typed: "foo",
  });
  assert.deepEqual(resolveSlashCommandSubmission("Explain the method"), {
    kind: "not_command",
  });
  assert.match(formatUnknownSlashCommand("foo"), /^Unknown command \/foo\./);
});

test("typing a slash prefix shows only matching commands and highlights the first", () => {
  const ui = setup({ onSearch: async () => [] });
  ui.typeInput("/t");
  assert.equal(ui.commands.hidden, false);
  const visible = ui.commands.children.filter((child) => !child.hidden);
  assert.deepEqual(
    visible.map((child) => child.getAttribute("data-command")),
    ["translate"],
  );
  assert.equal(visible[0].getAttribute("data-active"), "true");
  ui.typeInput("/zzz");
  assert.equal(ui.commands.hidden, true);
  ui.typeInput("A normal question");
  assert.equal(ui.commands.hidden, true);
});

test("Enter on a slash draft picks the highlighted command instead of sending", () => {
  const ui = setup({ onSearch: async () => [] });
  ui.typeInput("/su");
  assert.equal(ui.tools.submitSlashCommand(), true);
  assert.deepEqual(ui.actions, ["summarize"]);
  assert.equal(ui.commands.hidden, true);
});

test("an unknown slash command is not sent and the composer says why", () => {
  const ui = setup({ onSearch: async () => [] });
  ui.typeInput("/foo");
  assert.equal(ui.tools.submitSlashCommand(), true);
  assert.deepEqual(ui.actions, []);
  assert.match(ui.status.textContent, /^Unknown command \/foo/);
  ui.typeInput("Explain the method");
  assert.equal(ui.tools.submitSlashCommand(), false);
});
