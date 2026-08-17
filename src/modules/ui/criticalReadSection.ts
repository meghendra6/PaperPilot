import type {
  CriticalReadState,
  CriticalReadStepID,
} from "../criticalRead/types";
import { getCriticalReadStep } from "../criticalRead/workflow";

export interface CriticalReadSectionActions {
  onStart(): void | Promise<void>;
  onRun(readerInput: string): void | Promise<void>;
  onCancel(): void | Promise<void>;
  onRevise(stepID: CriticalReadStepID): void | Promise<void>;
  onSave(): void | Promise<void>;
  onStartMastery(): void | Promise<void>;
}

function appendList(doc: Document, parent: HTMLElement, values: string[]) {
  if (!values.length) return;
  const list = doc.createElement("ul");
  for (const value of values) {
    const item = doc.createElement("li");
    item.textContent = value;
    list.appendChild(item);
  }
  parent.appendChild(list);
}

const READER_CHECKLISTS: Partial<Record<CriticalReadStepID, string[]>> = {
  1: ["Apparent problem", "Evidence shape", "Important figures or tables"],
  2: ["Problem", "Setting", "Assumptions", "Claimed gap"],
  4: [
    "Data provenance and splits",
    "Baselines and comparison fairness",
    "Metrics and research-question fit",
    "Controls, ablations, and sensitivity",
    "Assumptions and threats to validity",
    "Statistical or qualitative evidence",
    "Resources, reproducibility, and evaluated scope",
  ],
  5: [
    "What the evidence supports",
    "What it does not support",
    "Strongest result",
    "Weakest or most ambiguous result",
    "Your confidence",
  ],
  7: [
    "At least one alternative explanation or confounder",
    "What result it could explain",
    "What evidence would distinguish it",
  ],
};

export function renderCriticalReadSection(params: {
  root: HTMLElement;
  state: CriticalReadState;
  actions: CriticalReadSectionActions;
}) {
  const { root, state } = params;
  const doc = root.ownerDocument;
  root.replaceChildren();

  const header = doc.createElement("div");
  header.className = "pp-critical-read__header";
  const title = doc.createElement("strong");
  title.textContent = "Critical Read · 7 steps";
  const progress = doc.createElement("span");
  const completeCount = state.steps.filter(
    (step) => step.status === "complete",
  ).length;
  progress.textContent = `${completeCount}/7`;
  header.append(title, progress);
  root.appendChild(header);

  if (state.phase === "idle") {
    const intro = doc.createElement("p");
    intro.textContent =
      "Build your own judgment first, then use Paper Pilot to check it against the paper.";
    const start = doc.createElement("button");
    start.className = "pp-btn pp-btn--secondary";
    start.textContent = "Start Critical Read";
    start.addEventListener("click", () => void params.actions.onStart());
    root.append(intro, start);
    return;
  }

  const status = doc.createElement("div");
  status.className = "pp-status-text";
  status.textContent = state.status;
  root.appendChild(status);

  if (state.running) {
    const cancel = doc.createElement("button");
    cancel.className = "pp-btn pp-btn--secondary";
    cancel.textContent = "Cancel Critical Read step";
    cancel.addEventListener("click", () => void params.actions.onCancel());
    root.appendChild(cancel);
  }

  for (const step of state.steps) {
    if (step.status !== "complete") continue;
    const details = doc.createElement("details");
    details.className = "pp-critical-read__completed";
    const summary = doc.createElement("summary");
    summary.textContent = `${step.id}. ${step.title}`;
    details.appendChild(summary);
    if (step.readerInput) {
      const reader = doc.createElement("p");
      reader.textContent = `Your assessment: ${step.readerInput}`;
      details.appendChild(reader);
    }
    if (step.output) {
      const synthesis = doc.createElement("p");
      synthesis.textContent = step.output.summary;
      details.appendChild(synthesis);
      appendList(doc, details, step.output.items);
      if (step.output.scanObservations) {
        appendList(doc, details, [
          `Abstract signal: ${step.output.scanObservations.abstractSignal}`,
          ...step.output.scanObservations.figureTableSignals.map(
            (value) => `Figure/table signal: ${value}`,
          ),
          ...step.output.scanObservations.openQuestions.map(
            (value) => `Open question: ${value}`,
          ),
        ]);
      }
      if (step.output.researchQuestion) {
        const question = step.output.researchQuestion;
        appendList(doc, details, [
          `Research question: ${question.question}`,
          `Problem: ${question.problem}`,
          `Setting: ${question.setting}`,
          `Claimed gap: ${question.claimedGap}`,
          `Reader-agent comparison: ${question.readerComparison}`,
        ]);
      }
      appendList(
        doc,
        details,
        (step.output.methodChecks || []).map(
          (check) =>
            `${check.area} — ${check.status}: ${check.finding}${check.sourceLocator ? ` (${check.sourceLocator})` : ""}`,
        ),
      );
      if (step.output.evidenceConclusion) {
        const conclusion = step.output.evidenceConclusion;
        appendList(doc, details, [
          ...conclusion.supports.map((value) => `Evidence supports: ${value}`),
          ...conclusion.doesNotSupport.map(
            (value) => `Evidence does not support: ${value}`,
          ),
          `Strongest result: ${conclusion.strongestResult}`,
          `Weakest result: ${conclusion.weakestResult}`,
          `Reader-agent confidence: ${conclusion.confidence}`,
        ]);
      }
      if (step.output.authorComparison) {
        const comparison = step.output.authorComparison;
        appendList(doc, details, [
          `Author conclusion: ${comparison.authorConclusionStatus}${comparison.unavailableReason ? ` — ${comparison.unavailableReason}` : ""}`,
          ...comparison.agreements.map((value) => `Agreement: ${value}`),
          ...comparison.readerOmissions.map(
            (value) => `Reader omission: ${value}`,
          ),
          ...comparison.strongerAuthorClaims.map(
            (value) => `Stronger author claim: ${value}`,
          ),
          ...comparison.authorCaveats.map((value) => `Author caveat: ${value}`),
          ...comparison.interpretiveDifferences.map(
            (value) => `Interpretive difference: ${value}`,
          ),
        ]);
      }
      if (step.output.methodComparison) {
        appendList(doc, details, [
          ...step.output.methodComparison.agreements.map(
            (value) => `Reader-agent agreement: ${value}`,
          ),
          ...step.output.methodComparison.differences.map(
            (value) => `Reader-agent difference: ${value}`,
          ),
          ...step.output.methodComparison.unresolved.map(
            (value) => `Reader-agent unresolved: ${value}`,
          ),
        ]);
      }
      appendList(
        doc,
        details,
        (step.output.provenance || []).map(
          (entry) =>
            `${entry.source === "paper_claim" ? "Paper claim" : "Agent inference"}: ${entry.text}${entry.sourceLocator ? ` (${entry.sourceLocator})` : ""}`,
        ),
      );
      if (step.output.finalSynthesis) {
        appendList(doc, details, [
          `Strongest supported claim: ${step.output.finalSynthesis.strongestSupportedClaim}`,
          `Key residual uncertainty: ${step.output.finalSynthesis.keyResidualUncertainty}`,
          `Next reading or experiment: ${step.output.finalSynthesis.nextReadingOrExperiment}`,
        ]);
      }
      appendList(
        doc,
        details,
        (step.output.alternatives || []).map(
          (entry) =>
            `Alternative: ${entry.explanation} · could explain ${entry.explainedResult} · test: ${entry.discriminatingExperiment} · addressed: ${entry.addressedByPaper}`,
        ),
      );
    }
    if (step.discovery) {
      const discovery = doc.createElement("p");
      discovery.textContent = `Discovery: ${step.discovery.verifiedMain.length} verified main · ${step.discovery.otherPeerReviewed.length} other peer-reviewed · ${step.discovery.noveltyRadar.length} novelty signals`;
      details.appendChild(discovery);
    }
    const revise = doc.createElement("button");
    revise.className = "pp-btn pp-btn--ghost";
    revise.textContent = "Revise from here";
    revise.disabled = state.running;
    revise.addEventListener(
      "click",
      () => void params.actions.onRevise(step.id),
    );
    details.appendChild(revise);
    root.appendChild(details);
  }

  if (state.phase === "complete") {
    const report = doc.createElement("details");
    report.open = true;
    const reportSummary = doc.createElement("summary");
    reportSummary.textContent = "Critical Read report";
    const pre = doc.createElement("pre");
    pre.className = "pp-critical-read__report";
    pre.textContent = state.reportMarkdown || "Report is ready to save.";
    report.append(reportSummary, pre);
    const save = doc.createElement("button");
    save.className = "pp-btn pp-btn--secondary";
    save.textContent = state.reportNoteItemID
      ? "Saved to Zotero note"
      : "Save report to note";
    save.disabled = Boolean(state.reportNoteItemID);
    save.addEventListener("click", () => void params.actions.onSave());
    const mastery = doc.createElement("button");
    mastery.className = "pp-btn pp-btn--ghost";
    mastery.textContent = "Start Paper Mastery";
    mastery.addEventListener(
      "click",
      () => void params.actions.onStartMastery(),
    );
    root.append(report, save, mastery);
    return;
  }

  const step = getCriticalReadStep(state);
  if (!step) return;
  const card = doc.createElement("div");
  card.className = "pp-critical-read__step";
  const stepTitle = doc.createElement("strong");
  stepTitle.textContent = `${step.id}. ${step.title}`;
  const instruction = doc.createElement("p");
  instruction.textContent = step.instruction;
  card.append(stepTitle, instruction);

  const readerChecklist = READER_CHECKLISTS[step.id];
  if (readerChecklist?.length) {
    const checklistHeading = doc.createElement("strong");
    checklistHeading.textContent = "Your assessment should cover";
    card.appendChild(checklistHeading);
    appendList(doc, card, readerChecklist);
  }

  if (step.orientation) {
    const notice = doc.createElement("div");
    notice.className = "pp-critical-read__orientation";
    notice.textContent = step.orientation.notice;
    card.appendChild(notice);
    if (step.id === 1 && step.orientation.abstract) {
      const abstractHeading = doc.createElement("strong");
      abstractHeading.textContent = "Abstract";
      const abstract = doc.createElement("p");
      abstract.textContent = step.orientation.abstract;
      card.append(abstractHeading, abstract);
    }
    if (step.orientation.sourceLocations.length) {
      const sourceHeading = doc.createElement("strong");
      sourceHeading.textContent = "Relevant source locations";
      card.appendChild(sourceHeading);
      appendList(doc, card, step.orientation.sourceLocations);
    }
    if (step.orientation.captions.length) {
      const captionHeading = doc.createElement("strong");
      captionHeading.textContent = "Figure/table caption index";
      card.appendChild(captionHeading);
      appendList(doc, card, step.orientation.captions);
    }
  }

  let answer: HTMLTextAreaElement | undefined;
  if (step.requiresReaderInput) {
    answer = doc.createElement("textarea");
    answer.className = "pp-critical-read__input";
    answer.placeholder = "Write your independent assessment first…";
    answer.value = step.readerInput || "";
    answer.disabled = state.running;
    card.appendChild(answer);
  }

  const run = doc.createElement("button");
  run.className = "pp-btn pp-btn--primary";
  run.textContent = state.running
    ? "Working…"
    : step.id === 3
      ? "Find and verify prior work"
      : `Run step ${step.id}`;
  const updateRunAvailability = () => {
    run.disabled =
      state.running || (step.requiresReaderInput && !answer?.value.trim());
  };
  updateRunAvailability();
  answer?.addEventListener("input", updateRunAvailability);
  run.addEventListener(
    "click",
    () => void params.actions.onRun(answer?.value || ""),
  );
  card.appendChild(run);
  root.appendChild(card);
}
