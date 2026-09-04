import { config } from "../../../package.json";
import { getLocaleID } from "../../utils/locale";
import { getPref } from "../../utils/prefs";
import { copyTextToClipboard } from "../components/ChatMessage";
import { renderResearchWorkspaceArtifactValue } from "./artifactRenderer";
import { button, element } from "./dom";
import {
  openCanonicalReaderCapability,
  type CanonicalReaderCapability,
} from "./canonicalReaderCapability";
import { calculateReproducibilityReadiness } from "./core/reproducibility/readiness";
import { openVerifiedResearchWorkspaceEvidence } from "./evidenceNavigation";
import type { EvidenceReferenceV2 } from "./evidenceVerification";
import { validateLiteratureGraph } from "./core/literatureGraph/graph";
import {
  classifyResearchWorkspaceCitations,
  correctResearchWorkspaceCitationStance,
  exportIntegratedResearchWorkspace,
  extractResearchWorkspaceCitationContexts,
  loadResearchWorkspaceState,
  runResearchWorkspaceMultiOperation,
  runResearchWorkspaceProjectSynthesis,
  runResearchWorkspaceSingleOperation,
  searchResearchWorkspacePaper,
  submitResearchWorkspaceCrossPaperMastery,
  type ResearchWorkspaceMultiOperation,
  type ResearchWorkspaceSingleOperation,
} from "./facade";
import type { CitationContextExtractionResult } from "./citationContextExtraction";
import type { CitationStanceValue } from "./core/citationStance/corrections";
import type { ResearchWorkspaceArtifactType } from "./persistence/contracts";
import {
  loadResearchWorkspacePaper,
  type ResearchWorkspacePaper,
} from "./paperSource";

declare const Zotero: any;

const PANE_ID = "paper-pilot-research-workspace-pane";

interface ViewRuntime {
  itemID?: number;
  generation: symbol;
  busy: boolean;
  paper?: ResearchWorkspacePaper;
  crossSessionID?: string;
  crossSessionRevision?: number;
  crossSubmissionID?: string;
  selectedPapers?: ResearchWorkspacePaper[];
  citationExtraction?: CitationContextExtractionResult;
  citationPayload?: Record<string, any>;
  citationCorrectionSubmissionID?: string;
  projectID?: string;
  abortController?: AbortController;
}

export interface ResearchWorkspaceViewOptions {
  preloadedPaper?: ResearchWorkspacePaper;
  capturedPapers?: readonly ResearchWorkspacePaper[];
  standalone?: boolean;
  projectID?: string;
  recommendedCapabilityIDs?: readonly string[];
}

const runtime = new WeakMap<HTMLElement, ViewRuntime>();
const activeAbortControllers = new Set<AbortController>();
let registered = false;

const CAPABILITY_BUTTON_LABELS = new Map<string, string>([
  ["Extract claims", "claim-ledger"],
  ["Open Critical Read", "critical-read"],
  ["Methodology Audit", "methodology-audit"],
  ["Reproducibility", "reproducibility-audit"],
  ["Paper-to-Code", "paper-to-code"],
  ["Open Paper Mastery", "paper-mastery"],
  ["Quick Compare", "quick-compare"],
  ["Evidence Matrix", "evidence-matrix"],
  ["Literature Graph", "relationship-graph"],
  ["Project synthesis", "project-synthesis"],
  ["Cross-paper question", "cross-paper-mastery"],
  ["Grade cross-paper answer", "cross-paper-mastery"],
  ["Extract citation contexts locally", "citation-context"],
  ["Analyze approved snippets", "citation-stance"],
  ["Save stance correction", "citation-stance"],
]);

const SINGLE_RESULT_ARTIFACT_TYPES: Record<
  ResearchWorkspaceSingleOperation,
  ResearchWorkspaceArtifactType
> = {
  claims: "claim-ledger",
  "methodology-audit": "methodology-audit",
  reproducibility: "reproducibility",
  "paper-to-code": "paper-to-code",
};

function markRecommendedCapabilityButtons(
  root: HTMLElement,
  recommendedCapabilityIDs: ReadonlySet<string>,
) {
  for (const node of Array.from(
    root.querySelectorAll("button"),
  ) as HTMLButtonElement[]) {
    const label = node.textContent?.trim() ?? "";
    const capabilityID = CAPABILITY_BUTTON_LABELS.get(label);
    if (!capabilityID || !recommendedCapabilityIDs.has(capabilityID)) continue;
    node.classList.add("pp-btn--recommended");
    node.dataset.recommendedCapability = capabilityID;
    node.title = `${label} is recommended by the current project template.`;
    node.setAttribute(
      "aria-label",
      `${label} (recommended by the current project template)`,
    );
  }
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

function select(
  doc: Document,
  options: Array<{ value: string; label: string }>,
) {
  const node = element(doc, "select", "pprw-input");
  for (const option of options) {
    const item = element(doc, "option", "", option.label);
    item.value = option.value;
    node.append(item);
  }
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
    root.querySelectorAll("button, input, textarea, select"),
  ) as Array<
    | HTMLButtonElement
    | HTMLInputElement
    | HTMLTextAreaElement
    | HTMLSelectElement
  >) {
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

function renderOutput(
  root: HTMLElement,
  title: string,
  value: unknown,
  _fallbackAttachmentID: number,
  generation: symbol,
  artifactType?: ResearchWorkspaceArtifactType,
) {
  if (!isCurrent(root, generation)) return;
  const panel = root.querySelector<HTMLElement>(".pprw-result");
  if (!panel) return;
  panel.replaceChildren(
    element(root.ownerDocument, "h3", "pprw-result-title", title),
  );
  panel.append(
    renderResearchWorkspaceArtifactValue(root.ownerDocument, value, {
      artifactType,
      responseLanguage: String(getPref("responseLanguage") || "English"),
      onCopyText: (text) => copyTextToClipboard(text, root.ownerDocument),
      onOpenEvidence: (reference) =>
        guarded(root, "Opening evidence", async () => {
          await openVerifiedResearchWorkspaceEvidence(
            reference as unknown as EvidenceReferenceV2,
          );
        }),
    }),
  );
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
  const recommendedCapabilityIDs = new Set(
    options.recommendedCapabilityIDs ?? [],
  );
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
                  status: "unverified",
                  method: "local-index-hit",
                  detail:
                    "Located by local hybrid search; use evidence verification before treating this as verified.",
                }
              : {
                  status: "unverified",
                  method: "metadata-only",
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
      renderOutput(
        root,
        title,
        value,
        paper.attachmentID,
        generation,
        SINGLE_RESULT_ARTIFACT_TYPES[operation],
      );
    });
  const actionRow = row(doc);
  const openCanonical = (
    capability: CanonicalReaderCapability,
    title: string,
  ) =>
    guarded(root, `Opening ${title}`, async ({ generation }) => {
      const opened = await openCanonicalReaderCapability({ paper, capability });
      renderOutput(
        root,
        title,
        opened.activated
          ? {
              status: `${title} opened in the canonical Reader workflow.`,
              sourceID: opened.sourceID,
            }
          : {
              status: `The exact PDF opened. Open Paper Pilot in the Reader and choose ${title}.`,
              sourceID: opened.sourceID,
            },
        paper.attachmentID,
        generation,
      );
    });
  actionRow.append(
    button(doc, "Extract claims", () =>
      runSingle("claims", "Extracting claims", "Claim–Evidence Ledger"),
    ),
    button(doc, "Open Critical Read", () =>
      openCanonical("critical-read", "Critical Read"),
    ),
    button(doc, "Methodology Audit", () =>
      runSingle(
        "methodology-audit",
        "Running Methodology Audit",
        "Methodology Audit",
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

  const mastery = details(doc, "Paper Mastery", true);
  mastery.content.append(
    element(
      doc,
      "p",
      "pprw-muted",
      "Questions, answers, calibration, and review progress are maintained by the canonical Reader workflow.",
    ),
  );
  const masteryRow = row(doc);
  masteryRow.append(
    button(doc, "Open Paper Mastery", () =>
      openCanonical("paper-mastery", "Paper Mastery"),
    ),
  );
  mastery.content.append(masteryRow);
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
  const crossConfidence = element(doc, "input", "pprw-range");
  crossConfidence.type = "range";
  crossConfidence.min = "0";
  crossConfidence.max = "1";
  crossConfidence.step = "0.05";
  crossConfidence.value = "0.7";
  const crossConfidenceLabel = element(
    doc,
    "span",
    "pprw-confidence",
    "Confidence before grading: 70%",
  );
  crossConfidence.addEventListener("input", () => {
    crossConfidenceLabel.textContent = `Confidence before grading: ${Math.round(Number(crossConfidence.value) * 100)}%`;
  });
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
        current.crossSessionRevision = value.session.revision;
        current.crossSubmissionID = undefined;
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
        operation === "evidence-matrix" || operation === "quick-compare"
          ? `${operation === "quick-compare" ? "Quick Compare" : "Evidence Matrix"} · coverage ${formatPercent(value.coverage.extractionCoverage)}`
          : `Literature Graph · ${validateLiteratureGraph(value).valid ? "valid" : "needs review"}`;
      renderOutput(root, resultTitle, value, paper.attachmentID, generation);
    });
  const collectionRow = row(doc);
  collectionRow.append(
    button(doc, "Quick Compare", () =>
      runMulti("quick-compare", "Building Quick Compare"),
    ),
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
          const expectedRevision = current.crossSessionRevision;
          if (!Number.isInteger(expectedRevision)) {
            throw new Error("Reload the cross-paper session before grading.");
          }
          if (!crossAnswer.value.trim())
            throw new Error("Enter an answer first.");
          current.crossSubmissionID ??=
            typeof globalThis.crypto?.randomUUID === "function"
              ? `cross-submission-${globalThis.crypto.randomUUID()}`
              : `cross-submission-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
          const value = await submitResearchWorkspaceCrossPaperMastery({
            papers: current.selectedPapers,
            sessionID: current.crossSessionID,
            expectedRevision: expectedRevision!,
            submissionID: current.crossSubmissionID,
            answer: crossAnswer.value,
            confidence: Number(crossConfidence.value),
            projectID: options.projectID,
            signal,
            onStatus,
          });
          current.crossSessionRevision = value.session.revision;
          current.crossSubmissionID = undefined;
          crossAnswer.value = "";
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
    crossConfidenceLabel,
    crossConfidence,
  );
  root.insertBefore(collection.root, result);

  const citations = details(doc, "Citation stance", false);
  const citationPrivacy = element(
    doc,
    "p",
    "pprw-muted",
    "Extraction and Zotero matching stay local. Stance analysis sends only the displayed citation snippets to your selected CLI provider after you approve it; it never sends the full PDF or bibliography.",
  );
  const citationConsent = element(doc, "input", "");
  citationConsent.type = "checkbox";
  citationConsent.disabled = true;
  citationConsent.dataset.disabled = "true";
  const citationConsentLabel = element(doc, "label", "pprw-check-row");
  citationConsentLabel.append(
    citationConsent,
    element(
      doc,
      "span",
      "",
      "I reviewed the extracted snippets and approve sending only those snippets for stance analysis.",
    ),
  );
  const correctionContext = select(doc, [
    { value: "", label: "Run stance analysis before correcting" },
  ]);
  const correctionStance = select(doc, [
    { value: "supporting", label: "Supporting" },
    { value: "contrasting", label: "Contrasting" },
    { value: "methodological", label: "Methodological" },
    { value: "mentioning", label: "Mentioning" },
    { value: "background", label: "Background" },
    { value: "uncertain", label: "Uncertain" },
  ]);
  const correctionReason = input(doc, "Why should this stance change?");
  const analyzeCitationsButton = button(doc, "Analyze approved snippets", () =>
    guarded(
      root,
      "Classifying approved citation contexts",
      async ({ generation, signal, onStatus }) => {
        const current = runtime.get(root);
        if (!current) return;
        const extraction = current.citationExtraction;
        if (!extraction?.contexts.length) {
          throw new Error("Extract citation contexts first.");
        }
        if (!citationConsent.checked) {
          throw new Error("Review and approve the extracted snippets first.");
        }
        const papers = current.selectedPapers?.length
          ? current.selectedPapers
          : [paper];
        const classified = await classifyResearchWorkspaceCitations({
          anchor: paper,
          papers,
          contexts: extraction.contexts,
          extraction,
          approvedForModel: true,
          projectID: options.projectID,
          signal,
          onStatus,
        });
        const value = {
          ...classified,
          schemaVersion: 1,
          revision: Number(classified.revision ?? 0),
          contexts: extraction.contexts,
          sourceSnapshot: extraction.sourceSnapshot,
          extractorVersion: extraction.extractorVersion,
          coverage: {
            ...extraction.coverage,
            ...(classified.coverage ?? {}),
          },
          corrections: classified.corrections ?? [],
        };
        current.citationPayload = value;
        current.citationCorrectionSubmissionID = undefined;
        correctionContext.replaceChildren();
        for (const context of extraction.contexts) {
          const option = element(
            doc,
            "option",
            "",
            `${context.exactSentence.slice(0, 100)}${
              context.exactSentence.length > 100 ? "…" : ""
            }`,
          );
          option.value = context.id;
          correctionContext.append(option);
        }
        delete correctionContext.dataset.disabled;
        delete correctionStance.dataset.disabled;
        delete correctionReason.dataset.disabled;
        delete correctCitationButton.dataset.disabled;
        correctionContext.disabled = false;
        correctionStance.disabled = false;
        correctionReason.disabled = false;
        correctCitationButton.disabled = false;
        renderOutput(
          root,
          "Citation stance review signal",
          value,
          paper.attachmentID,
          generation,
        );
      },
    ),
  );
  analyzeCitationsButton.disabled = true;
  analyzeCitationsButton.dataset.disabled = "true";
  citationConsent.addEventListener("change", () => {
    const hasContexts = Boolean(
      runtime.get(root)?.citationExtraction?.contexts.length,
    );
    const enabled = citationConsent.checked && hasContexts;
    analyzeCitationsButton.disabled = !enabled;
    if (enabled) delete analyzeCitationsButton.dataset.disabled;
    else analyzeCitationsButton.dataset.disabled = "true";
  });
  const correctCitationButton = button(doc, "Save stance correction", () =>
    guarded(
      root,
      "Saving citation stance correction",
      async ({ generation, signal, onStatus }) => {
        const current = runtime.get(root);
        if (!current?.citationPayload) {
          throw new Error("Run stance analysis before correcting it.");
        }
        if (!correctionContext.value) {
          throw new Error("Choose a citation context to correct.");
        }
        if (!correctionReason.value.trim()) {
          throw new Error("Explain why the stance should change.");
        }
        current.citationCorrectionSubmissionID ??=
          typeof globalThis.crypto?.randomUUID === "function"
            ? `citation-correction-${globalThis.crypto.randomUUID()}`
            : `citation-correction-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        const papers = current.selectedPapers?.length
          ? current.selectedPapers
          : [paper];
        const value = await correctResearchWorkspaceCitationStance({
          papers,
          payload: current.citationPayload,
          contextID: correctionContext.value,
          stance: correctionStance.value as CitationStanceValue,
          reason: correctionReason.value,
          expectedRevision: Number(current.citationPayload.revision ?? 0),
          submissionID: current.citationCorrectionSubmissionID,
          projectID: options.projectID,
          signal,
          onStatus,
        });
        current.citationPayload = value;
        current.citationCorrectionSubmissionID = undefined;
        correctionReason.value = "";
        renderOutput(
          root,
          "Citation stance · corrected",
          value,
          paper.attachmentID,
          generation,
        );
      },
    ),
  );
  for (const control of [
    correctionContext,
    correctionStance,
    correctionReason,
    correctCitationButton,
  ]) {
    control.disabled = true;
    control.dataset.disabled = "true";
  }
  citations.content.append(
    citationPrivacy,
    button(doc, "Extract citation contexts locally", () =>
      guarded(
        root,
        "Extracting local citation contexts",
        async ({ generation, signal, onStatus }) => {
          const current = runtime.get(root);
          if (!current) return;
          const papers = current.selectedPapers?.length
            ? current.selectedPapers
            : [paper];
          const value = await extractResearchWorkspaceCitationContexts({
            papers,
            projectID: options.projectID,
            signal,
            onStatus,
          });
          current.citationExtraction = value;
          current.citationPayload = undefined;
          citationConsent.checked = false;
          citationConsent.disabled = !value.contexts.length;
          if (value.contexts.length) delete citationConsent.dataset.disabled;
          else citationConsent.dataset.disabled = "true";
          analyzeCitationsButton.disabled = true;
          analyzeCitationsButton.dataset.disabled = "true";
          renderOutput(
            root,
            "Local citation context review",
            value,
            paper.attachmentID,
            generation,
          );
        },
      ),
    ),
    citationConsentLabel,
    analyzeCitationsButton,
    element(
      doc,
      "p",
      "pprw-muted",
      "Stance is a review signal, not a verdict about whether a cited claim is true.",
    ),
    correctionContext,
    correctionStance,
    correctionReason,
    correctCitationButton,
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
  markRecommendedCapabilityButtons(root, recommendedCapabilityIDs);
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
        supportsResearchWorkspacePaneItem(item) &&
          (tabType === "reader" || tabType === "library"),
      );
      return true;
    },
    onRender: async ({ body, item }: any) => {
      if (item) await renderResearchWorkspaceView(body, item);
    },
  });
  registered = true;
}

export function supportsResearchWorkspacePaneItem(item: any) {
  if (!item) return false;
  if (typeof item.isRegularItem === "function" && item.isRegularItem()) {
    return true;
  }
  if (typeof item.isPDFAttachment === "function") {
    return Boolean(item.isPDFAttachment());
  }
  return (
    typeof item.isAttachment === "function" &&
    item.isAttachment() &&
    String(item.attachmentContentType || item.getField?.("contentType") || "")
      .toLowerCase()
      .includes("pdf")
  );
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
