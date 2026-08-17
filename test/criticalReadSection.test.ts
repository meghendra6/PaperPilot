import { test } from "node:test";
import * as assert from "node:assert/strict";

import { renderCriticalReadSection } from "../src/modules/ui/criticalReadSection";
import { buildInitialCriticalReadState } from "../src/modules/criticalRead/workflow";
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
  disabled: boolean;
  value: string;
  placeholder: string;
  open: boolean;
  appendChild(child: FakeElement): FakeElement;
  append(...nodes: FakeElement[]): void;
  replaceChildren(): void;
  addEventListener(name: string, listener: (...args: unknown[]) => void): void;
}

interface FakeDocument {
  createElement(tag: string): FakeElement;
}

function createFakeDocument(): FakeDocument {
  const doc: FakeDocument = {
    createElement(tag: string) {
      const element: FakeElement = {
        tagName: tag.toUpperCase(),
        ownerDocument: doc,
        children: [],
        className: "",
        textContent: "",
        disabled: false,
        value: "",
        placeholder: "",
        open: false,
        appendChild(child) {
          element.children.push(child);
          return child;
        },
        append(...nodes) {
          element.children.push(...nodes);
        },
        replaceChildren() {
          element.children = [];
        },
        addEventListener() {},
      };
      return element;
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
});
