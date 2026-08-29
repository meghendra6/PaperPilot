import { config } from "../../../package.json";
import { getLocaleID } from "../../utils/locale";
import { calculateReproducibilityReadiness } from "./core/reproducibility/readiness";
import { formatEvidenceLocator } from "./core/evidence/types";
import { openVerifiedResearchWorkspaceEvidence } from "./evidenceNavigation";
import type { EvidenceReferenceV2 } from "./evidenceVerification";
import { validateLiteratureGraph } from "./core/literatureGraph/graph";
import {
  classifyResearchWorkspaceCitations,
  exportIntegratedResearchWorkspace,
  loadResearchWorkspaceState,
  runResearchWorkspaceMultiOperation,
  runResearchWorkspaceProjectSynthesis,
  runResearchWorkspaceSingleOperation,
  searchResearchWorkspacePaper,
  startOrResumeResearchWorkspaceMastery,
  submitResearchWorkspaceCrossPaperMastery,
  submitResearchWorkspaceMastery,
  type ResearchWorkspaceMultiOperation,
  type ResearchWorkspaceSingleOperation,
} from "./facade";
import {
  loadResearchWorkspacePaper,
  type ResearchWorkspacePaper,
} from "./paperSource";

declare const Zotero: any;

const HTML_NS = "http://www.w3.org/1999/xhtml";
const PANE_ID = "paper-pilot-research-workspace-pane";

interface ViewRuntime {
  itemID?: number;
  generation: symbol;
  busy: boolean;
  paper?: ResearchWorkspacePaper;
  crossSessionID?: string;
  selectedPapers?: ResearchWorkspacePaper[];
  projectID?: string;
  abortController?: AbortController;
}

export interface ResearchWorkspaceViewOptions {
  preloadedPaper?: ResearchWorkspacePaper;
  capturedPapers?: readonly ResearchWorkspacePaper[];
  standalone?: boolean;
  projectID?: string;
}

const runtime = new WeakMap<HTMLElement, ViewRuntime>();
const activeAbortControllers = new Set<AbortController>();
let registered = false;

function element<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  className = "",
  text?: string,
) {
  const node = doc.createElementNS(HTML_NS, tag) as HTMLElementTagNameMap[K];
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(
  doc: Document,
  text: string,
  action: () => void | Promise<void>,
  className = "pprw-button pp-btn pp-btn--secondary",
) {
  const node = element(doc, "button", className, text);
  node.type = "button";
  node.addEventListener("click", () => void action());
  return node;
}

function input(doc: Document, placeholder: string, value = "") {
  const node = element(doc, "input", "pprw-input");
  node.type = "text";
  node.placeholder = placeholder;
  node.value = value;
  return node;
}

function textarea(doc: Document, placeholder: string, rows = 5) {
  const node = element(doc, "textarea", "pprw-textarea");
  node.placeholder = placeholder;
  node.rows = rows;
  return node;
}

function details(doc: Document, title: string, open = false) {
  const root = element(doc, "details", "pprw-section");
  root.open = open;
  root.append(element(doc, "summary", "pprw-section-title", title));
  const content = element(doc, "div", "pprw-section-content");
  root.append(content);
  return { root, content };
}

function row(doc: Document) {
  return element(doc, "div", "pprw-row");
}

function formatPercent(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? `${Math.round(number * 100)}%` : "—";
}

function safeStringify(value: unknown) {
  try {
    const seen = new WeakSet<object>();
    return JSON.stringify(
      value,
      (_key, entry) => {
        if (!entry || typeof entry !== "object") return entry;
        if (seen.has(entry)) return "[Circular]";
        seen.add(entry);
        return entry;
      },
      2,
    );
  } catch {
    return String(value);
  }
}

function isCurrent(root: HTMLElement, generation?: symbol) {
  return !generation || runtime.get(root)?.generation === generation;
}

function setStatus(
  root: HTMLElement,
  message: string,
  kind: "info" | "success" | "error" = "info",
  generation?: symbol,
) {
  if (!isCurrent(root, generation)) return;
  const node = root.querySelector<HTMLElement>(".pprw-status");
  if (!node) return;
  node.textContent = message;
  node.dataset.kind = kind;
}

function setBusy(root: HTMLElement, busy: boolean, generation?: symbol) {
  if (!isCurrent(root, generation)) return;
  const current = runtime.get(root);
  if (!current) return;
  current.busy = busy;
  for (const node of Array.from(
    root.querySelectorAll("button, input, textarea"),
  ) as Array<HTMLButtonElement | HTMLInputElement | HTMLTextAreaElement>) {
    node.disabled = node.classList.contains("pprw-cancel")
      ? !busy
      : busy || node.dataset.disabled === "true";
  }
  root.classList.toggle("is-busy", busy);
}

async function guarded(
  root: HTMLElement,
  label: string,
  action: (params: {
    generation: symbol;
    signal: AbortSignal;
    onStatus: (message: string) => void;
  }) => Promise<void>,
) {
  const current = runtime.get(root);
  if (!current || current.busy) return;
  const generation = current.generation;
  const AbortControllerConstructor =
    globalThis.AbortController ||
    root.ownerDocument.defaultView?.AbortController;
  if (!AbortControllerConstructor) {
    setStatus(
      root,
      "Cancellation support is unavailable.",
      "error",
      generation,
    );
    return;
  }
  const abortController = new AbortControllerConstructor();
  activeAbortControllers.add(abortController);
  current.abortController = abortController;
  setBusy(root, true, generation);
  setStatus(root, `${label}…`, "info", generation);
  try {
    await action({
      generation,
      signal: abortController.signal,
      onStatus: (message) => setStatus(root, message, "info", generation),
    });
    setStatus(root, `${label} completed.`, "success", generation);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus(root, message, "error", generation);
    Zotero.logError?.(error);
  } finally {
    if (isCurrent(root, generation)) {
      const latest = runtime.get(root);
      if (latest) latest.abortController = undefined;
      setBusy(root, false, generation);
    }
    activeAbortControllers.delete(abortController);
  }
}

function collectEvidence(
  value: unknown,
  result: any[] = [],
  seen = new Set<string>(),
  visited = new WeakSet<object>(),
) {
  if (!value || typeof value !== "object") return result;
  if (visited.has(value)) return result;
  visited.add(value);
  if (Array.isArray(value)) {
    for (const entry of value) collectEvidence(entry, result, seen, visited);
    return result;
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.attachmentKey === "string" &&
    (record.pageIndex !== undefined ||
      record.sectionPath ||
      record.quote ||
      record.exactQuote ||
      record.elementType)
  ) {
    const key = `${record.sourceID || ""}:${record.libraryID || ""}:${record.attachmentKey}:${record.pageIndex}:${record.exactQuote || record.quote || ""}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(record);
    }
  }
  for (const entry of Object.values(record)) {
    collectEvidence(entry, result, seen, visited);
  }
  return result;
}

function renderOutput(
  root: HTMLElement,
  title: string,
  value: unknown,
  _fallbackAttachmentID: number,
  generation: symbol,
) {
  if (!isCurrent(root, generation)) return;
  const panel = root.querySelector<HTMLElement>(".pprw-result");
  if (!panel) return;
  panel.replaceChildren(
    element(root.ownerDocument, "h3", "pprw-result-title", title),
  );
  const evidence = collectEvidence(value);
  if (evidence.length) {
    const links = element(root.ownerDocument, "div", "pprw-evidence-links");
    for (const reference of evidence.slice(0, 40)) {
      const status = String(reference.verification?.status || "unverified");
      if (status === "verified") {
        links.append(
          button(
            root.ownerDocument,
            `Verified · ${formatEvidenceLocator(reference)}`,
            () =>
              guarded(root, "Opening evidence", async () => {
                await openVerifiedResearchWorkspaceEvidence(
                  reference as EvidenceReferenceV2,
                );
              }),
            "pprw-evidence pp-btn pp-btn--ghost",
          ),
        );
      } else {
        links.append(
          element(
            root.ownerDocument,
            "span",
            "pprw-evidence pprw-evidence--unverified",
            `${status} · ${formatEvidenceLocator(reference)}`,
          ),
        );
      }
    }
    panel.append(links);
  }
  const pre = element(root.ownerDocument, "pre", "pprw-pre");
  pre.textContent = safeStringify(value);
  panel.append(pre);
}

function paperSummary(doc: Document, paper: ResearchWorkspacePaper) {
  const node = element(doc, "div", "pprw-paper-summary");
  node.append(element(doc, "strong", "", paper.title));
  node.append(
    element(
      doc,
      "span",
      "",
      `${paper.extractionQuality} · ${paper.context.split(/\s+/).filter(Boolean).length.toLocaleString()} words · attachment ${paper.attachmentKey}`,
    ),
  );
  return node;
}

export async function renderResearchWorkspaceView(
  root: HTMLElement,
  item: any,
  options: ResearchWorkspaceViewOptions = {},
) {
  runtime.get(root)?.abortController?.abort();
  const generation = Symbol("research-workspace-render");
  runtime.set(root, { itemID: item?.id, generation, busy: false });
  const doc = root.ownerDocument;
  root.className = "paperpilot-research-workspace";
  root.replaceChildren();

  const title = element(doc, "div", "pprw-title");
  title.append(
    element(
      doc,
      "p",
      "",
      options.capturedPapers
        ? "Evidence-grounded workflows for the immutable selection captured when this workspace opened."
        : "Evidence-grounded workflows for this paper and the current Zotero selection.",
    ),
  );
  if (!options.standalone) {
    title.append(
      button(
        doc,
        "Open Workspace",
        async () => {
          const { openResearchWorkspace } = await import("./window");
          await openResearchWorkspace({ items: [item], origin: "item-pane" });
        },
        "pprw-button pp-btn pp-btn--primary",
      ),
    );
  }
  root.append(title);
  const statusRow = element(doc, "div", "pprw-status-row");
  const statusNode = element(doc, "div", "pprw-status", "Loading paper…");
  statusNode.dataset.kind = "info";
  statusNode.setAttribute("role", "status");
  statusNode.setAttribute("aria-live", "polite");
  const cancelButton = button(
    doc,
    "Cancel",
    () => {
      const current = runtime.get(root);
      if (!current?.abortController) return;
      setStatus(root, "Cancelling…", "info", current.generation);
      current.abortController.abort();
    },
    "pprw-button pprw-cancel pp-btn pp-btn--ghost",
  );
  cancelButton.disabled = true;
  statusRow.append(statusNode, cancelButton);
  root.append(statusRow);
  const result = element(doc, "div", "pprw-result");
  result.setAttribute("aria-live", "polite");
  root.append(result);

  let paper: ResearchWorkspacePaper;
  let state: any;
  try {
    state = await loadResearchWorkspaceState();
    paper =
      options.preloadedPaper ??
      (await loadResearchWorkspacePaper(
        item,
        state.preferences.maxPaperCharacters,
      ));
    if (!isCurrent(root, generation)) return;
    Object.assign(runtime.get(root)!, {
      paper,
      ...(options.projectID ? { projectID: options.projectID } : {}),
      ...(options.capturedPapers
        ? { selectedPapers: [...options.capturedPapers] }
        : {}),
    });
    root.insertBefore(paperSummary(doc, paper), result);
    setStatus(root, "Ready.", "success", generation);
  } catch (error) {
    setStatus(
      root,
      error instanceof Error ? error.message : String(error),
      "error",
      generation,
    );
    return;
  }

  const search = details(doc, "Local hybrid search", true);
  const searchInput = input(
    doc,
    "Search concepts, symbols, sections, or exact identifiers",
  );
  const searchRow = row(doc);
  searchRow.append(
    searchInput,
    button(doc, "Search", () =>
      guarded(root, "Searching the local paper", async ({ generation }) => {
        if (!searchInput.value.trim()) throw new Error("Enter a search query.");
        const matches = await searchResearchWorkspacePaper({
          paper,
          query: searchInput.value,
        });
        renderOutput(
          root,
          `Search · ${searchInput.value}`,
          matches.map((entry: any) => ({
            score: entry.score,
            section: entry.chunk.sectionPath,
            sourceID: paper.sourceID,
            libraryID: paper.libraryID,
            pageIndex: entry.chunk.pageIndex,
            attachmentKey: entry.chunk.attachmentKey,
            elementId: entry.chunk.metadata?.elementId,
            elementType: entry.chunk.metadata?.elementType,
            text: entry.chunk.text.slice(0, 900),
            matchedTerms: entry.matchedTerms,
            verification: entry.chunk.metadata?.elementId
              ? {
                  status: "verified",
                  method: "structured-element",
                  verifiedAt: new Date().toISOString(),
                  verifierVersion: "paperpilot-evidence-v2",
                }
              : {
                  status: "unverified",
                  method: "metadata-only",
                  verifierVersion: "paperpilot-evidence-v2",
                  detail: "No page-level structured element is available.",
                },
          })),
          paper.attachmentID,
          generation,
        );
      }),
    ),
  );
  search.content.append(searchRow);
  root.insertBefore(search.root, result);

  const understanding = details(doc, "Understand and challenge", true);
  const runSingle = (
    operation: ResearchWorkspaceSingleOperation,
    label: string,
    resultTitle: string,
  ) =>
    guarded(root, label, async ({ generation, signal, onStatus }) => {
      const value = await runResearchWorkspaceSingleOperation({
        paper,
        operation,
        projectID: options.projectID,
        signal,
        onStatus,
      });
      const title =
        operation === "reproducibility"
          ? `${resultTitle} · readiness ${formatPercent(calculateReproducibilityReadiness(value as any).score)}`
          : resultTitle;
      renderOutput(root, title, value, paper.attachmentID, generation);
    });
  const actionRow = row(doc);
  actionRow.append(
    button(doc, "Extract claims", () =>
      runSingle("claims", "Extracting claims", "Claim–Evidence Ledger"),
    ),
    button(doc, "Profiled audit", () =>
      runSingle(
        "critical-read",
        "Running profiled Critical Read",
        "Profiled Critical Read",
      ),
    ),
    button(doc, "Reproducibility", () =>
      runSingle(
        "reproducibility",
        "Auditing reproducibility",
        "Reproducibility",
      ),
    ),
    button(doc, "Paper-to-Code", () =>
      runSingle(
        "paper-to-code",
        "Building implementation map",
        "Paper-to-Code",
      ),
    ),
  );
  understanding.content.append(actionRow);
  root.insertBefore(understanding.root, result);

  const mastery = details(doc, "Paper Mastery 2.0", true);
  const question = element(
    doc,
    "div",
    "pprw-question",
    "Start or resume to generate an evidence-grounded question.",
  );
  const answer = textarea(
    doc,
    "Answer without looking at the paper when possible.",
    6,
  );
  const confidence = element(doc, "input", "pprw-range");
  confidence.type = "range";
  confidence.min = "0";
  confidence.max = "1";
  confidence.step = "0.05";
  confidence.value = "0.7";
  const confidenceLabel = element(
    doc,
    "span",
    "pprw-confidence",
    "Confidence: 70%",
  );
  confidence.addEventListener("input", () => {
    confidenceLabel.textContent = `Confidence: ${Math.round(Number(confidence.value) * 100)}%`;
  });
  const masteryRow = row(doc);
  masteryRow.append(
    button(doc, "Start / Resume", () =>
      guarded(
        root,
        "Preparing mastery",
        async ({ generation, signal, onStatus }) => {
          const value = await startOrResumeResearchWorkspaceMastery({
            paper,
            projectID: options.projectID,
            signal,
            onStatus,
          });
          question.textContent =
            value.question?.prompt || "Session complete. Review the dashboard.";
          renderOutput(
            root,
            "Mastery dashboard",
            value.dashboard,
            paper.attachmentID,
            generation,
          );
        },
      ),
    ),
    button(doc, "Submit answer", () =>
      guarded(
        root,
        "Grading answer",
        async ({ generation, signal, onStatus }) => {
          if (!answer.value.trim()) throw new Error("Enter an answer first.");
          const value = await submitResearchWorkspaceMastery({
            paper,
            answer: answer.value,
            confidence: Number(confidence.value),
            projectID: options.projectID,
            signal,
            onStatus,
          });
          answer.value = "";
          question.textContent =
            value.question?.prompt || "Session complete. Review the dashboard.";
          renderOutput(
            root,
            "Mastery feedback",
            { feedback: value.feedback, dashboard: value.dashboard },
            paper.attachmentID,
            generation,
          );
        },
      ),
    ),
  );
  mastery.content.append(
    question,
    answer,
    confidenceLabel,
    confidence,
    masteryRow,
  );
  root.insertBefore(mastery.root, result);

  const collection = details(doc, "Selected-paper intelligence", false);
  collection.content.append(
    element(
      doc,
      "p",
      "pprw-muted",
      options.capturedPapers
        ? `${options.capturedPapers.length} readable paper${options.capturedPapers.length === 1 ? " was" : "s were"} captured for this workspace. Start a new selection to change them.`
        : "Select two or more Zotero items before running these tools.",
    ),
  );
  const crossQuestion = element(
    doc,
    "div",
    "pprw-question",
    "No cross-paper question yet.",
  );
  const crossAnswer = textarea(doc, "Cross-paper answer", 5);
  const synthesisQuestion = textarea(
    doc,
    "Ask a project question across the captured papers",
    3,
  );
  const runMulti = (
    operation: ResearchWorkspaceMultiOperation,
    label: string,
  ) =>
    guarded(root, label, async ({ generation, signal, onStatus }) => {
      if (!options.capturedPapers) {
        throw new Error(
          "Open the full Research Workspace to capture a multi-paper selection.",
        );
      }
      const papers = [...options.capturedPapers];
      const value = await runResearchWorkspaceMultiOperation({
        papers,
        operation,
        projectID: options.projectID,
        signal,
        onStatus,
      });
      if (operation === "cross-paper-mastery") {
        const current = runtime.get(root);
        if (!current || current.generation !== generation) return;
        current.crossSessionID = value.session.id;
        current.selectedPapers = papers;
        crossQuestion.textContent = value.question.prompt;
        renderOutput(
          root,
          "Cross-paper question",
          {
            mode: value.question.mode,
            difficulty: value.question.difficulty,
            paperKeys: value.question.paperKeys,
          },
          paper.attachmentID,
          generation,
        );
        return;
      }
      const resultTitle =
        operation === "evidence-matrix"
          ? `Evidence Matrix · coverage ${formatPercent(value.coverage.extractionCoverage)}`
          : `Literature Graph · ${validateLiteratureGraph(value).valid ? "valid" : "needs review"}`;
      renderOutput(root, resultTitle, value, paper.attachmentID, generation);
    });
  const collectionRow = row(doc);
  collectionRow.append(
    button(doc, "Evidence Matrix", () =>
      runMulti("evidence-matrix", "Building Evidence Matrix"),
    ),
    button(doc, "Literature Graph", () =>
      runMulti("literature-graph", "Building Literature Graph"),
    ),
    button(doc, "Project synthesis", () =>
      guarded(
        root,
        "Synthesizing the project",
        async ({ generation, signal, onStatus }) => {
          if (!options.capturedPapers) {
            throw new Error(
              "Open the full Research Workspace to capture a multi-paper selection.",
            );
          }
          if (!synthesisQuestion.value.trim()) {
            throw new Error("Enter a project question.");
          }
          const value = await runResearchWorkspaceProjectSynthesis({
            papers: [...options.capturedPapers],
            question: synthesisQuestion.value,
            projectID: options.projectID,
            signal,
            onStatus,
          });
          renderOutput(
            root,
            "Project synthesis",
            value,
            paper.attachmentID,
            generation,
          );
        },
      ),
    ),
    button(doc, "Cross-paper question", () =>
      runMulti("cross-paper-mastery", "Creating cross-paper question"),
    ),
    button(doc, "Grade cross-paper answer", () =>
      guarded(
        root,
        "Grading cross-paper answer",
        async ({ generation, signal, onStatus }) => {
          const current = runtime.get(root);
          if (!current?.crossSessionID || !current.selectedPapers) {
            throw new Error("Create a cross-paper question first.");
          }
          if (!crossAnswer.value.trim())
            throw new Error("Enter an answer first.");
          const value = await submitResearchWorkspaceCrossPaperMastery({
            papers: current.selectedPapers,
            sessionID: current.crossSessionID,
            answer: crossAnswer.value,
            confidence: 0.7,
            projectID: options.projectID,
            signal,
            onStatus,
          });
          renderOutput(
            root,
            "Cross-paper mastery feedback",
            value,
            paper.attachmentID,
            generation,
          );
        },
      ),
    ),
  );
  if (options.capturedPapers && options.capturedPapers.length < 2) {
    for (const node of Array.from(
      collectionRow.querySelectorAll("button"),
    ) as HTMLButtonElement[]) {
      node.dataset.disabled = "true";
      node.disabled = true;
    }
  }
  collection.content.append(
    synthesisQuestion,
    collectionRow,
    crossQuestion,
    crossAnswer,
  );
  root.insertBefore(collection.root, result);

  const citations = details(doc, "Citation stance", false);
  const citationInput = textarea(
    doc,
    `JSON array: [{"id":"c1","citingPaperKey":"${paper.paperKey}","citedPaperKey":"OTHER","context":"...","evidence":[]}]`,
    7,
  );
  citations.content.append(
    citationInput,
    button(doc, "Classify contexts", () =>
      guarded(
        root,
        "Classifying citation contexts",
        async ({ generation, signal, onStatus }) => {
          const parsed = JSON.parse(citationInput.value);
          if (!Array.isArray(parsed)) {
            throw new Error("Citation input must be a JSON array.");
          }
          const value = await classifyResearchWorkspaceCitations({
            anchor: paper,
            contexts: parsed,
            projectID: options.projectID,
            signal,
            onStatus,
          });
          renderOutput(
            root,
            "Citation stance",
            value,
            paper.attachmentID,
            generation,
          );
        },
      ),
    ),
  );
  root.insertBefore(citations.root, result);

  const exportSection = details(doc, "Export", false);
  exportSection.content.append(
    button(doc, "Export workspace JSON + Markdown", () =>
      guarded(root, "Exporting workspace", async ({ generation, onStatus }) => {
        const value = await exportIntegratedResearchWorkspace({
          anchor: paper,
          projectID: options.projectID,
          onStatus,
        });
        renderOutput(
          root,
          "Export complete",
          value,
          paper.attachmentID,
          generation,
        );
      }),
    ),
  );
  root.insertBefore(exportSection.root, result);
}

export function registerResearchWorkspacePaneSection() {
  if (registered || !Zotero.ItemPaneManager?.registerSection) return;
  Zotero.ItemPaneManager.registerSection({
    paneID: PANE_ID,
    pluginID: config.addonID,
    header: {
      l10nID: getLocaleID("item-section-research-workspace-head-text"),
      icon: `chrome://${config.addonRef}/content/icons/favicon@0.5x.png`,
    },
    sidenav: {
      l10nID: getLocaleID("item-section-research-workspace-sidenav-tooltip"),
      icon: `chrome://${config.addonRef}/content/icons/favicon@0.5x.png`,
    },
    bodyXHTML:
      '<html:div xmlns:html="http://www.w3.org/1999/xhtml" class="paperpilot-research-workspace-root" />',
    onItemChange: ({ setEnabled, item, tabType }: any) => {
      setEnabled(
        Boolean(item) && (tabType === "reader" || tabType === "library"),
      );
      return true;
    },
    onRender: async ({ body, item }: any) => {
      if (item) await renderResearchWorkspaceView(body, item);
    },
  });
  registered = true;
}

export function unregisterResearchWorkspacePaneSection() {
  for (const controller of activeAbortControllers) controller.abort();
  activeAbortControllers.clear();
  if (!registered) return;
  try {
    Zotero.ItemPaneManager?.unregisterSection?.(PANE_ID);
  } catch (error) {
    Zotero.logError?.(error);
  }
  registered = false;
}

export function disposeResearchWorkspaceView(root: HTMLElement) {
  const current = runtime.get(root);
  current?.abortController?.abort();
  if (current?.abortController) {
    activeAbortControllers.delete(current.abortController);
  }
  runtime.delete(root);
}
