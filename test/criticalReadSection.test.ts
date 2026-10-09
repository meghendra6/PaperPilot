import { test } from "node:test";
import * as assert from "node:assert/strict";

import { renderCriticalReadSection } from "../src/modules/ui/criticalReadSection";
import {
  buildInitialCriticalReadState,
  startCriticalRead,
  markCriticalReadStepRunning,
  completeCriticalReadStep,
  reviseCriticalReadStep,
} from "../src/modules/criticalRead/workflow";
import type {
  CriticalReadAgentOutput,
  CriticalReadStepID,
} from "../src/modules/criticalRead/types";

interface FakeElement {
  tagName: string;
  ownerDocument: FakeDocument;
  children: FakeElement[];
  className: string;
  textContent: string;
  innerHTML: string;
  disabled: boolean;
  hidden: boolean;
  value: string;
  placeholder: string;
  open: boolean;
  selectionStart: number;
  selectionEnd: number;
  attributes: Map<string, string>;
  listeners: Map<string, Array<() => void>>;
  appendChild(child: FakeElement): FakeElement;
  append(...nodes: FakeElement[]): void;
  replaceChildren(...nodes: FakeElement[]): void;
  addEventListener(name: string, listener: () => void): void;
  dispatch(name: string): void;
  setAttribute(name: string, value: string): void;
  getAttribute(name: string): string | null;
  focus(): void;
  setSelectionRange(start: number, end: number): void;
}

interface FakeDocument {
  activeElement?: FakeElement;
  createElement(tag: string): FakeElement;
  createDocumentFragment(): FakeElement;
}

function decodeEntities(value: string) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

function createFakeDocument(): FakeDocument {
  const doc: FakeDocument = {
    createElement(tag: string) {
      let html = "";
      const element: FakeElement = {
        tagName: tag.toUpperCase(),
        ownerDocument: doc,
        children: [],
        className: "",
        textContent: "",
        get innerHTML() {
          return html;
        },
        set innerHTML(value: string) {
          html = value;
          element.textContent = decodeEntities(value.replace(/<[^>]+>/g, ""));
        },
        disabled: false,
        hidden: false,
        value: "",
        placeholder: "",
        open: false,
        selectionStart: 0,
        selectionEnd: 0,
        attributes: new Map(),
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
        addEventListener(name, listener) {
          element.listeners.set(name, [
            ...(element.listeners.get(name) ?? []),
            listener,
          ]);
        },
        dispatch(name) {
          for (const listener of element.listeners.get(name) ?? []) listener();
        },
        setAttribute(name, value) {
          element.attributes.set(name, value);
        },
        getAttribute(name) {
          return element.attributes.get(name) ?? null;
        },
        focus() {
          doc.activeElement = element;
        },
        setSelectionRange(start, end) {
          element.selectionStart = start;
          element.selectionEnd = end;
        },
      };
      return element;
    },
    createDocumentFragment() {
      return doc.createElement("#fragment");
    },
  };
  return doc;
}

function collectText(element: FakeElement): string {
  return [element.textContent, ...element.children.map(collectText)]
    .filter(Boolean)
    .join("\n");
}

function output(
  overrides: Partial<CriticalReadAgentOutput>,
): CriticalReadAgentOutput {
  return {
    summary: "Step summary.",
    items: ["Step item"],
    sourceLocators: ["p. 1"],
    limitations: [],
    ...overrides,
  };
}

test("completed Critical Read cards render every typed output surface", () => {
  const typedOutputs: Partial<
    Record<CriticalReadStepID, Partial<CriticalReadAgentOutput>>
  > = {
    1: {
      scanObservations: {
        abstractSignal: "Strong abstract claim",
        figureTableSignals: ["Figure 2 carries the main effect"],
        openQuestions: ["What baseline is used?"],
      },
    },
    2: {
      researchQuestion: {
        question: "Does X improve Y?",
        problem: "Y degrades under shift",
        setting: "benchmark Z",
        claimedGap: "no prior X under shift",
        readerComparison: "Reader framed the same gap",
      },
    },
    4: {
      methodChecks: [
        {
          areaCode: "baselines",
          area: "Baselines",
          status: "supported",
          finding: "Fair baseline set",
          sourceLocator: "Sec 4",
        },
      ],
    },
    5: {
      evidenceConclusion: {
        supports: ["X improves Y on Z"],
        doesNotSupport: ["Generalization beyond Z"],
        strongestResult: "Table 1 main effect",
        weakestResult: "Ablation variance",
        confidence: "medium",
      },
    },
    6: {
      authorComparison: {
        authorConclusionStatus: "available",
        agreements: ["Main effect holds"],
        readerOmissions: ["Missed dataset shift"],
        strongerAuthorClaims: ["Broad generality"],
        authorCaveats: ["Limited compute"],
        interpretiveDifferences: ["Scope of claims"],
      },
    },
    7: {
      finalSynthesis: {
        strongestSupportedClaim: "X improves Y on Z",
        keyResidualUncertainty: "External validity",
        nextReadingOrExperiment: "Replicate on W",
      },
      alternatives: [
        {
          explanation: "Data leakage",
          explainedResult: "Table 1",
          challengedAssumption: "Clean split",
          discriminatingExperiment: "Dedup test",
          addressedByPaper: "partly",
        },
      ],
    },
  };
  const initial = buildInitialCriticalReadState();
  const state = {
    ...initial,
    phase: "complete" as const,
    running: false,
    currentStep: 7 as CriticalReadStepID,
    reportMarkdown: "# Report",
    steps: initial.steps.map((step) => ({
      ...step,
      status: "complete" as const,
      readerInput: step.requiresReaderInput ? "Reader assessment" : undefined,
      output: output(typedOutputs[step.id] || {}),
    })),
  };
  const doc = createFakeDocument();
  const root = doc.createElement("div");
  renderCriticalReadSection({
    root: root as unknown as HTMLElement,
    state,
    actions: {
      onStart() {},
      onRun() {},
      onCancel() {},
      onRevise() {},
      onSave() {},
      onStartMastery() {},
    },
  });
  const text = collectText(root);
  for (const expected of [
    "Abstract signal: Strong abstract claim",
    "Open question: What baseline is used?",
    "Research question: Does X improve Y?",
    "Claimed gap: no prior X under shift",
    "Baselines — supported: Fair baseline set (Sec 4)",
    "Evidence supports: X improves Y on Z",
    "Evidence does not support: Generalization beyond Z",
    "Weakest result: Ablation variance",
    "Reader-agent confidence: medium",
    "Author conclusion: available",
    "Reader omission: Missed dataset shift",
    "Author caveat: Limited compute",
    "Strongest supported claim: X improves Y on Z",
    "Key residual uncertainty: External validity",
    "Next reading or experiment: Replicate on W",
    "Alternative: Data leakage · could explain Table 1 · test: Dedup test · addressed: partly",
  ]) {
    assert.ok(text.includes(expected), `missing rendered output: ${expected}`);
  }
  for (const [responseLanguage, expected] of [
    [
      "Korean",
      [
        "초록에서 파악한 내용: Strong abstract claim",
        "AI가 평가한 확신 수준: 보통",
        "저자 결론: 확인 가능",
        "논문에서 다룬 정도: 일부",
        "Save report to note",
        "Revise from here",
      ],
    ],
    [
      "Chinese",
      [
        "摘要线索: Strong abstract claim",
        "AI 评估的置信程度: 中",
        "作者结论: 可获取",
        "论文涉及程度: 部分",
        "Save report to note",
        "Revise from here",
      ],
    ],
  ] as const) {
    renderCriticalReadSection({
      root: root as unknown as HTMLElement,
      state,
      actions,
      responseLanguage,
    });
    const translated = collectText(root);
    for (const label of expected)
      assert.ok(
        translated.includes(label),
        `missing localized label: ${label}`,
      );
    for (const original of [
      "Data leakage",
      "Dedup test",
      "X improves Y on Z",
      "Fair baseline set",
      "Reader assessment",
      "Sec 4",
    ])
      assert.ok(
        translated.includes(original),
        `lost original content: ${original}`,
      );
  }
});

const actions = {
  onStart() {},
  onRun(_input: string) {},
  onCancel() {},
  onRevise() {},
  onSave() {},
  onStartMastery() {},
};

function descendants(element: FakeElement): FakeElement[] {
  return [element, ...element.children.flatMap(descendants)];
}

for (const [language, header, instruction, checklist, run] of [
  [
    "Korean",
    "Critical Read · 7단계",
    "먼저 훑어보세요.",
    "다음 내용을 포함해 평가하세요",
    "Run step 1",
  ],
  [
    "Chinese",
    "Critical Read · 7 个步骤",
    "先浏览一遍。",
    "你的评估应涵盖",
    "Run step 1",
  ],
  [
    "English",
    "Critical Read · 7 steps",
    "Skim first.",
    "Your assessment should cover",
    "Run step 1",
  ],
]) {
  test(`${language} renders the actual Step 1 guidance and preserves original paper text`, () => {
    const state = startCriticalRead(buildInitialCriticalReadState());
    state.steps[0].orientation = {
      extractionMode: "caption-text",
      notice:
        "Caption index extracted from paper text. Paper Pilot has not visually inspected the figure pixels in this step.",
      abstract: "Abstract: An English paper about decoding.",
      sourceLocations: ["Fig. 1, p. 3"],
      captions: ["Figure 1. An original English caption."],
    };
    const before = JSON.stringify(state);
    const root = createFakeDocument().createElement("div");
    renderCriticalReadSection({
      root: root as unknown as HTMLElement,
      state,
      actions,
      responseLanguage: language,
    });
    const text = collectText(root);
    const abstract = state.steps[0].orientation.abstract;
    assert.ok(abstract);
    for (const expected of [
      header,
      instruction,
      checklist,
      run,
      "0/7",
      abstract,
      ...state.steps[0].orientation.captions,
    ]) {
      assert.ok(text.includes(expected), `missing ${expected}`);
    }
    const input = descendants(root).find(
      (element) => element.tagName === "TEXTAREA",
    );
    assert.ok(input);
    const button = descendants(root).find(
      (element) => element.textContent === run,
    );
    assert.ok(button);
    assert.equal(input.value, "");
    assert.equal(
      button.disabled,
      true,
      "localization must preserve the reader-first input gate",
    );
    if (language !== "English") {
      assert.doesNotMatch(
        text,
        /Step 1 is ready|Survey abstract|Skim first|Your assessment should cover|Caption index extracted/,
      );
      assert.notEqual(
        input.placeholder,
        "Write your independent assessment first…",
      );
    }
    assert.equal(
      JSON.stringify(state),
      before,
      "rendering must not rewrite saved workflow or source data",
    );
  });
}

for (const language of ["Korean", "Chinese"]) {
  test(`${language} localizes all seven current and completed step titles`, () => {
    const initial = startCriticalRead(buildInitialCriticalReadState());
    const root = createFakeDocument().createElement("div");
    for (const step of initial.steps) {
      const state = {
        ...initial,
        currentStep: step.id,
        steps: initial.steps.map((entry) => ({
          ...entry,
          status:
            entry.id < step.id ? ("complete" as const) : ("ready" as const),
        })),
      };
      renderCriticalReadSection({
        root: root as unknown as HTMLElement,
        state,
        actions,
        responseLanguage: language,
      });
      const text = collectText(root);
      assert.ok(text.includes(`${step.id - 1}/7`));
      for (const previous of state.steps.filter((entry) => entry.id <= step.id))
        assert.ok(!text.includes(previous.title));
      assert.ok(!text.includes(step.instruction));
      const input = descendants(root).find(
        (element) => element.tagName === "TEXTAREA",
      );
      assert.equal(Boolean(input), step.requiresReaderInput);
    }
  });
}

test("changing display language preserves an unsent assessment and regenerates report labels from restored data", () => {
  const state = startCriticalRead(buildInitialCriticalReadState());
  const root = createFakeDocument().createElement("div");
  const draft =
    "My independent assessment with {step} and English technical terms.";
  for (const responseLanguage of ["Korean", "Chinese", "English"]) {
    renderCriticalReadSection({
      root: root as unknown as HTMLElement,
      state,
      actions,
      responseLanguage,
      readerInput: draft,
    });
    assert.equal(
      descendants(root).find((element) => element.tagName === "TEXTAREA")
        ?.value,
      draft,
    );
    assert.equal(
      descendants(root).find(
        (element) => element.className === "pp-btn pp-btn--primary",
      )?.disabled,
      false,
    );
    assert.equal(state.steps[0].readerInput, undefined);
  }
  const complete = {
    ...state,
    phase: "complete" as const,
    reportMarkdown: "# Stale English report",
    steps: state.steps.map((step) => ({
      ...step,
      status: "complete" as const,
      readerInput: draft,
      output: output({}),
    })),
  };
  renderCriticalReadSection({
    root: root as unknown as HTMLElement,
    state: complete,
    actions,
    responseLanguage: "Korean",
    paperTitle: "Original English Title",
  });
  const text = collectText(root);
  assert.match(text, /Critical Read 보고서/);
  assert.match(text, /Critical Read: Original English Title/);
  assert.ok(
    descendants(root).some(
      (element) =>
        element.tagName === "H1" &&
        element.textContent.includes("Original English Title"),
    ),
    "the report renders Markdown headings instead of raw text",
  );
  assert.match(text, /독자의 평가/);
  assert.match(text, /Step summary\./);
  assert.ok(text.includes(draft));
  assert.doesNotMatch(text, /Stale English report/);
  assert.equal(complete.reportMarkdown, "# Stale English report");
});

test("Korean status follows running, completion, and revision without changing progress", () => {
  let state = startCriticalRead(buildInitialCriticalReadState());
  const root = createFakeDocument().createElement("div");
  state = markCriticalReadStepRunning(state, "My assessment");
  renderCriticalReadSection({
    root: root as unknown as HTMLElement,
    state,
    actions,
    responseLanguage: "Korean",
  });
  assert.match(collectText(root), /1단계 실행 중: 초록·그림·표 훑어보기/);
  assert.match(collectText(root), /Cancel Critical Read step/);
  assert.equal(
    descendants(root).find((element) => element.tagName === "TEXTAREA")
      ?.disabled,
    true,
  );
  state = completeCriticalReadStep({ state, output: output({}) });
  renderCriticalReadSection({
    root: root as unknown as HTMLElement,
    state,
    actions,
    responseLanguage: "Korean",
  });
  assert.match(
    collectText(root),
    /1단계를 완료했습니다. 2단계가 준비되었습니다./,
  );
  assert.match(collectText(root), /1\/7/);
  state = reviseCriticalReadStep(state, 1);
  renderCriticalReadSection({
    root: root as unknown as HTMLElement,
    state,
    actions,
    responseLanguage: "Korean",
  });
  assert.match(collectText(root), /1단계를 다시 열었습니다/);
  assert.match(collectText(root), /0\/7/);
});

function stepTwoState() {
  const started = startCriticalRead(buildInitialCriticalReadState());
  const running = markCriticalReadStepRunning(started, "Step one notes");
  return completeCriticalReadStep({
    state: running,
    output: output({
      provenance: [
        {
          source: "paper_claim",
          text: "The paper claims X.",
          sourceLocator: "p. 2",
        },
        { source: "agent_inference", text: "Paper Pilot infers Y." },
      ],
    }),
  });
}

function byClass(root: FakeElement, className: string) {
  return descendants(root).filter((element) =>
    element.className.split(" ").includes(className),
  );
}

test("an unsent assessment and expanded steps survive a status rebuild", () => {
  const doc = createFakeDocument();
  const root = doc.createElement("div");
  const drafts: Array<[CriticalReadStepID, string]> = [];
  const toggles: Array<[CriticalReadStepID, boolean]> = [];
  const viewActions = {
    ...actions,
    onDraftChange: (stepID: CriticalReadStepID, text: string) =>
      drafts.push([stepID, text]),
    onToggleStep: (stepID: CriticalReadStepID, expanded: boolean) =>
      toggles.push([stepID, expanded]),
  };
  const state = stepTwoState();
  renderCriticalReadSection({
    root: root as unknown as HTMLElement,
    state,
    actions: viewActions,
  });
  const input = descendants(root).find((node) => node.tagName === "TEXTAREA");
  assert.ok(input);
  input.value = "Half-written step two";
  input.dispatch("input");
  assert.deepEqual(drafts, [[2, "Half-written step two"]]);

  const completed = byClass(root, "pp-critical-read__completed")[0];
  completed.open = true;
  completed.dispatch("toggle");
  assert.deepEqual(toggles, [[1, true]]);

  renderCriticalReadSection({
    root: root as unknown as HTMLElement,
    state: { ...state, status: "Searching scholarly sources" },
    actions: viewActions,
    readerInput: drafts[drafts.length - 1][1],
    expandedStepIDs: [1],
  });
  assert.equal(
    descendants(root).find((node) => node.tagName === "TEXTAREA")?.value,
    "Half-written step two",
  );
  assert.equal(byClass(root, "pp-critical-read__completed")[0].open, true);
});

test("a rebuild returns focus and caret to the assessment being typed", () => {
  const doc = createFakeDocument();
  const root = doc.createElement("div");
  const state = stepTwoState();
  const render = (readerInput?: string) =>
    renderCriticalReadSection({
      root: root as unknown as HTMLElement,
      state,
      actions,
      readerInput,
    });
  render("abcdef");
  const first = descendants(root).find((node) => node.tagName === "TEXTAREA");
  assert.ok(first);
  first.focus();
  first.setSelectionRange(2, 4);
  render("abcdef");
  const second = descendants(root).find((node) => node.tagName === "TEXTAREA");
  assert.ok(second);
  assert.notEqual(second, first);
  assert.equal(doc.activeElement, second);
  assert.deepEqual([second.selectionStart, second.selectionEnd], [2, 4]);

  doc.activeElement = undefined;
  render();
  assert.equal(doc.activeElement, undefined, "focus is never stolen");
});

test("the status line is one polite live region reused across rebuilds", () => {
  const root = createFakeDocument().createElement("div");
  const state = stepTwoState();
  renderCriticalReadSection({
    root: root as unknown as HTMLElement,
    state,
    actions,
  });
  const status = byClass(root, "pp-critical-read__status")[0];
  assert.equal(status.getAttribute("role"), "status");
  assert.equal(status.getAttribute("aria-live"), "polite");
  renderCriticalReadSection({
    root: root as unknown as HTMLElement,
    state: { ...state, status: "Preparing results" },
    actions,
  });
  assert.equal(byClass(root, "pp-critical-read__status")[0], status);
  assert.equal(status.textContent, "Preparing results");
  assert.equal(byClass(root, "pp-critical-read__status").length, 1);
});

test("completed steps keep reader judgment, paper claims, and Paper Pilot inference in labelled blocks", () => {
  const root = createFakeDocument().createElement("div");
  const render = (responseLanguage?: string) =>
    renderCriticalReadSection({
      root: root as unknown as HTMLElement,
      state: stepTwoState(),
      actions,
      responseLanguage,
    });
  const block = (kind: string) =>
    collectText(byClass(root, `pp-critical-read__block--${kind}`)[0]);
  render();
  assert.match(block("reader"), /^Your assessment\nStep one notes$/);
  assert.match(
    block("paper"),
    /^Paper claims\nThe paper claims X\. \(p\. 2\)$/,
  );
  assert.match(block("agent"), /^Paper Pilot inference\nStep summary\./);
  assert.match(block("agent"), /Paper Pilot infers Y\./);
  assert.doesNotMatch(block("agent"), /The paper claims X/);
  for (const kind of ["reader", "paper", "agent"]) {
    const node = byClass(root, `pp-critical-read__block--${kind}`)[0];
    assert.equal(node.getAttribute("role"), "group");
    assert.ok(node.getAttribute("aria-label"));
  }
  render("Korean");
  assert.match(block("agent"), /^Paper Pilot의 추론/);
  assert.match(block("paper"), /^논문의 주장/);
});
