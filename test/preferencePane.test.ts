import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import * as assert from "node:assert/strict";

import { config } from "../package.json";
import { registerPrefsScripts } from "../src/modules/preferenceScript";
import {
  CHOICE_PREFERENCE_FIELDS,
  getChoicePreferenceField,
} from "../src/modules/preferences/choiceFields";
import {
  RETRIEVAL_CHUNK_SIZE_MAX,
  RETRIEVAL_CHUNK_SIZE_MIN,
} from "../src/modules/context/retrievalSettings";
import { PREF_PANE_ELEMENT_SUFFIXES } from "../src/modules/preferences/paneBindings";
import { maxOverlapForChunkSize } from "../src/modules/tools/splitTextIntoChunks";
import { createGlobalStateRestorer } from "./helpers/globalState";

const template = readFileSync(
  join(process.cwd(), "addon", "chrome", "content", "preferences.xhtml"),
  "utf8",
);
const fluent = readFileSync(
  join(process.cwd(), "addon", "locale", "en-US", "preferences.ftl"),
  "utf8",
);

type Listener = () => void;

class FakeElement {
  value = "";
  checked = false;
  hidden = false;
  open = false;
  max = "";
  type = "";
  readonly dataset: Record<string, string> = {};
  readonly attributes = new Map<string, string>();
  readonly children: FakeElement[] = [];
  parent: FakeElement | undefined;
  private readonly listeners = new Map<string, Listener[]>();

  constructor(
    readonly localName: string,
    readonly id = "",
  ) {}

  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }

  getAttribute(name: string) {
    return this.attributes.get(name) ?? null;
  }

  removeAttribute(name: string) {
    this.attributes.delete(name);
  }

  addEventListener(type: string, listener: Listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  listenerCount(type: string) {
    return this.listeners.get(type)?.length ?? 0;
  }

  dispatch(type: string) {
    for (const listener of this.listeners.get(type) ?? []) listener();
  }

  appendChild(child: FakeElement) {
    child.parent = this;
    this.children.push(child);
    return child;
  }

  remove() {
    if (!this.parent) return;
    this.parent.children.splice(this.parent.children.indexOf(this), 1);
    this.parent = undefined;
  }

  querySelectorAll(selector: string) {
    if (selector === "option") {
      return this.children.filter((child) => child.localName === "option");
    }
    if (selector === 'input[type="radio"]') {
      return this.children.filter(
        (child) => child.localName === "input" && child.type === "radio",
      );
    }
    throw new Error(`unsupported selector ${selector}`);
  }
}

class FakeDocument {
  readonly elements = new Map<string, FakeElement>();

  add(localName: string, suffix: string) {
    const id = `zotero-prefpane-${config.addonRef}-${suffix}`;
    assert.match(
      template,
      new RegExp(`id="zotero-prefpane-__addonRef__-${suffix}"`),
      `preferences.xhtml must declare #${suffix}`,
    );
    const element = new FakeElement(localName, id);
    this.elements.set(id, element);
    return element;
  }

  get(suffix: string) {
    const element = this.elements.get(
      `zotero-prefpane-${config.addonRef}-${suffix}`,
    );
    assert.ok(element, `missing fake element ${suffix}`);
    return element;
  }

  querySelector(selector: string) {
    return this.elements.get(selector.replace(/^#/, "")) ?? null;
  }

  createElementNS(_namespace: string, localName: string) {
    return new FakeElement(localName);
  }
}

function buildPane() {
  const doc = new FakeDocument();
  doc.add("select", "input-response-language");
  for (const field of CHOICE_PREFERENCE_FIELDS) {
    const select = doc.add("select", `input-${field.inputSuffix}`);
    for (const value of field.options) {
      const option = new FakeElement("option");
      option.value = value;
      select.appendChild(option);
    }
  }
  const history = doc.add("div", PREF_PANE_ELEMENT_SUFFIXES.historyMode);
  for (const mode of ["disabled", "prompts-only", "full"]) {
    assert.match(
      template,
      new RegExp(
        `type="radio"[^>]*value="${mode}"|value="${mode}"[^>]*type="radio"`,
      ),
    );
    const radio = new FakeElement("input");
    radio.type = "radio";
    radio.value = mode;
    history.appendChild(radio);
  }
  doc.add("input", PREF_PANE_ELEMENT_SUFFIXES.chunkSize);
  doc.add("input", PREF_PANE_ELEMENT_SUFFIXES.overlapSize);
  doc.add("p", PREF_PANE_ELEMENT_SUFFIXES.chunkSizeWarning);
  doc.add("p", PREF_PANE_ELEMENT_SUFFIXES.overlapSizeWarning);
  doc.add("details", PREF_PANE_ELEMENT_SUFFIXES.retrievalAdvanced);
  return doc;
}

function withPrefs(
  values: Record<string, unknown>,
  run: (prefs: Map<string, unknown>) => Promise<void>,
) {
  const restore = createGlobalStateRestorer(["Zotero", "addon"]);
  const prefs = new Map<string, unknown>(
    Object.entries(values).map(([key, value]) => [
      `${config.prefsPrefix}.${key}`,
      value,
    ]),
  );
  const globals = globalThis as Record<string, unknown>;
  globals.addon = { data: {} };
  globals.Zotero = {
    Prefs: {
      get: (key: string) => prefs.get(key),
      set: (key: string, value: unknown) => prefs.set(key, value),
    },
  };
  return run(prefs).finally(restore);
}

const pref = (prefs: Map<string, unknown>, key: string) =>
  prefs.get(`${config.prefsPrefix}.${key}`);

test("settings repair hand-typed choices and keep unknown ones visible", async () => {
  await withPrefs(
    {
      defaultMode: "claude",
      claudePermissionMode: "acceptedits",
      claudeReasoningEffort: "turbo",
      codexReasoningEffort: "High",
      codexSandboxMode: "workspace write",
      codexApprovalMode: "sometimes",
    },
    async (prefs) => {
      const doc = buildPane();
      await registerPrefsScripts({ document: doc } as never);

      assert.equal(pref(prefs, "defaultMode"), "claude_code");
      assert.equal(pref(prefs, "claudePermissionMode"), "acceptEdits");
      assert.equal(pref(prefs, "codexReasoningEffort"), "high");
      assert.equal(pref(prefs, "codexSandboxMode"), "workspace-write");
      assert.equal(doc.get("input-default-mode").value, "claude_code");
      assert.equal(
        doc.get("input-codex-sandbox-mode").value,
        "workspace-write",
      );

      // Unknown text stays saved and shows as its own labelled option.
      assert.equal(pref(prefs, "codexApprovalMode"), "sometimes");
      assert.equal(pref(prefs, "claudeReasoningEffort"), "turbo");
      const approval = doc.get("input-codex-approval-mode");
      const field = getChoicePreferenceField("codexApprovalMode");
      const unknown = approval.children.at(-1);
      assert.ok(unknown);
      assert.equal(approval.children.length, field.options.length + 1);
      assert.equal(unknown.value, "sometimes");
      assert.equal(
        unknown.getAttribute("data-l10n-id"),
        field.unrecognizedL10nId,
      );
      assert.deepEqual(
        JSON.parse(String(unknown.getAttribute("data-l10n-args"))),
        { value: "sometimes" },
      );
      assert.equal(approval.value, "sometimes");

      // Choosing a listed option drops the stale entry.
      approval.value = "never";
      prefs.set(`${config.prefsPrefix}.codexApprovalMode`, "never");
      approval.dispatch("change");
      assert.equal(approval.children.length, field.options.length);

      await registerPrefsScripts({ document: doc } as never);
      assert.equal(approval.listenerCount("change"), 1);
      assert.equal(approval.children.length, field.options.length);
    },
  );
});

test("settings show session history as one choice over the existing prefs", async () => {
  await withPrefs(
    {
      saveDocumentSessions: true,
      privacyStoreLocalHistory: true,
      privacySavePromptsOnly: true,
      privacySaveResponses: true,
    },
    async (prefs) => {
      const doc = buildPane();
      await registerPrefsScripts({ document: doc } as never);
      const radios = doc.get(PREF_PANE_ELEMENT_SUFFIXES.historyMode).children;
      const radio = (mode: string) => {
        const entry = radios.find((candidate) => candidate.value === mode);
        assert.ok(entry, `missing ${mode} radio`);
        return entry;
      };
      assert.deepEqual(
        radios.filter((entry) => entry.checked).map((entry) => entry.value),
        ["prompts-only"],
      );

      for (const entry of radios) entry.checked = entry.value === "full";
      radio("full").dispatch("change");
      assert.equal(pref(prefs, "privacySavePromptsOnly"), false);
      assert.equal(pref(prefs, "privacySaveResponses"), true);
      assert.equal(pref(prefs, "saveDocumentSessions"), true);
      assert.equal(pref(prefs, "privacyStoreLocalHistory"), true);

      for (const entry of radios) entry.checked = entry.value === "disabled";
      radio("disabled").dispatch("change");
      assert.equal(pref(prefs, "saveDocumentSessions"), false);
      assert.equal(pref(prefs, "privacyStoreLocalHistory"), false);
      assert.deepEqual(
        radios.filter((entry) => entry.checked).map((entry) => entry.value),
        ["disabled"],
      );

      await registerPrefsScripts({ document: doc } as never);
      assert.equal(radio("full").listenerCount("change"), 1);
    },
  );
});

test("settings explain adjusted retrieval values and open the advanced group", async () => {
  await withPrefs(
    { retrievalChunkSize: 1200, retrievalOverlapSize: 99_999 },
    async (prefs) => {
      const doc = buildPane();
      await registerPrefsScripts({ document: doc } as never);
      const overlap = doc.get(PREF_PANE_ELEMENT_SUFFIXES.overlapSize);
      const overlapWarning = doc.get(
        PREF_PANE_ELEMENT_SUFFIXES.overlapSizeWarning,
      );
      const chunkWarning = doc.get(PREF_PANE_ELEMENT_SUFFIXES.chunkSizeWarning);

      assert.equal(
        doc.get(PREF_PANE_ELEMENT_SUFFIXES.retrievalAdvanced).open,
        true,
      );
      assert.equal(overlap.max, "600");
      assert.equal(overlap.getAttribute("aria-invalid"), "true");
      assert.equal(overlapWarning.hidden, false);
      assert.equal(
        overlapWarning.getAttribute("data-l10n-id"),
        "pref-retrieval-overlap-size-adjusted",
      );
      assert.deepEqual(
        JSON.parse(String(overlapWarning.getAttribute("data-l10n-args"))),
        { effective: 600, max: 600 },
      );
      assert.equal(chunkWarning.hidden, true);

      prefs.set(`${config.prefsPrefix}.retrievalOverlapSize`, 150);
      overlap.dispatch("synctopreference");
      assert.equal(overlapWarning.hidden, true);
      assert.equal(overlap.getAttribute("aria-invalid"), "false");
    },
  );
});

test("valid retrieval values keep the advanced group collapsed", async () => {
  await withPrefs(
    { retrievalChunkSize: 1200, retrievalOverlapSize: 200 },
    async () => {
      const doc = buildPane();
      await registerPrefsScripts({ document: doc } as never);
      assert.equal(
        doc.get(PREF_PANE_ELEMENT_SUFFIXES.retrievalAdvanced).open,
        false,
      );
      assert.equal(
        doc.get(PREF_PANE_ELEMENT_SUFFIXES.chunkSizeWarning).hidden,
        true,
      );
    },
  );
});

test("settings text comes from Fluent and uses theme-aware colors", () => {
  const messages = new Map<string, string>();
  let current = "";
  for (const line of fluent.split("\n")) {
    const message = line.match(/^([a-z][a-z0-9-]*)\s*=/);
    if (message) {
      current = message[1];
      messages.set(current, line);
    } else if (current && /^\s+\S/.test(line)) {
      messages.set(current, `${messages.get(current)}\n${line}`);
    }
  }
  assert.doesNotMatch(template, /\splaceholder="/);
  assert.doesNotMatch(template, /color:\s*#/i);
  for (const [, id] of template.matchAll(/data-l10n-id="([^"]+)"/g)) {
    assert.ok(messages.has(id), `missing Fluent message ${id}`);
  }
  for (const [input] of template.matchAll(
    /<html:input\s[^>]*type="text"[^>]*>/g,
  )) {
    const id = input.match(/data-l10n-id="([^"]+)"/)?.[1];
    assert.ok(id, `text input without Fluent placeholder: ${input}`);
    assert.match(String(messages.get(id)), /\.placeholder\s*=/);
  }
  assert.match(
    fluent,
    /^pref-codex-web-search = Allow web search when needed$/m,
  );
  for (const id of [
    "pref-retrieval-chunk-size-adjusted",
    "pref-retrieval-overlap-size-adjusted",
  ]) {
    assert.ok(messages.has(id), `missing Fluent message ${id}`);
  }
});

test("retrieval inputs declare the same limits the runtime enforces", () => {
  const input = (suffix: string) =>
    template.match(
      new RegExp(
        `<html:input[^>]*id="zotero-prefpane-__addonRef__-${suffix}"[^>]*>`,
      ),
    )?.[0] ?? "";
  const chunk = input(PREF_PANE_ELEMENT_SUFFIXES.chunkSize);
  assert.match(chunk, new RegExp(`min="${RETRIEVAL_CHUNK_SIZE_MIN}"`));
  assert.match(chunk, new RegExp(`max="${RETRIEVAL_CHUNK_SIZE_MAX}"`));
  const overlap = input(PREF_PANE_ELEMENT_SUFFIXES.overlapSize);
  assert.match(overlap, /min="0"/);
  assert.match(
    overlap,
    new RegExp(`max="${maxOverlapForChunkSize(RETRIEVAL_CHUNK_SIZE_MAX)}"`),
  );
  // Chunk size, overlap, and top-k sit inside the collapsed disclosure.
  const advanced = template.match(
    /<html:details[^>]*-retrieval-advanced"[\s\S]*?<\/html:details>/,
  )?.[0];
  assert.ok(advanced, "missing Advanced retrieval disclosure");
  for (const key of [
    "retrievalChunkSize",
    "retrievalOverlapSize",
    "retrievalTopK",
  ]) {
    assert.match(advanced, new RegExp(`__addonRef__\\.${key}"`));
  }
});
