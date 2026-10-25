import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import type { StudioConversation } from "../src/modules/studio/aiContracts";

/** The panel's event handlers run unchanged; rendering collaborators are inert. */
function fixture(save: () => Promise<void>) {
  const nodes: Element[] = [];
  const document = {
    body: {},
    activeElement: undefined as Element | undefined,
  };
  class Element {
    children: Element[] = [];
    listeners = new Map<string, () => void>();
    attributes = new Map<string, string>();
    value = "";
    hidden = false;
    disabled = false;
    removed = false;
    dataset = {};
    style = {};
    classList = { add() {}, remove() {}, toggle() {} };
    constructor(
      readonly tag: string,
      public textContent = "",
      readonly className = "",
    ) {
      nodes.push(this);
    }
    get firstElementChild() {
      return this.children[0];
    }
    get childElementCount() {
      return this.children.length;
    }
    append(...children: Element[]) {
      this.children.push(...children);
    }
    replaceChildren(...children: Element[]) {
      this.children = children;
    }
    setAttribute(name: string, value: string) {
      this.attributes.set(name, value);
    }
    addEventListener(type: string, handler: () => void) {
      this.listeners.set(type, handler);
    }
    querySelector() {
      return null;
    }
    contains(element: Element): boolean {
      return (
        this === element ||
        this.children.some((child) => child.contains(element))
      );
    }
    focus() {
      document.activeElement = this;
    }
    remove() {
      this.removed = true;
    }
    click() {
      if (!this.disabled) this.listeners.get("click")?.();
    }
  }
  const node = (tag: string, text?: string, className?: string) =>
    new Element(tag, text, className);
  const pending: Array<{ element: Element; stopped: boolean }> = [];
  const modules: Record<string, unknown> = {
    "./academicDraft": {},
    "./dom": { node },
    "./aiContracts": { TEXT_DOCUMENT: /\.txt$/ },
    "./aiEngine": {
      engineBar: () => ({
        element: node("div"),
        disclosure: () => "Local CLI",
        summary: () => "Codex CLI",
        config: () => ({ provider: "codex", model: "test-model" }),
        setDisabled() {},
      }),
    },
    "./aiHistory": {},
    "./aiTranscript": {
      renderTranscript: () => () => {},
      pendingTurn: () => {
        const item = { element: node("article"), stopped: false };
        pending.push(item);
        return { element: item.element, stop: () => (item.stopped = true) };
      },
    },
  };
  const compiled = transpileModule(
    readFileSync(
      resolve(__dirname, "../src/modules/studio/aiPanel.ts"),
      "utf8",
    ),
    {
      compilerOptions: {
        module: ModuleKind.CommonJS,
        target: ScriptTarget.ES2022,
      },
    },
  ).outputText;
  const exported = {} as typeof import("../src/modules/studio/aiPanel");
  runInNewContext(compiled, {
    exports: exported,
    require: (name: string) => {
      assert.ok(name in modules, `Unexpected panel dependency: ${name}`);
      return modules[name];
    },
    document,
    ResizeObserver: class {
      observe() {}
    },
  });
  const conversation: StudioConversation = {
    schemaVersion: 1,
    projectID: "project-1",
    turns: [],
  };
  const requests: string[] = [];
  let ask = async () => conversation;
  exported.aiPanel(node("div") as unknown as HTMLElement, {
    documents: () => [],
    activeID: () => undefined,
    selection: () => undefined,
    save,
    apply: async () => conversation,
    request: async <T>(method: string) => {
      requests.push(method);
      return (method === "ai.ask" ? await ask() : conversation) as T;
    },
  });
  const question = nodes.find((item) => item.tag === "textarea");
  const send = nodes.find((item) => item.textContent === "Send");
  const stop = nodes.find((item) => item.textContent === "Stop");
  assert.ok(question && send && stop);
  question.value = "Explain the selected paper.";
  const input = question.listeners.get("input");
  assert.ok(input);
  input();
  return {
    requests,
    pending,
    question,
    send,
    stop,
    setAsk: (value: typeof ask) => (ask = value),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

const settled = () => new Promise<void>((done) => setImmediate(done));

test("Stop during context saving prevents AI launch and preserves a retryable question", async () => {
  const save = deferred<void>();
  const f = fixture(() => save.promise);
  f.send.click();
  assert.equal(f.stop.hidden, false);
  f.stop.click();
  assert.equal(
    f.requests.length,
    0,
    "There is no host run to cancel while saving.",
  );
  save.resolve();
  await settled();
  assert.equal(f.requests.includes("ai.ask"), false);
  assert.equal(f.question.value, "Explain the selected paper.");
  assert.equal(f.pending[0].element.removed, true);
  assert.equal(f.pending[0].stopped, true);
  assert.equal(f.send.disabled, false);
  assert.equal(f.stop.hidden, true);

  f.send.click();
  await settled();
  assert.equal(f.requests.filter((method) => method === "ai.ask").length, 1);
  assert.equal(f.question.value, "");
});

test("Stop after AI launch still reaches the host cancellation handler", async () => {
  const f = fixture(async () => {});
  const run = deferred<StudioConversation>();
  f.setAsk(() => run.promise);
  f.send.click();
  await settled();
  assert.deepEqual(f.requests, ["ai.ask"]);
  f.stop.click();
  assert.deepEqual(f.requests, ["ai.ask", "ai.cancel"]);
  run.reject(new Error("AI run canceled."));
  await settled();
  assert.equal(f.question.value, "Explain the selected paper.");
  assert.equal(f.pending[0].stopped, true);
  assert.equal(f.stop.disabled, true);
  f.stop.click();
  assert.equal(f.requests.filter((method) => method === "ai.cancel").length, 1);
});
