import { renderMarkdownFragment } from "../components/markdownRenderer";
import {
  createCriticalReadLocalizer,
  getCriticalReadStepCopy,
  localizeCriticalReadStaleReason,
  localizeCriticalReadStatus,
} from "../criticalRead/localization";
import { buildCriticalReadReportMarkdown } from "../criticalRead/report";
import type {
  CriticalReadState,
  CriticalReadStepID,
  CriticalReadStepState,
} from "../criticalRead/types";
import { getCriticalReadStep } from "../criticalRead/workflow";

export interface CriticalReadSectionActions {
  onStart(): void | Promise<void>;
  onRun(readerInput: string): void | Promise<void>;
  onCancel(): void | Promise<void>;
  onRevise(stepID: CriticalReadStepID): void | Promise<void>;
  onSave(): void | Promise<void>;
  onStartMastery(): void | Promise<void>;
  /** Receives every edit of the current step's unsent assessment. */
  onDraftChange?(stepID: CriticalReadStepID, text: string): void;
  /** Receives the open state of a completed step after the reader toggles it. */
  onToggleStep?(stepID: CriticalReadStepID, expanded: boolean): void;
}

type Localize = ReturnType<typeof createCriticalReadLocalizer>;
type BlockKind = "reader" | "paper" | "agent" | "external";

/**
 * Stable header and status nodes. Rebuilding only the body keeps the polite
 * live region in place, so status changes are announced without re-reading
 * the whole section.
 */
interface SectionShell {
  title: HTMLElement;
  progress: HTMLElement;
  status: HTMLElement;
  body: HTMLElement;
  input?: HTMLTextAreaElement;
}

const shells = new WeakMap<HTMLElement, SectionShell>();

function ensureShell(root: HTMLElement): SectionShell {
  const existing = shells.get(root);
  if (existing && Array.from(root.children).includes(existing.body)) {
    return existing;
  }
  const doc = root.ownerDocument;
  const header = doc.createElement("div");
  header.className = "pp-critical-read__header";
  const title = doc.createElement("strong");
  const progress = doc.createElement("span");
  header.append(title, progress);
  const status = doc.createElement("div");
  status.className = "pp-status-text pp-critical-read__status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const body = doc.createElement("div");
  body.className = "pp-critical-read__body";
  root.replaceChildren(header, status, body);
  const shell = { title, progress, status, body };
  shells.set(root, shell);
  return shell;
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

function appendLabelledList(
  doc: Document,
  parent: HTMLElement,
  label: string,
  values: string[],
) {
  if (!values.length) return;
  const heading = doc.createElement("p");
  heading.className = "pp-critical-read__sublabel";
  heading.textContent = label;
  parent.appendChild(heading);
  appendList(doc, parent, values);
}

/** Marks a control so a rebuild can return keyboard focus to it. */
function markControl<T extends HTMLElement>(element: T, key: string): T {
  element.setAttribute("data-cr-control", key);
  return element;
}

function findControl(node: HTMLElement, key: string): HTMLElement | undefined {
  for (const child of Array.from(node.children ?? []) as HTMLElement[]) {
    if (child.getAttribute?.("data-cr-control") === key) return child;
    const nested = findControl(child, key);
    if (nested) return nested;
  }
  return undefined;
}

function focusedControlKey(doc: Document, body: HTMLElement) {
  let node = doc.activeElement as HTMLElement | null | undefined;
  for (let depth = 0; node && depth < 4; depth += 1) {
    const key = node.getAttribute?.("data-cr-control");
    if (key) return findControl(body, key) === node ? key : undefined;
    node = node.parentElement;
  }
  return undefined;
}

/**
 * Returns focus to the rebuilt control. A Run button that turned into a
 * disabled "Working…" hands focus to Cancel.
 */
function restoreControlFocus(body: HTMLElement, key: string) {
  let target = findControl(body, key);
  if (key === "run" && (!target || (target as HTMLButtonElement).disabled))
    target = findControl(body, "cancel") ?? target;
  if (key === "cancel" && !target) target = findControl(body, "run");
  if (target && !(target as HTMLButtonElement).disabled) target.focus();
}

/** False only when Zotero reports the saved report note as gone. */
function reportNoteExists(noteID: number) {
  const items = (
    globalThis as {
      Zotero?: { Items?: { get?: (id: number) => unknown } };
    }
  ).Zotero?.Items;
  if (!items?.get) return true;
  const note = items.get(noteID) as { deleted?: boolean } | false | undefined;
  return Boolean(note) && !(note as { deleted?: boolean }).deleted;
}

function appendBlock(
  doc: Document,
  parent: HTMLElement,
  kind: BlockKind,
  label: string,
) {
  const block = doc.createElement("div");
  block.className = `pp-critical-read__block pp-critical-read__block--${kind}`;
  block.setAttribute("role", "group");
  block.setAttribute("aria-label", label);
  const heading = doc.createElement("strong");
  heading.className = "pp-critical-read__label";
  heading.textContent = label;
  block.appendChild(heading);
  parent.appendChild(block);
  return block;
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

function withLocator(text: string, locator?: string) {
  return `${text}${locator ? ` (${locator})` : ""}`;
}

/** Typed Paper Pilot output lines, in the order the workflow produces them. */
function agentOutputLines(
  output: NonNullable<CriticalReadStepState["output"]>,
  t: Localize,
): string[][] {
  const lines: string[][] = [output.items];
  if (output.scanObservations) {
    const scan = output.scanObservations;
    lines.push([
      `${t("Abstract signal")}: ${scan.abstractSignal}`,
      ...scan.figureTableSignals.map(
        (value) => `${t("Figure/table signal")}: ${value}`,
      ),
      ...scan.openQuestions.map((value) => `${t("Open question")}: ${value}`),
    ]);
  }
  if (output.researchQuestion) {
    const question = output.researchQuestion;
    lines.push([
      `${t("Research question")}: ${question.question}`,
      `${t("Problem")}: ${question.problem}`,
      `${t("Setting")}: ${question.setting}`,
      `${t("Claimed gap")}: ${question.claimedGap}`,
      `${t("Reader-agent comparison")}: ${question.readerComparison}`,
    ]);
  }
  lines.push(
    (output.methodChecks || []).map((check) =>
      withLocator(
        `${check.area} — ${t(check.status)}: ${check.finding}`,
        check.sourceLocator,
      ),
    ),
  );
  if (output.evidenceConclusion) {
    const conclusion = output.evidenceConclusion;
    lines.push([
      ...conclusion.supports.map(
        (value) => `${t("Evidence supports")}: ${value}`,
      ),
      ...conclusion.doesNotSupport.map(
        (value) => `${t("Evidence does not support")}: ${value}`,
      ),
      `${t("Strongest result")}: ${conclusion.strongestResult}`,
      `${t("Weakest result")}: ${conclusion.weakestResult}`,
      `${t("Reader-agent confidence")}: ${t(conclusion.confidence)}`,
    ]);
  }
  if (output.authorComparison) {
    const comparison = output.authorComparison;
    lines.push([
      `${t("Author conclusion")}: ${t(comparison.authorConclusionStatus)}${comparison.unavailableReason ? ` — ${comparison.unavailableReason}` : ""}`,
      ...comparison.agreements.map((value) => `${t("Agreement")}: ${value}`),
      ...comparison.readerOmissions.map(
        (value) => `${t("Reader omission")}: ${value}`,
      ),
      ...comparison.strongerAuthorClaims.map(
        (value) => `${t("Stronger author claim")}: ${value}`,
      ),
      ...comparison.authorCaveats.map(
        (value) => `${t("Author caveat")}: ${value}`,
      ),
      ...comparison.interpretiveDifferences.map(
        (value) => `${t("Interpretive difference")}: ${value}`,
      ),
    ]);
  }
  if (output.methodComparison) {
    lines.push([
      ...output.methodComparison.agreements.map(
        (value) => `${t("Reader-agent agreement")}: ${value}`,
      ),
      ...output.methodComparison.differences.map(
        (value) => `${t("Reader-agent difference")}: ${value}`,
      ),
      ...output.methodComparison.unresolved.map(
        (value) => `${t("Reader-agent unresolved")}: ${value}`,
      ),
    ]);
  }
  lines.push(
    (output.provenance || [])
      .filter((entry) => entry.source === "agent_inference")
      .map((entry) => withLocator(entry.text, entry.sourceLocator)),
  );
  if (output.finalSynthesis) {
    lines.push([
      `${t("Strongest supported claim")}: ${output.finalSynthesis.strongestSupportedClaim}`,
      `${t("Key residual uncertainty")}: ${output.finalSynthesis.keyResidualUncertainty}`,
      `${t("Next reading or experiment")}: ${output.finalSynthesis.nextReadingOrExperiment}`,
    ]);
  }
  lines.push(
    (output.alternatives || []).map((entry) =>
      withLocator(
        `${t("Alternative")}: ${entry.explanation} · ${t("could explain")} ${entry.explainedResult} · ${t("test")}: ${entry.discriminatingExperiment} · ${t("addressed")}: ${t(entry.addressedByPaper)} · ${t("Challenges")}: ${entry.challengedAssumption}`,
        entry.sourceLocator,
      ),
    ),
  );
  return lines;
}

function renderCompletedStep(params: {
  doc: Document;
  step: CriticalReadStepState;
  state: CriticalReadState;
  t: Localize;
  responseLanguage?: unknown;
  expanded: boolean;
  actions: CriticalReadSectionActions;
}) {
  const { doc, step, t } = params;
  const details = doc.createElement("details");
  details.className = "pp-critical-read__completed";
  details.open = params.expanded;
  details.addEventListener("toggle", () =>
    params.actions.onToggleStep?.(step.id, details.open),
  );
  const summary = markControl(
    doc.createElement("summary"),
    `summary-${step.id}`,
  );
  summary.textContent = `${step.id}. ${getCriticalReadStepCopy(step.id, params.responseLanguage).title}`;
  details.appendChild(summary);
  if (step.readerInput) {
    const reader = appendBlock(doc, details, "reader", t("Your assessment"));
    const text = doc.createElement("p");
    text.textContent = step.readerInput;
    reader.appendChild(text);
  }
  const paperClaims = (step.output?.provenance || []).filter(
    (entry) => entry.source === "paper_claim",
  );
  if (paperClaims.length) {
    const paper = appendBlock(doc, details, "paper", t("Paper claims"));
    appendList(
      doc,
      paper,
      paperClaims.map((entry) => withLocator(entry.text, entry.sourceLocator)),
    );
  }
  if (step.output) {
    const agent = appendBlock(
      doc,
      details,
      "agent",
      t("Paper Pilot inference"),
    );
    const synthesis = doc.createElement("p");
    synthesis.textContent = step.output.summary;
    agent.appendChild(synthesis);
    for (const lines of agentOutputLines(step.output, t)) {
      appendList(doc, agent, lines);
    }
    appendLabelledList(
      doc,
      agent,
      t("Source locations"),
      step.output.sourceLocators ?? [],
    );
    appendLabelledList(
      doc,
      agent,
      t("Limits and uncertainty"),
      step.output.limitations ?? [],
    );
  }
  if (step.discovery) {
    const external = appendBlock(doc, details, "external", t("Discovery map"));
    const discovery = doc.createElement("p");
    discovery.textContent = t(
      "Discovery: {main} verified main · {other} other peer-reviewed · {novelty} novelty signals",
      {
        main: step.discovery.verifiedMain.length,
        other: step.discovery.otherPeerReviewed.length,
        novelty: step.discovery.noveltyRadar.length,
      },
    );
    external.appendChild(discovery);
  }
  const revise = markControl(doc.createElement("button"), `revise-${step.id}`);
  revise.className = "pp-btn pp-btn--ghost";
  revise.textContent = "Revise from here";
  revise.disabled = params.state.running;
  if (params.state.running) {
    revise.title = "Cancel the running step before revising.";
  }
  revise.addEventListener("click", () => void params.actions.onRevise(step.id));
  details.appendChild(revise);
  return details;
}

function renderReport(params: {
  doc: Document;
  state: CriticalReadState;
  t: Localize;
  paperTitle?: string;
  responseLanguage?: unknown;
}) {
  const { doc, t } = params;
  const report = doc.createElement("details");
  report.open = true;
  const reportSummary = doc.createElement("summary");
  reportSummary.textContent = t("Critical Read report");
  const content = doc.createElement("div");
  content.className = "pp-critical-read__report";
  content.appendChild(
    renderMarkdownFragment(
      buildCriticalReadReportMarkdown({
        state: params.state,
        paperTitle: params.paperTitle || t("Current paper"),
        responseLanguage: params.responseLanguage,
      }),
      doc,
    ),
  );
  report.append(reportSummary, content);
  return report;
}

export function renderCriticalReadSection(
  params: Parameters<typeof renderCriticalReadBody>[0],
) {
  const shell = ensureShell(params.root);
  const focusedKey = focusedControlKey(params.root.ownerDocument, shell.body);
  renderCriticalReadBody(params);
  if (focusedKey) restoreControlFocus(shell.body, focusedKey);
}

function renderCriticalReadBody(params: {
  root: HTMLElement;
  state: CriticalReadState;
  actions: CriticalReadSectionActions;
  responseLanguage?: unknown;
  paperTitle?: string;
  /** Unsent assessment for the current step; falls back to saved input. */
  readerInput?: string;
  /** Completed steps the reader left open before this rebuild. */
  expandedStepIDs?: readonly CriticalReadStepID[];
  /** The paper is being read before the first step. */
  preparing?: boolean;
  /** The report is being written to a Zotero note. */
  saving?: boolean;
  /** Why another run holds this paper's engine, if one does. */
  busyReason?: string;
  /** Why Step 3's prior-work search cannot run with this engine, if so. */
  discoveryUnavailableReason?: string;
}) {
  const { root, state } = params;
  const doc = root.ownerDocument;
  const t = createCriticalReadLocalizer(params.responseLanguage);
  const shell = ensureShell(root);
  const previousInput = shell.input;
  const selection =
    previousInput && doc.activeElement === previousInput
      ? [previousInput.selectionStart, previousInput.selectionEnd]
      : undefined;
  shell.input = undefined;
  shell.body.replaceChildren();
  const body = shell.body;

  shell.title.textContent = t("Critical Read · 7 steps");
  const completeCount = state.steps.filter(
    (step) => step.status === "complete",
  ).length;
  shell.progress.textContent = `${completeCount}/7`;

  if (state.phase === "idle") {
    shell.status.hidden = true;
    shell.status.textContent = "";
    const intro = doc.createElement("p");
    intro.textContent = t(
      "Build your own judgment first, then use Paper Pilot to check it against the paper.",
    );
    const start = markControl(doc.createElement("button"), "start");
    start.className = "pp-btn pp-btn--secondary";
    // Reading the paper can take a while on first use.
    start.textContent = params.preparing
      ? "Preparing paper…"
      : "Start Critical Read";
    start.disabled = Boolean(params.preparing);
    start.addEventListener("click", () => void params.actions.onStart());
    body.append(intro, start);
    return;
  }

  shell.status.hidden = false;
  // Rewriting an unchanged live region would announce it again.
  const statusText = localizeCriticalReadStatus(
    state.status,
    params.responseLanguage,
  );
  if (shell.status.textContent !== statusText)
    shell.status.textContent = statusText;

  const makeCancel = () => {
    const cancel = markControl(doc.createElement("button"), "cancel");
    cancel.className = "pp-btn pp-btn--secondary";
    cancel.textContent = "Cancel Critical Read step";
    cancel.addEventListener("click", () => void params.actions.onCancel());
    return cancel;
  };
  // Cancel sits next to the running step's "Working…" button. Only a run
  // without a current step card keeps it at the top.
  const currentStep =
    state.phase === "complete" ? undefined : getCriticalReadStep(state);
  if (state.running && !currentStep) body.appendChild(makeCancel());

  const expanded = new Set(params.expandedStepIDs ?? []);
  for (const step of state.steps) {
    if (step.status !== "complete") continue;
    body.appendChild(
      renderCompletedStep({
        doc,
        step,
        state,
        t,
        responseLanguage: params.responseLanguage,
        expanded: expanded.has(step.id),
        actions: params.actions,
      }),
    );
  }

  if (state.phase === "complete") {
    const save = markControl(doc.createElement("button"), "save");
    save.className = "pp-btn pp-btn--secondary";
    const savedNote = Boolean(
      state.reportNoteItemID && reportNoteExists(state.reportNoteItemID),
    );
    // A new note follows the current response language, so a saved report
    // can be saved again, and a deleted note no longer blocks saving.
    save.textContent = params.saving
      ? "Saving…"
      : savedNote
        ? "Saved to Zotero note · Save another copy"
        : "Save report to note";
    save.disabled = Boolean(params.saving);
    save.addEventListener("click", () => void params.actions.onSave());
    const mastery = markControl(doc.createElement("button"), "mastery");
    mastery.className = "pp-btn pp-btn--ghost";
    mastery.textContent = "Start Paper Mastery";
    mastery.addEventListener(
      "click",
      () => void params.actions.onStartMastery(),
    );
    body.append(
      renderReport({
        doc,
        state,
        t,
        paperTitle: params.paperTitle,
        responseLanguage: params.responseLanguage,
      }),
      save,
      mastery,
    );
    return;
  }

  const step = getCriticalReadStep(state);
  if (!step) return;
  const card = doc.createElement("div");
  card.className = "pp-critical-read__step";
  const stepTitle = doc.createElement("strong");
  stepTitle.textContent = `${step.id}. ${getCriticalReadStepCopy(step.id, params.responseLanguage).title}`;
  const instruction = doc.createElement("p");
  instruction.textContent = getCriticalReadStepCopy(
    step.id,
    params.responseLanguage,
  ).instruction;
  card.append(stepTitle, instruction);

  if (step.staleReason) {
    const reopened = doc.createElement("div");
    reopened.className = "pp-critical-read__orientation";
    reopened.textContent = t("Reopened: {reason}", {
      reason: localizeCriticalReadStaleReason(
        step.staleReason,
        params.responseLanguage,
      ),
    });
    card.appendChild(reopened);
  }

  // The search needs an engine with web search. Say so before the click
  // instead of failing after it.
  const unavailableReason =
    step.id === 3 ? params.discoveryUnavailableReason : undefined;
  if (unavailableReason) {
    const unavailable = doc.createElement("div");
    unavailable.className = "pp-critical-read__orientation";
    unavailable.setAttribute("role", "note");
    unavailable.textContent = unavailableReason;
    card.appendChild(unavailable);
  }

  const readerChecklist = READER_CHECKLISTS[step.id];
  if (readerChecklist?.length) {
    const checklistHeading = doc.createElement("strong");
    checklistHeading.textContent = t("Your assessment should cover");
    card.appendChild(checklistHeading);
    appendList(
      doc,
      card,
      readerChecklist.map((entry) => t(entry)),
    );
  }

  if (step.orientation) {
    const notice = doc.createElement("div");
    notice.className = "pp-critical-read__orientation";
    notice.textContent = t(step.orientation.notice);
    card.appendChild(notice);
    if (step.id === 1 && step.orientation.abstract) {
      const abstractHeading = doc.createElement("strong");
      abstractHeading.textContent = t("Abstract");
      const abstract = doc.createElement("p");
      abstract.textContent = step.orientation.abstract;
      card.append(abstractHeading, abstract);
    }
    // Older saved sessions list Step 1 captions in both fields.
    const captionSet = new Set(step.orientation.captions);
    const sourceLocations = step.orientation.sourceLocations.filter(
      (location) => !captionSet.has(location),
    );
    if (sourceLocations.length) {
      const sourceHeading = doc.createElement("strong");
      sourceHeading.textContent = t("Relevant source locations");
      card.appendChild(sourceHeading);
      appendList(doc, card, sourceLocations);
    }
    if (step.orientation.captions.length) {
      const captionHeading = doc.createElement("strong");
      captionHeading.textContent = t("Figure/table caption index");
      card.appendChild(captionHeading);
      appendList(doc, card, step.orientation.captions);
    }
  }

  let answer: HTMLTextAreaElement | undefined;
  if (step.requiresReaderInput) {
    answer = doc.createElement("textarea");
    answer.className = "pp-critical-read__input";
    answer.placeholder = t("Write your independent assessment first…");
    answer.setAttribute("aria-label", t("Your assessment"));
    answer.value = params.readerInput ?? step.readerInput ?? "";
    answer.disabled = state.running;
    card.appendChild(answer);
    shell.input = answer;
  }

  const run = markControl(doc.createElement("button"), "run");
  run.className = "pp-btn pp-btn--primary";
  run.textContent = state.running
    ? "Working…"
    : step.id === 3
      ? "Find and verify prior work"
      : `Run step ${step.id}`;
  // Another run would make the click a silent no-op, so say why instead.
  const blockedReason = state.running
    ? undefined
    : (unavailableReason ?? params.busyReason);
  if (blockedReason) run.title = blockedReason;
  const updateRunAvailability = () => {
    run.disabled =
      state.running ||
      Boolean(blockedReason) ||
      (step.requiresReaderInput && !answer?.value.trim());
  };
  updateRunAvailability();
  answer?.addEventListener("input", () => {
    updateRunAvailability();
    params.actions.onDraftChange?.(step.id, answer?.value ?? "");
  });
  run.addEventListener(
    "click",
    () => void params.actions.onRun(answer?.value || ""),
  );
  card.appendChild(run);
  if (state.running) card.appendChild(makeCancel());
  body.appendChild(card);

  if (selection && answer && !answer.disabled) {
    answer.focus();
    const [start, end] = selection;
    if (start !== null && end !== null) answer.setSelectionRange(start, end);
  }
}
