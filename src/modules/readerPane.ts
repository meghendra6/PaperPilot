import { config } from "../../package.json";
import { getLocaleID } from "../utils/locale";
import { getPref, setPref } from "../utils/prefs";
import { addMessage } from "./components/ChatMessage";
import { renderMarkdownFragment } from "./components/markdownRenderer";
import {
  clearModeOverrideForItem,
  getDefaultMode,
  getModeForItem,
  setModeOverrideForItem,
} from "./ai/modeStore";
import { getStatusLabel } from "./ai/statusLabels";
import { getProviderDescriptorForItem } from "./ai/providerRegistry";
import type { EngineMode } from "./ai/types";
import type { RunProfile } from "./ai/runProfile";
import type { StructuredOutputSchema } from "./ai/structuredOutput";
import {
  getActiveReaderRunMode,
  isReaderRunTokenActive,
  notifyReaderPaneStateChanged,
  subscribeToReaderRunEvents,
  type ReaderRunCompletionResult,
  type ReaderRunToken,
} from "./ai/runPresentation";
import { isCodexRunActiveForItem } from "./codex/runState";
import { probeWorkspaceWritable } from "./workspace/status";
import { resolvePaperWorkspaceRoot } from "./workspace/pathBuilder";
import { rememberRecentCodexModel } from "./codex/modelHistory";
import {
  normalizeClaudeModel,
  normalizeCodexModel,
  normalizeCodexReasoningEffort,
  normalizeGeminiModel,
} from "./codex/modelOptions";
import { getCurrentReaderContext } from "./context/readerContext";
import { messageStore } from "./message/messageStore";
import { sessionStore } from "./session/sessionStore";
import { sessionHistoryService } from "./session/sessionHistoryService";
import { isLikelySilentToolMessage } from "./session/silentTurnFilter";
import { probeCodexLoginState } from "./codex/status";
import { buildCodexAuthenticateMessage } from "./codex/authAction";
import { handleCodexQuestion, stopCodexRunSilently } from "./codex/controller";
import {
  handleClaudeQuestion,
  stopClaudeRunSilently,
} from "./claude/controller";
import { isClaudeRunActiveForItem } from "./claude/runState";
import {
  handleGeminiQuestion,
  stopGeminiRunSilently,
} from "./gemini/controller";
import { isGeminiRunActiveForItem } from "./gemini/runState";
import { shouldEnableAutoHighlight } from "./autoHighlight/status";
import { runAutoHighlightWorkflow } from "./autoHighlight/workflow";
import {
  addRecommendationToCollection,
  buildRelatedRunFailureState,
  buildRelatedRunProgressState,
  buildRelatedRunSuccessState,
  generateRelatedPaperGroups,
  generatePublicReviewInsight,
  openRecommendedPaper,
  type RecommendationGroup,
  type RecommendedPaper,
} from "./relatedRecommendations";
import {
  buildCriticalReadStepPrompt,
  getCriticalReadOutputSchema,
} from "./criticalRead/prompt";
import { parseCriticalReadOutput } from "./criticalRead/parser";
import { buildCriticalReadReportMarkdown } from "./criticalRead/report";
import {
  buildInitialCriticalReadState,
  canViewPublicReviewInsights,
  completeCriticalReadStep,
  attachPublicReviewInsightToCriticalRead,
  failCriticalReadStep,
  getCriticalReadStep,
  markCriticalReadStepRunning,
  reviseCriticalReadStep,
  startCriticalRead,
} from "./criticalRead/workflow";
import type { CriticalReadState } from "./criticalRead/types";
import { saveCriticalReadToNote } from "./note/criticalReadNote";
import { saveDiscoveryToNote } from "./note/discoveryNote";
import { renderCriticalReadSection } from "./ui/criticalReadSection";
import { buildDiscoveryRow } from "./ui/discoveryRow";
import { renderDiscoverySection } from "./ui/discoverySection";
import { areLikelySamePaper } from "./discovery/normalize";
import {
  buildPaperCompareCard,
  getPaperCompareButtonState,
  buildPaperCompareRequestFromRecommendations,
  getPaperCompareWorkflowState,
  parsePaperCompareResponse,
} from "./paperCompare";

const publicReviewAbortControllers = new Map<number, AbortController>();
const relatedDiscoveryAbortControllers = new Map<number, AbortController>();
const criticalReadDiscoveryAbortControllers = new Map<
  number,
  AbortController
>();

function createPaneAbortController(doc: Document) {
  const AbortControllerConstructor =
    (
      globalThis as typeof globalThis & {
        AbortController?: typeof AbortController;
      }
    ).AbortController || doc.defaultView?.AbortController;
  if (!AbortControllerConstructor) {
    throw new Error("Cancellation support is unavailable in this Zotero pane.");
  }
  return new AbortControllerConstructor();
}
import {
  buildPaperArtifactRequest,
  parsePaperArtifactCard,
  type PaperArtifactCard,
  type PaperArtifactKind,
} from "./paperArtifacts";
import {
  savePaperArtifactSetToCollection,
  savePaperArtifactToNote,
} from "./note/paperArtifactNote";
import { normalizeResponseLanguage } from "./translation/responseLanguage";
import {
  buildInitialMasteryPrompt,
  buildEvaluateAnswerPrompt,
  buildFollowUpQuestionPrompt,
  buildFinalReportPrompt,
  parseMasteryQuestionResponse,
  parseMasteryEvaluationResponse,
  MASTERY_EVALUATION_OUTPUT_SCHEMA,
  MASTERY_QUESTION_OUTPUT_SCHEMA,
} from "./comprehensionCheck/prompt";
import {
  getMasteryState,
  getMasteryStateForSession,
  setMasteryState,
  clearMasteryState,
  buildInitialMasteryState,
} from "./comprehensionCheck/status";
import {
  createCanonicalMasteryRound,
  updateCanonicalMasteryAnalytics,
} from "./comprehensionCheck/analytics";
import { createCollapsibleSection } from "./ui/collapsibleSection";
import type { PaneSectionID } from "./ui/paneSectionState";
import { createVerticalResizeHandle } from "./ui/paneResize";
import {
  CHAT_INPUT_MIN_HEIGHT,
  installChatComposerAutosize,
} from "./ui/chatComposerSizing";
import {
  disposeChatTranscriptWindow,
  renderChatTranscriptWindow,
} from "./ui/chatTranscriptWindow";
import {
  createPaneHeader,
  renderCodexOptionsRow,
  renderModeHeader,
  renderModelHistory,
  renderModelRow,
  normalizeModelForMode,
} from "./ui/paneHeader";
import {
  createRunProgressCard,
  PAPER_PILOT_PREF_PANE_ID,
  type RunProgressCardHandle,
} from "./ui/runProgressCard";
import { getRunProgressState } from "./ai/runProgress";
import { cancelActiveEngineRun } from "./ai/runControl";
import { retryLastEngineQuestion } from "./ai/retryEngineRequest";
import {
  claimChatEngineRequest,
  claimReaderSessionTransition,
  getPendingEngineCompletion,
  isReaderLifecycleClaimActive,
  releaseChatEngineRequest,
  releaseReaderSessionTransition,
} from "./ai/runLifecycle";

const paneCleanupByBody = new WeakMap<HTMLElement, () => void>();
const activePaneBodies = new Set<HTMLElement>();
const paneTemplateByBody = new WeakMap<HTMLElement, HTMLElement>();
const runProgressCardByContainer = new WeakMap<
  HTMLElement,
  RunProgressCardHandle
>();
const activeRunProgressCards = new Set<RunProgressCardHandle>();

interface ReaderPaneLayoutState {
  paneHeight?: number;
  sectionStackHeight?: number;
  sectionBodyHeights: Partial<Record<PaneSectionID, number>>;
}

const paneLayoutByBody = new WeakMap<HTMLElement, ReaderPaneLayoutState>();

export function disposeReaderPaneRunProgressCards(): void {
  for (const card of activeRunProgressCards) card.dispose();
  activeRunProgressCards.clear();
}

export function unregisterPaperPilotPaneSection(): void {
  for (const body of [...activePaneBodies]) {
    paneCleanupByBody.get(body)?.();
    paneCleanupByBody.delete(body);
    paneTemplateByBody.delete(body);
    paneLayoutByBody.delete(body);
  }
  activePaneBodies.clear();
  if (!addon.data.aiReaderPaneRegistered) return;
  try {
    Zotero.ItemPaneManager?.unregisterSection?.("paper-pilot-tabpanel");
  } catch (error) {
    Zotero.logError?.(
      error instanceof Error ? error : new Error(String(error)),
    );
  }
  addon.data.aiReaderPaneRegistered = false;
}

export function setReaderActionDraft(
  draft: NonNullable<typeof addon.data.readerActionDrafts> extends Map<
    number,
    infer Draft
  >
    ? Draft
    : never,
) {
  addon.data.readerActionDrafts?.set(draft.itemID, draft);
}

export function clearReaderActionDraft(itemID?: number) {
  if (itemID === undefined) {
    addon.data.readerActionDrafts?.clear();
  } else {
    addon.data.readerActionDrafts?.delete(itemID);
  }
}

export function registerPaperPilotPaneSection() {
  if (addon.data.aiReaderPaneRegistered) {
    return;
  }

  const result = Zotero.ItemPaneManager.registerSection({
    paneID: "paper-pilot-tabpanel",
    pluginID: config.addonID,
    header: {
      l10nID: getLocaleID("item-section-paperpilot-head-text"),
      icon: `chrome://${config.addonRef}/content/icons/favicon@0.5x.png`,
    },
    sidenav: {
      l10nID: getLocaleID("item-section-paperpilot-sidenav-tooltip"),
      icon: `chrome://${config.addonRef}/content/icons/favicon@0.5x.png`,
    },
    onItemChange: ({ setEnabled, tabType }) => {
      setEnabled(tabType === "reader");
      return true;
    },
    bodyXHTML: `
      <div id="paper-pilot-container">
        <div id="paper-pilot-header-mount"></div>
        <span id="chat-current-document" class="pp-visually-hidden"></span>
        <div id="paper-pilot-section-stack">
          <div id="paper-pilot-workbench-mount">
            <div class="pp-workbench-highlight">
              <html:button id="chat-auto-highlight" class="pp-btn pp-btn--secondary">Highlight key passages</html:button>
              <span id="chat-auto-highlight-status" class="pp-session-status"></span>
            </div>
            <div id="chat-paper-workbench">
              <html:button id="chat-research-brief" class="pp-btn pp-btn--secondary">Research brief</html:button>
              <html:button id="chat-tool-compare" class="pp-btn pp-btn--secondary">Compare</html:button>
              <html:button id="chat-tool-contributions" class="pp-btn pp-btn--secondary">Contributions</html:button>
              <html:button id="chat-tool-limitations" class="pp-btn pp-btn--secondary">Limitations</html:button>
              <html:button id="chat-tool-followups" class="pp-btn pp-btn--secondary">Follow-ups</html:button>
              <html:button id="chat-tool-save-note" class="pp-btn pp-btn--ghost">Save latest to note</html:button>
              <html:button id="chat-tool-save-collection" class="pp-btn pp-btn--ghost">Save for collection</html:button>
              <html:button id="chat-tool-clear" class="pp-btn pp-btn--ghost">Clear cards</html:button>
              <html:button id="chat-paper-mastery" class="pp-btn pp-btn--secondary">Paper Mastery</html:button>
              <html:button id="chat-critical-read" class="pp-btn pp-btn--secondary">Critical Read</html:button>
            </div>
            <div id="chat-compare-helper" class="pp-compare-helper pp-compare-helper--default" role="status" aria-live="polite" aria-atomic="true"></div>
            <div id="chat-paper-tool-status" class="pp-status-text" style="display: none;"></div>
            <div id="chat-paper-tool-cards" class="pp-tool-cards" style="display: none;"></div>
            <div id="paper-pilot-mastery-section" class="pp-mastery-panel" style="display: none;">
              <div class="pp-mastery-topic-card">
                <div id="paper-mastery-status" class="pp-mastery-status"></div>
                <div id="paper-mastery-metrics" class="pp-mastery-metrics"></div>
                <div id="paper-mastery-progress" class="pp-mastery-progress"></div>
              </div>
              <div id="paper-mastery-question" class="pp-mastery-question" style="display: none;"></div>
              <div id="paper-mastery-feedback" class="pp-mastery-feedback" style="display: none;"></div>
              <div id="paper-mastery-report" class="pp-mastery-report" style="display: none;"></div>
              <html:textarea id="paper-mastery-answer" class="pp-mastery-answer" placeholder="Type your answer here..." style="display: none;" />
              <label id="paper-mastery-confidence-row" class="pp-mastery-confidence" style="display: none;">
                Confidence before grading
                <html:input id="paper-mastery-confidence" type="range" min="0" max="1" step="0.05" value="0.7" />
                <span id="paper-mastery-confidence-value">70%</span>
              </label>
              <div id="paper-mastery-actions" class="pp-mastery-actions" style="display: none;">
                <html:button id="paper-mastery-submit" class="pp-btn pp-btn--primary">Submit Answer</html:button>
                <html:button id="paper-mastery-end" class="pp-btn pp-btn--ghost">End Session</html:button>
              </div>
            </div>
            <div id="paper-pilot-critical-read" class="pp-critical-read" style="display: none;"></div>
          </div>
          <div id="paper-pilot-related-mount">
            <label for="chat-related-concern" class="pp-related-concern-label">Research concern or idea</label>
            <html:textarea id="chat-related-concern" class="pp-related-concern" placeholder="Optional: describe the research concern or novelty question." />
            <html:button id="chat-related-recommend" class="pp-btn pp-btn--secondary">Find verified prior work</html:button>
            <html:button id="chat-related-save" class="pp-btn pp-btn--ghost" disabled="true">Save discovery note</html:button>
            <div class="pp-related-disclosure">Paper Pilot infers the field and leading venues, then verifies main-track acceptance from official paper-level sources. Workshops and preprints stay in separate lanes.</div>
            <div id="chat-related-status" class="pp-status-text" style="display: none;"></div>
            <div id="chat-related-groups" style="display: none;"></div>
          </div>
          <div id="paper-pilot-sessions-mount">
            <div id="paper-pilot-session-history" class="pp-session-history"></div>
          </div>
        </div>
        <div id="paper-pilot-run-state" class="pp-run-state" style="display: none;"></div>
        <div id="chat-streaming-indicator" class="pp-streaming" role="status" aria-live="polite" aria-atomic="true" style="display: none;">
          <span class="pp-streaming-dot"></span>
          <span class="pp-streaming-dot"></span>
          <span class="pp-streaming-dot"></span>
          <span class="pp-streaming-text">Thinking…</span>
        </div>
        <div id="chat-messages" role="log" aria-live="polite" aria-relevant="additions text" aria-label="Paper conversation"></div>
        <div id="paper-pilot-composer">
          <div id="paper-pilot-draft" class="pp-status-card pp-status-card--draft" style="display: none;"></div>
          <div id="chat-input-shell">
            <html:textarea id="chat-input" placeholder="Ask a question about this paper or the current selection."/>
            <html:button id="chat-send" class="pp-btn pp-btn--primary" aria-label="Send message">Send</html:button>
          </div>
        </div>
      </div>
    `,
    onRender: ({ body, item, setSectionSummary: setHostSectionSummary }) => {
      paneCleanupByBody.get(body)?.();
      const template = paneTemplateByBody.get(body);
      if (template) {
        body.replaceChildren(
          ...Array.from(template.childNodes, (node) => node!.cloneNode(true)),
        );
      } else {
        paneTemplateByBody.set(body, body.cloneNode(true) as HTMLElement);
      }

      const paneLayout = paneLayoutByBody.get(body) || {
        sectionBodyHeights: {},
      };
      paneLayoutByBody.set(body, paneLayout);
      const paneContainer = body.querySelector(
        "#paper-pilot-container",
      ) as HTMLElement;
      const sectionStack = body.querySelector(
        "#paper-pilot-section-stack",
      ) as HTMLElement;
      const getPaneHeight = () =>
        paneContainer.getBoundingClientRect().height || 720;
      const getSectionBodyMaxHeight = () =>
        Math.max(360, getPaneHeight() - 180);
      const paneResize = createVerticalResizeHandle({
        doc: body.ownerDocument,
        target: paneContainer,
        label: "Resize Paper Pilot pane",
        minHeight: 560,
        getMaxHeight: () =>
          Math.max(
            1200,
            (body.ownerDocument.defaultView?.innerHeight || 800) * 2,
          ),
        initialHeight: paneLayout.paneHeight,
        onHeightChange: (height) => {
          paneLayout.paneHeight = height;
        },
      });
      paneResize.root.id = "paper-pilot-pane-resize";
      paneResize.root.classList.add("pp-resize-handle--pane");

      const headerMount = body.querySelector(
        "#paper-pilot-header-mount",
      ) as HTMLElement;
      const paneHeader = createPaneHeader({
        doc: body.ownerDocument,
        mount: headerMount,
      });

      const mountSection = (
        mountID: string,
        section: ReturnType<typeof createCollapsibleSection>,
      ) => {
        const mount = body.querySelector(mountID) as HTMLElement;
        while (mount.firstChild) {
          section.body.appendChild(mount.firstChild);
        }
        mount.replaceWith(section.root);
      };
      const workbenchSection = createCollapsibleSection({
        doc: body.ownerDocument,
        id: "workbench",
        title: "Workbench",
        defaultExpanded: true,
        initialBodyHeight: paneLayout.sectionBodyHeights.workbench,
        getMaxBodyHeight: getSectionBodyMaxHeight,
        onBodyHeightChange: (height) => {
          paneLayout.sectionBodyHeights.workbench = height;
        },
      });
      const relatedSection = createCollapsibleSection({
        doc: body.ownerDocument,
        id: "related",
        title: "Related papers",
        defaultExpanded: false,
        initialBodyHeight: paneLayout.sectionBodyHeights.related,
        getMaxBodyHeight: getSectionBodyMaxHeight,
        onBodyHeightChange: (height) => {
          paneLayout.sectionBodyHeights.related = height;
        },
      });
      const sessionsSection = createCollapsibleSection({
        doc: body.ownerDocument,
        id: "sessions",
        title: "Past sessions",
        defaultExpanded: false,
        initialBodyHeight: paneLayout.sectionBodyHeights.sessions,
        getMaxBodyHeight: getSectionBodyMaxHeight,
        onBodyHeightChange: (height) => {
          paneLayout.sectionBodyHeights.sessions = height;
        },
      });
      mountSection("#paper-pilot-workbench-mount", workbenchSection);
      mountSection("#paper-pilot-related-mount", relatedSection);
      mountSection("#paper-pilot-sessions-mount", sessionsSection);

      const workspaceResize = createVerticalResizeHandle({
        doc: body.ownerDocument,
        target: sectionStack,
        label: "Resize Workbench and chat areas",
        minHeight: 132,
        getMaxHeight: () => Math.max(240, getPaneHeight() - 280),
        initialHeight: paneLayout.sectionStackHeight,
        onHeightChange: (height) => {
          paneLayout.sectionStackHeight = height;
        },
      });
      workspaceResize.root.id = "paper-pilot-workspace-resize";
      workspaceResize.root.classList.add("pp-resize-handle--workspace");
      sectionStack.after(workspaceResize.root);

      paneContainer.append(paneResize.root);

      const cleanupTasks: Array<() => void> = [
        () => paneHeader.dispose(),
        () => workbenchSection.dispose(),
        () => relatedSection.dispose(),
        () => sessionsSection.dispose(),
        () => workspaceResize.dispose(),
        () => paneResize.dispose(),
      ];
      let disposed = false;
      const isCurrentRender = () => !disposed;
      const setSectionSummary = (summary: string) => {
        if (isCurrentRender()) setHostSectionSummary(summary);
      };
      const cleanup = () => {
        if (disposed) return;
        disposed = true;
        activePaneBodies.delete(body);
        // Controllers are item-scoped rather than pane-scoped so a rebuilt
        // pane can still cancel the active task. Do not abort them here.
        for (const task of cleanupTasks) task();
      };
      paneCleanupByBody.set(body, cleanup);
      activePaneBodies.add(body);

      const chatContainer = body.querySelector(
        "#paper-pilot-container",
      ) as HTMLElement;
      body.style.display = "flex";
      body.style.flexDirection = "column";
      body.style.minHeight = "0";
      body.style.overflow = "hidden";
      const input = body.querySelector("#chat-input") as HTMLTextAreaElement;
      const sendButton = body.querySelector("#chat-send") as HTMLButtonElement;
      const chatMessages = body.querySelector("#chat-messages") as HTMLElement;
      if (chatMessages) {
        cleanupTasks.push(() => disposeChatTranscriptWindow(chatMessages));
      }
      const draftCard = body.querySelector("#paper-pilot-draft") as HTMLElement;
      const streamingIndicator = body.querySelector(
        "#chat-streaming-indicator",
      ) as HTMLElement;
      const {
        modeChip,
        modeStatus,
        modeGeminiButton,
        modeClaudeButton,
        modeCodexButton,
        modeResetButton,
        newSessionButton,
        codexActions,
        codexAuthButton,
        codexDeviceAuthButton,
        codexRecheckButton,
        codexRetryButton,
        codexCancelButton,
        policyWarning,
        geminiFallbackCard,
        geminiEmbedCard,
        modelRow,
        modelInput,
        modelSaveButton,
        codexOptionsRow,
        codexWebSearchToggle,
        modelHistory,
      } = paneHeader;
      const runStateCard = body.querySelector(
        "#paper-pilot-run-state",
      ) as HTMLElement;
      const currentDocumentLabel = body.querySelector(
        "#chat-current-document",
      ) as HTMLElement;
      const autoHighlightStatus = body.querySelector(
        "#chat-auto-highlight-status",
      ) as HTMLElement;
      const autoHighlightButton = body.querySelector(
        "#chat-auto-highlight",
      ) as HTMLButtonElement;
      const pastSessionsButton = sessionsSection.root.querySelector(
        "[data-pp-section-trigger]",
      ) as HTMLButtonElement;
      const sessionHistoryPanel = body.querySelector(
        "#paper-pilot-session-history",
      ) as HTMLElement;
      const relatedRecommendButton = body.querySelector(
        "#chat-related-recommend",
      ) as HTMLButtonElement;
      const researchBriefButton = body.querySelector(
        "#chat-research-brief",
      ) as HTMLButtonElement;
      const compareButton = body.querySelector(
        "#chat-tool-compare",
      ) as HTMLButtonElement;
      const contributionsButton = body.querySelector(
        "#chat-tool-contributions",
      ) as HTMLButtonElement;
      const limitationsButton = body.querySelector(
        "#chat-tool-limitations",
      ) as HTMLButtonElement;
      const followUpsButton = body.querySelector(
        "#chat-tool-followups",
      ) as HTMLButtonElement;
      const saveWorkbenchNoteButton = body.querySelector(
        "#chat-tool-save-note",
      ) as HTMLButtonElement;
      const saveWorkbenchCollectionButton = body.querySelector(
        "#chat-tool-save-collection",
      ) as HTMLButtonElement;
      const clearWorkbenchButton = body.querySelector(
        "#chat-tool-clear",
      ) as HTMLButtonElement;
      const paperToolStatus = body.querySelector(
        "#chat-paper-tool-status",
      ) as HTMLElement;
      const compareHelper = body.querySelector(
        "#chat-compare-helper",
      ) as HTMLElement;
      const paperToolCards = body.querySelector(
        "#chat-paper-tool-cards",
      ) as HTMLElement;
      const relatedStatus = body.querySelector(
        "#chat-related-status",
      ) as HTMLElement;
      const relatedGroups = body.querySelector(
        "#chat-related-groups",
      ) as HTMLElement;
      const masterySection = body.querySelector(
        "#paper-pilot-mastery-section",
      ) as HTMLElement | null;
      const masteryStatus = body.querySelector(
        "#paper-mastery-status",
      ) as HTMLElement | null;
      const masteryProgress = body.querySelector(
        "#paper-mastery-progress",
      ) as HTMLElement | null;
      const masteryMetrics = body.querySelector(
        "#paper-mastery-metrics",
      ) as HTMLElement | null;
      const masteryQuestion = body.querySelector(
        "#paper-mastery-question",
      ) as HTMLElement | null;
      const masteryFeedback = body.querySelector(
        "#paper-mastery-feedback",
      ) as HTMLElement | null;
      const masteryAnswer = body.querySelector(
        "#paper-mastery-answer",
      ) as HTMLTextAreaElement | null;
      const masteryConfidenceRow = body.querySelector(
        "#paper-mastery-confidence-row",
      ) as HTMLElement | null;
      const masteryConfidence = body.querySelector(
        "#paper-mastery-confidence",
      ) as HTMLInputElement | null;
      const masteryConfidenceValue = body.querySelector(
        "#paper-mastery-confidence-value",
      ) as HTMLElement | null;
      const masterySubmit = body.querySelector(
        "#paper-mastery-submit",
      ) as HTMLButtonElement | null;
      const masteryEnd = body.querySelector(
        "#paper-mastery-end",
      ) as HTMLButtonElement | null;
      const masteryReport = body.querySelector(
        "#paper-mastery-report",
      ) as HTMLElement | null;
      const paperMasteryBtn = body.querySelector(
        "#chat-paper-mastery",
      ) as HTMLButtonElement | null;
      const criticalReadButton = body.querySelector(
        "#chat-critical-read",
      ) as HTMLButtonElement | null;
      const criticalReadRoot = body.querySelector(
        "#paper-pilot-critical-read",
      ) as HTMLElement | null;
      const relatedConcern = body.querySelector(
        "#chat-related-concern",
      ) as HTMLTextAreaElement | null;
      const relatedSaveButton = body.querySelector(
        "#chat-related-save",
      ) as HTMLButtonElement | null;

      if (
        chatContainer &&
        input &&
        sendButton &&
        chatMessages &&
        draftCard &&
        streamingIndicator &&
        modeChip &&
        modeStatus &&
        modeGeminiButton &&
        modeClaudeButton &&
        modeCodexButton &&
        modeResetButton &&
        runStateCard &&
        currentDocumentLabel &&
        autoHighlightStatus &&
        autoHighlightButton &&
        newSessionButton &&
        pastSessionsButton &&
        sessionHistoryPanel &&
        relatedRecommendButton &&
        relatedConcern &&
        relatedSaveButton &&
        criticalReadButton &&
        criticalReadRoot &&
        researchBriefButton &&
        compareButton &&
        contributionsButton &&
        limitationsButton &&
        followUpsButton &&
        saveWorkbenchNoteButton &&
        saveWorkbenchCollectionButton &&
        clearWorkbenchButton &&
        paperToolStatus &&
        compareHelper &&
        paperToolCards &&
        relatedStatus &&
        relatedGroups &&
        codexActions &&
        codexAuthButton &&
        codexDeviceAuthButton &&
        codexRecheckButton &&
        codexRetryButton &&
        codexCancelButton &&
        policyWarning &&
        geminiFallbackCard &&
        geminiEmbedCard &&
        modelRow &&
        modelInput &&
        modelSaveButton &&
        codexOptionsRow &&
        codexWebSearchToggle &&
        modelHistory
      ) {
        const workbenchElements: WorkbenchElements = {
          researchBriefButton,
          contributionsButton,
          limitationsButton,
          followUpsButton,
          saveWorkbenchNoteButton,
          saveWorkbenchCollectionButton,
          clearWorkbenchButton,
          statusElement: paperToolStatus,
          cardsElement: paperToolCards,
        };
        const runProgressCard = createRunProgressCard({
          container: runStateCard,
          actions: {
            onCancel: async () => {
              const state = getRunProgressState(item.id);
              const cancelled = await cancelActiveEngineRun(item.id);
              const updatedState = getRunProgressState(item.id);
              addMessage(
                chatMessages,
                cancelled
                  ? `${getModeLabel(state?.engine ?? getModeForItem(item.id))} run cancelled.`
                  : updatedState?.failure?.userMessage ||
                      "No cancellable run is active for this paper.",
                "ai",
              );
              renderStreamingIndicator(
                streamingIndicator,
                Boolean(getActiveReaderRunMode(item.id)),
              );
              runProgressCard.render(getRunProgressState(item.id));
            },
            onRetry: () =>
              retryLastEngineQuestion({
                itemID: item.id,
                itemTitle: String(item.getField("title") || ""),
                chatMessages,
                streamingIndicator,
              }),
            onOpenSettings: () => {
              Zotero.Utilities.Internal.openPreferences(
                PAPER_PILOT_PREF_PANE_ID,
              );
            },
            onShowLoginHelp: (engine) => {
              const command =
                engine === "codex_cli"
                  ? "codex login"
                  : engine === "claude_code"
                    ? "claude /login"
                    : "configure GEMINI_API_KEY or run gemini auth";
              addMessage(
                chatMessages,
                `Authenticate in a terminal with ${command}, then retry the request.`,
                "ai",
              );
            },
          },
        });
        runProgressCardByContainer.set(runStateCard, runProgressCard);
        activeRunProgressCards.add(runProgressCard);
        cleanupTasks.push(() => {
          runProgressCard.dispose();
          activeRunProgressCards.delete(runProgressCard);
          runProgressCardByContainer.delete(runStateCard);
        });
        runProgressCard.render(getRunProgressState(item.id));

        let sessionHistoryOpen = sessionsSection.isExpanded();
        let renamingSessionId: string | undefined;

        const beginSessionRuntimeTransition = async () => {
          const activeMode = getActiveReaderRunMode(item.id);
          const lifecycleReserved = Boolean(
            getPendingEngineCompletion(item.id) ||
              isReaderLifecycleClaimActive(item.id),
          );
          if (activeMode || lifecycleReserved) {
            addMessage(
              chatMessages,
              `${getModeLabel(activeMode ?? getModeForItem(item.id))} is still running or finishing for this paper. Wait for it to settle before changing sessions.`,
              "ai",
            );
            return undefined;
          }
          const transitionToken = claimReaderSessionTransition(item.id);
          if (!transitionToken) return undefined;
          try {
            await stopCodexRunSilently({
              itemID: item.id,
            });
            await stopClaudeRunSilently({
              itemID: item.id,
            });
            await stopGeminiRunSilently({
              itemID: item.id,
            });
            clearReaderActionDraft(item.id);
            addon.data.pendingReaderActions?.delete(item.id);
            addon.data.pendingDiscoveryConcerns?.delete(item.id);
            renderStreamingIndicator(streamingIndicator, false);
            return transitionToken;
          } catch (error) {
            releaseReaderSessionTransition(item.id, transitionToken);
            addon.data.ztoolkit?.log(
              "Paper Pilot session transition cleanup failed:",
              error,
            );
            addMessage(
              chatMessages,
              "Paper Pilot could not safely change sessions because a local process could not be stopped. Try Cancel again or restart Zotero.",
              "ai",
            );
            return undefined;
          }
        };

        const runSessionRuntimeTransition = async (
          action: () => void | Promise<void>,
        ) => {
          const transitionToken = await beginSessionRuntimeTransition();
          if (!transitionToken) return false;
          try {
            await action();
            return true;
          } finally {
            releaseReaderSessionTransition(item.id, transitionToken);
          }
        };

        const resetBlankSessionState = () => {
          setPaperArtifactState(item.id, {
            running: false,
            status: "",
            cards: [],
          });
          addon.data.relatedRecommendationStates?.delete(item.id);
          clearMasteryState(item.id);
          addon.data.criticalReadStates?.delete(item.id);
          input.value = "";
        };

        const updateWorkbenchSummary = (markUpdated = false) => {
          const cardCount = getPaperArtifactState(item.id).cards.length;
          workbenchSection.setSummary(cardCount ? `cards ${cardCount}` : "");
          if (markUpdated) workbenchSection.markUpdated();
        };
        const updateRelatedSummary = (markUpdated = false) => {
          const count = (
            addon.data.relatedRecommendationStates?.get(item.id)?.groups ?? []
          ).reduce((total, group) => total + group.papers.length, 0);
          relatedSection.setSummary(count ? String(count) : "");
          if (markUpdated) relatedSection.markUpdated();
        };

        const getCriticalReadStateForItem = () => {
          const paperTitle = String(item.getField("title") || "");
          const sessionID = sessionStore.getOrCreate(
            item.id,
            getModeForItem(item.id),
            paperTitle,
          ).sessionId;
          const stored = addon.data.criticalReadStates?.get(item.id);
          if (stored?.sessionID === sessionID) {
            if (stored.phase === "complete" && !stored.reportMarkdown) {
              const rebuilt = {
                ...stored,
                reportMarkdown: buildCriticalReadReportMarkdown({
                  paperTitle,
                  state: stored,
                }),
              };
              addon.data.criticalReadStates!.set(item.id, rebuilt);
              return rebuilt;
            }
            return stored;
          }
          return buildInitialCriticalReadState(undefined, {
            itemID: item.id,
            sessionID,
          });
        };
        const setCriticalReadStateForItem = (state: CriticalReadState) => {
          if (!addon.data.criticalReadStates) {
            addon.data.criticalReadStates = new Map();
          }
          addon.data.criticalReadStates.set(item.id, state);
          if (!canViewPublicReviewInsights(state)) {
            publicReviewAbortControllers
              .get(item.id)
              ?.abort(
                new Error("Public-review analysis closed by Critical Read."),
              );
          }
          renderRelatedRecommendationState(
            relatedRecommendButton,
            relatedStatus,
            relatedGroups,
            compareButton,
            compareHelper,
            item.id,
            String(item.getField("title") || ""),
          );
        };
        const persistCriticalReadState = async () => {
          await sessionHistoryService.persistActiveSession({
            itemID: item.id,
            paperTitle: String(item.getField("title") || ""),
          });
          notifyReaderPaneStateChanged(item.id);
        };

        const renderCriticalRead = () => {
          const state = getCriticalReadStateForItem();
          criticalReadButton.textContent =
            state.phase === "idle"
              ? "Critical Read"
              : state.phase === "complete"
                ? "Critical Read · Complete"
                : `Critical Read · ${state.steps.filter((step) => step.status === "complete").length}/7`;
          renderCriticalReadSection({
            root: criticalReadRoot,
            state,
            actions: {
              onCancel: async () => {
                const discoveryController =
                  criticalReadDiscoveryAbortControllers.get(item.id);
                if (discoveryController) {
                  discoveryController.abort();
                  const current = getCriticalReadStateForItem();
                  setCriticalReadStateForItem({
                    ...current,
                    status: "Cancelling Critical Read prior-work search…",
                    updatedAt: new Date().toISOString(),
                  });
                  renderCriticalRead();
                  return;
                }
                await cancelActiveEngineRun(item.id);
              },
              onStartMastery: () => {
                paperMasteryBtn?.click();
              },
              onStart: async () => {
                let orientations: ReturnType<
                  typeof import("./criticalRead/orientation").buildCriticalReadOrientations
                > = {};
                try {
                  const [
                    { paperWorkspaceContentCache },
                    { buildCriticalReadOrientations },
                  ] = await Promise.all([
                    import("./tools/paperWorkspaceContent"),
                    import("./criticalRead/orientation"),
                  ]);
                  const content =
                    await paperWorkspaceContentCache.getPaperContent(item);
                  orientations = buildCriticalReadOrientations({
                    ...content,
                    abstract: String(item.getField("abstractNote") || ""),
                  });
                } catch {
                  const { buildCriticalReadOrientations } = await import(
                    "./criticalRead/orientation"
                  );
                  orientations = buildCriticalReadOrientations({});
                }
                const started = startCriticalRead(state);
                setCriticalReadStateForItem({
                  ...started,
                  steps: started.steps.map((step) => ({
                    ...step,
                    orientation:
                      step.id === 1 || step.id === 4 || step.id === 5
                        ? orientations[step.id]
                        : undefined,
                  })),
                });
                renderCriticalRead();
                await persistCriticalReadState();
              },
              onRevise: async (stepID) => {
                const promptService = (
                  globalThis as {
                    Services?: {
                      prompt?: {
                        confirm?: (
                          parent: unknown,
                          title: string,
                          message: string,
                        ) => boolean;
                      };
                    };
                  }
                ).Services?.prompt;
                const confirmed =
                  promptService?.confirm?.(
                    null,
                    "Revise Critical Read step",
                    stepID === 2
                      ? "Replace Step 2 and invalidate its prior-work map? Your unrelated methodology and conclusion work will be preserved."
                      : stepID === 5
                        ? "Replace Step 5 and invalidate the author comparison? Your other completed work will be preserved."
                        : `Replace Step ${stepID}? Unrelated completed steps will be preserved.`,
                  ) ?? false;
                if (!confirmed) return;
                setCriticalReadStateForItem(
                  reviseCriticalReadStep(getCriticalReadStateForItem(), stepID),
                );
                renderCriticalRead();
                await persistCriticalReadState();
              },
              onSave: async () => {
                const current = getCriticalReadStateForItem();
                try {
                  const note = await saveCriticalReadToNote({
                    item,
                    paperTitle: String(
                      item.getField("title") || "Current paper",
                    ),
                    state: current,
                  });
                  setCriticalReadStateForItem({
                    ...current,
                    reportNoteItemID: note.id,
                    status: "Critical Read report saved to a Zotero note.",
                    updatedAt: new Date().toISOString(),
                  });
                } catch (error) {
                  setCriticalReadStateForItem({
                    ...current,
                    status:
                      error instanceof Error
                        ? `Save failed: ${error.message}`
                        : "Critical Read report could not be saved.",
                    updatedAt: new Date().toISOString(),
                  });
                }
                renderCriticalRead();
                await persistCriticalReadState();
              },
              onRun: async (readerInput) => {
                const current = getCriticalReadStateForItem();
                const step = getCriticalReadStep(current);
                if (!step) return;
                if (step.requiresReaderInput && !readerInput.trim()) {
                  setCriticalReadStateForItem(
                    failCriticalReadStep(
                      current,
                      "Write your own assessment before running this step.",
                    ),
                  );
                  renderCriticalRead();
                  return;
                }

                if (step.id === 3) {
                  let reserved = false;
                  const abortController = createPaneAbortController(
                    criticalReadRoot.ownerDocument,
                  );
                  criticalReadDiscoveryAbortControllers.set(
                    item.id,
                    abortController,
                  );
                  try {
                    await generateRelatedPaperGroups({
                      itemID: item.id,
                      itemTitle: String(item.getField("title") || ""),
                      concern: {
                        origin: "user_text",
                        text:
                          getCriticalReadStateForItem().steps.find(
                            (entry) => entry.id === 2,
                          )?.readerInput ||
                          "Find prior work for the paper's core research question.",
                      },
                      signal: abortController.signal,
                      onReserved: () => {
                        reserved = true;
                        setCriticalReadStateForItem(
                          markCriticalReadStepRunning(current),
                        );
                        renderCriticalRead();
                      },
                      onStatus: (status) => {
                        const running = getCriticalReadStateForItem();
                        setCriticalReadStateForItem({
                          ...running,
                          status,
                          updatedAt: new Date().toISOString(),
                        });
                        renderCriticalRead();
                      },
                      onSuccess: async (result) => {
                        if (!result.discovery) {
                          throw new Error(
                            "The discovery run did not return verified publication evidence.",
                          );
                        }
                        const completed = completeCriticalReadStep({
                          state: getCriticalReadStateForItem(),
                          discovery: result.discovery,
                        });
                        setCriticalReadStateForItem(completed);
                        addon.data.relatedRecommendationStates?.set(item.id, {
                          sessionID: sessionStore.get(item.id)?.sessionId,
                          running: false,
                          status: "Critical Read prior-work map ready",
                          groups: result.groups,
                          discovery: result.discovery,
                          concern:
                            current.steps.find((entry) => entry.id === 2)
                              ?.readerInput || "",
                        });
                        renderRelatedRecommendationState(
                          relatedRecommendButton,
                          relatedStatus,
                          relatedGroups,
                          compareButton,
                          compareHelper,
                          item.id,
                        );
                        renderCriticalRead();
                        await persistCriticalReadState();
                      },
                      onFailure: async (error) => {
                        setCriticalReadStateForItem(
                          failCriticalReadStep(
                            getCriticalReadStateForItem(),
                            error instanceof Error
                              ? error.message
                              : "Prior-work discovery failed.",
                          ),
                        );
                        renderCriticalRead();
                        await persistCriticalReadState();
                      },
                    });
                  } catch (error) {
                    if (!reserved) {
                      setCriticalReadStateForItem(
                        failCriticalReadStep(
                          current,
                          error instanceof Error
                            ? error.message
                            : "Prior-work discovery could not start.",
                        ),
                      );
                      renderCriticalRead();
                    }
                  } finally {
                    if (
                      criticalReadDiscoveryAbortControllers.get(item.id) ===
                      abortController
                    ) {
                      criticalReadDiscoveryAbortControllers.delete(item.id);
                    }
                  }
                  return;
                }

                await runCriticalReadAgentRequest({
                  item,
                  state: current,
                  readerInput,
                  input,
                  chatMessages,
                  streamingIndicator,
                  onAdmitted: () => {
                    setCriticalReadStateForItem(
                      markCriticalReadStepRunning(current, readerInput),
                    );
                    renderCriticalRead();
                  },
                  onComplete: async ({ success, assistantText }) => {
                    let nextState: CriticalReadState;
                    if (!success) {
                      nextState = failCriticalReadStep(
                        getCriticalReadStateForItem(),
                        assistantText || "Critical Read step failed.",
                      );
                    } else {
                      try {
                        nextState = completeCriticalReadStep({
                          state: getCriticalReadStateForItem(),
                          output: parseCriticalReadOutput(
                            assistantText,
                            step.id as Exclude<typeof step.id, 3>,
                          ),
                        });
                        if (nextState.phase === "complete") {
                          nextState = {
                            ...nextState,
                            reportMarkdown: buildCriticalReadReportMarkdown({
                              paperTitle: String(
                                item.getField("title") || "Current paper",
                              ),
                              state: nextState,
                            }),
                          };
                        }
                      } catch (error) {
                        nextState = failCriticalReadStep(
                          getCriticalReadStateForItem(),
                          error instanceof Error
                            ? error.message
                            : "Critical Read output could not be parsed.",
                        );
                      }
                    }
                    setCriticalReadStateForItem(nextState);
                    renderCriticalRead();
                    await persistCriticalReadState();
                  },
                });
              },
            },
          });
        };

        criticalReadButton.addEventListener("click", () => {
          const visible = criticalReadRoot.style.display !== "none";
          criticalReadRoot.style.display = visible ? "none" : "block";
          if (!visible) renderCriticalRead();
        });
        if (addon.data.criticalReadStates?.has(item.id)) {
          criticalReadRoot.style.display = "block";
        }
        renderCriticalRead();

        const rerenderPane = async () => {
          await renderPaneState({
            itemID: item.id,
            itemTitle: item.getField("title"),
            currentDocumentLabel,
            autoHighlightStatus,
            autoHighlightButton,
            researchBriefButton,
            contributionsButton,
            limitationsButton,
            followUpsButton,
            compareButton,
            compareHelper,
            saveWorkbenchNoteButton,
            saveWorkbenchCollectionButton,
            clearWorkbenchButton,
            paperToolStatus,
            paperToolCards,
            modeChip,
            modeStatus,
            runStateCard,
            codexActions,
            policyWarning,
            geminiFallbackCard,
            geminiEmbedCard,
            modelRow,
            modelInput,
            codexOptionsRow,
            codexWebSearchToggle,
            modelHistory,
            chatMessages,
            draftCard,
            streamingIndicator,
            setSectionSummary,
            isCurrent: isCurrentRender,
          });
          if (disposed) return;
          renderRelatedRecommendationState(
            relatedRecommendButton,
            relatedStatus,
            relatedGroups,
            compareButton,
            compareHelper,
            item.id,
            String(item.getField("title") || ""),
          );
          relatedConcern.value =
            getRelatedRecommendationState(item.id).concern || "";
          renderCriticalRead();
          await renderSessionHistory();
          if (disposed) return;
          updateWorkbenchSummary();
          updateRelatedSummary();
          hydrateMasteryState();
        };

        const renderSessionHistory = async () => {
          const entries = await sessionHistoryService.listSavedSessions({
            itemID: item.id,
          });
          sessionsSection.setSummary(
            entries.length ? String(entries.length) : "",
          );

          if (!sessionHistoryOpen) {
            sessionHistoryPanel.style.display = "none";
            sessionHistoryPanel.replaceChildren();
            renamingSessionId = undefined;
            return;
          }

          const doc = sessionHistoryPanel.ownerDocument;
          sessionHistoryPanel.style.display = "block";
          sessionHistoryPanel.replaceChildren();

          let activeKebabClose: (() => void) | undefined;

          if (entries.length) {
            const header = doc.createElement("div");
            header.className = "pp-session-history__header";
            const headerActions = doc.createElement("div");
            headerActions.className = "pp-session-history__actions";
            const deleteAllButton = doc.createElement("button");
            deleteAllButton.type = "button";
            deleteAllButton.className = "pp-btn pp-btn--ghost";
            deleteAllButton.textContent = "Delete all";
            deleteAllButton.addEventListener("click", async () => {
              if (
                !confirmDestructive(
                  pastSessionsButton.ownerDocument,
                  "Delete all sessions",
                  "Delete all saved sessions for this paper? This cannot be undone.",
                )
              ) {
                return;
              }
              await runSessionRuntimeTransition(async () => {
                resetBlankSessionState();
                await sessionHistoryService.deleteAllSavedSessions({
                  itemID: item.id,
                });
                sessionHistoryOpen = false;
                sessionsSection.setExpanded(false);
                await rerenderPane();
              });
            });
            headerActions.appendChild(deleteAllButton);
            header.appendChild(headerActions);
            sessionHistoryPanel.appendChild(header);
          }

          if (!entries.length) {
            const emptyState = doc.createElement("div");
            emptyState.className = "pp-session-history__empty";
            emptyState.textContent = "No saved sessions for this paper yet.";
            sessionHistoryPanel.appendChild(emptyState);
            return;
          }

          const currentSessionId = sessionStore.get(item.id)?.sessionId;

          for (const entry of entries) {
            const row = doc.createElement("div");
            row.className = "pp-session-history__item";
            row.title = `Created ${new Date(entry.createdAt).toLocaleString()}`;

            const info = doc.createElement("div");
            info.className = "pp-session-history__info";

            const titleRow = doc.createElement("div");
            titleRow.className = "pp-session-history__item-header";

            if (renamingSessionId === entry.sessionId) {
              const renameInput = doc.createElement("input");
              renameInput.className = "pp-session-history__rename-input";
              renameInput.value = entry.title;
              titleRow.appendChild(renameInput);

              const saveRenameButton = doc.createElement("button");
              saveRenameButton.type = "button";
              saveRenameButton.className = "pp-btn pp-btn--secondary";
              saveRenameButton.textContent = "Save";
              saveRenameButton.addEventListener("click", async () => {
                await sessionHistoryService.renameSavedSession({
                  itemID: item.id,
                  sessionId: entry.sessionId,
                  title: renameInput.value,
                });
                renamingSessionId = undefined;
                await renderSessionHistory();
              });
              titleRow.appendChild(saveRenameButton);

              const cancelRenameButton = doc.createElement("button");
              cancelRenameButton.type = "button";
              cancelRenameButton.className = "pp-btn pp-btn--ghost";
              cancelRenameButton.textContent = "Cancel";
              cancelRenameButton.addEventListener("click", async () => {
                renamingSessionId = undefined;
                await renderSessionHistory();
              });
              titleRow.appendChild(cancelRenameButton);
            } else {
              const entryTitle = doc.createElement("div");
              entryTitle.className = "pp-session-history__item-title";
              entryTitle.textContent = entry.title;
              titleRow.appendChild(entryTitle);

              if (currentSessionId === entry.sessionId) {
                const currentBadge = doc.createElement("span");
                currentBadge.className = "pp-session-history__badge";
                currentBadge.textContent = "Current";
                titleRow.appendChild(currentBadge);
              }

              if (
                entry.hasArtifacts ||
                entry.hasRecommendations ||
                entry.hasMasteryState ||
                entry.hasCriticalReadState
              ) {
                const cardsBadge = doc.createElement("span");
                cardsBadge.className = "pp-session-history__badge";
                cardsBadge.textContent = "●";
                cardsBadge.setAttribute(
                  "aria-label",
                  "Has saved cards, discovery, Critical Read, or mastery state",
                );
                titleRow.appendChild(cardsBadge);
              }
            }

            info.appendChild(titleRow);

            const meta = doc.createElement("div");
            meta.className = "pp-session-history__meta";
            meta.textContent = [
              `Updated ${new Date(entry.updatedAt).toLocaleString()}`,
              `${entry.messageCount} msg${entry.messageCount === 1 ? "" : "s"}`,
              getModeShortLabel(entry.lastMode),
            ].join(" · ");
            info.appendChild(meta);

            row.appendChild(info);

            if (renamingSessionId === entry.sessionId) {
              sessionHistoryPanel.appendChild(row);
              continue;
            }

            const rowActions = doc.createElement("div");
            rowActions.className = "pp-session-history__row-actions";

            const openButton = doc.createElement("button");
            openButton.type = "button";
            openButton.className = "pp-btn pp-btn--secondary";
            openButton.textContent = "Open";
            openButton.disabled = currentSessionId === entry.sessionId;
            openButton.addEventListener("click", async () => {
              await runSessionRuntimeTransition(async () => {
                await sessionHistoryService.openSavedSession({
                  itemID: item.id,
                  sessionId: entry.sessionId,
                });
                input.value = "";
                sessionHistoryOpen = false;
                sessionsSection.setExpanded(false);
                renamingSessionId = undefined;
                await rerenderPane();
              });
            });
            rowActions.appendChild(openButton);

            const kebabContainer = doc.createElement("div");
            kebabContainer.className = "pp-session-history__kebab";

            const kebabButton = doc.createElement("button");
            kebabButton.type = "button";
            kebabButton.className = "pp-btn pp-btn--ghost";
            kebabButton.textContent = "⋯";
            kebabButton.setAttribute(
              "aria-label",
              `More actions for session "${entry.title}"`,
            );

            let kebabMenu: HTMLElement | undefined;
            const closeKebab = () => {
              kebabMenu?.remove();
              kebabMenu = undefined;
              if (activeKebabClose === closeKebab) {
                activeKebabClose = undefined;
              }
            };

            kebabButton.addEventListener("click", (event) => {
              event.stopPropagation();
              if (kebabMenu) {
                closeKebab();
                return;
              }

              activeKebabClose?.();
              activeKebabClose = closeKebab;

              kebabMenu = doc.createElement("div");
              kebabMenu.className = "pp-session-history__kebab-menu";

              const renameItem = doc.createElement("button");
              renameItem.type = "button";
              renameItem.className = "pp-btn pp-btn--ghost";
              renameItem.textContent = "Rename";
              renameItem.addEventListener("click", async (renameEvent) => {
                renameEvent.stopPropagation();
                closeKebab();
                renamingSessionId = entry.sessionId;
                await renderSessionHistory();
              });
              kebabMenu.appendChild(renameItem);

              const deleteItem = doc.createElement("button");
              deleteItem.type = "button";
              deleteItem.className = "pp-btn pp-btn--ghost";
              deleteItem.textContent = "Delete";
              deleteItem.addEventListener("click", async (deleteEvent) => {
                deleteEvent.stopPropagation();
                closeKebab();
                if (
                  !confirmDestructive(
                    pastSessionsButton.ownerDocument,
                    "Delete session",
                    `Delete session "${entry.title}"? This cannot be undone.`,
                  )
                ) {
                  return;
                }
                const deletingCurrent =
                  sessionStore.get(item.id)?.sessionId === entry.sessionId;
                if (deletingCurrent) {
                  await runSessionRuntimeTransition(async () => {
                    await sessionHistoryService.deleteSavedSession({
                      itemID: item.id,
                      sessionId: entry.sessionId,
                    });
                    resetBlankSessionState();
                    renamingSessionId = undefined;
                    await rerenderPane();
                  });
                  return;
                }
                await sessionHistoryService.deleteSavedSession({
                  itemID: item.id,
                  sessionId: entry.sessionId,
                });
                renamingSessionId = undefined;
                await rerenderPane();
              });
              kebabMenu.appendChild(deleteItem);

              kebabContainer.appendChild(kebabMenu);
            });

            kebabContainer.appendChild(kebabButton);
            rowActions.appendChild(kebabContainer);

            row.appendChild(rowActions);
            sessionHistoryPanel.appendChild(row);
          }
        };

        const cleanupComposerSizing = installChatComposerAutosize(input);
        const unsubscribeFromRunEvents = subscribeToReaderRunEvents(
          item.id,
          (event) => {
            if (!isCurrentRender()) return;
            if (event.type === "started") {
              const activeLabel = getModeLabel(event.mode);
              renderModeHeader(modeChip, modeStatus, activeLabel, "running");
              renderStreamingIndicator(streamingIndicator, true);
              setSectionSummary(`${activeLabel} · Running`);
              return;
            }
            void rerenderPane();
          },
        );
        cleanupTasks.push(cleanupComposerSizing, unsubscribeFromRunEvents);
        void rerenderPane();
        renderRelatedRecommendationState(
          relatedRecommendButton,
          relatedStatus,
          relatedGroups,
          compareButton,
          compareHelper,
          item.id,
          String(item.getField("title") || ""),
        );
        relatedConcern.value =
          getRelatedRecommendationState(item.id).concern || "";
        updateWorkbenchSummary();
        updateRelatedSummary();

        const canChangeProvider = () => {
          const activeMode = getActiveReaderRunMode(item.id);
          const preparing =
            streamingIndicator.style.display === "flex" ||
            Boolean(getPendingEngineCompletion(item.id)) ||
            isReaderLifecycleClaimActive(item.id);
          if (!activeMode && !preparing) return true;
          addMessage(
            chatMessages,
            `${getModeLabel(activeMode ?? getModeForItem(item.id))} is still running for this paper. Wait for it to finish or cancel it before changing providers.`,
            "ai",
          );
          return false;
        };

        modeGeminiButton.addEventListener("click", async () => {
          if (!canChangeProvider()) return;
          setModeOverrideForItem(item.id, "gemini_cli");
          await renderPaneState({
            itemID: item.id,
            itemTitle: item.getField("title"),
            currentDocumentLabel,
            autoHighlightStatus,
            autoHighlightButton,
            researchBriefButton,
            contributionsButton,
            limitationsButton,
            followUpsButton,
            compareButton,
            compareHelper,
            saveWorkbenchNoteButton,
            saveWorkbenchCollectionButton,
            clearWorkbenchButton,
            paperToolStatus,
            paperToolCards,
            modeChip,
            modeStatus,
            runStateCard,
            codexActions,
            policyWarning,
            geminiFallbackCard,
            geminiEmbedCard,
            modelRow,
            modelInput,
            codexOptionsRow,
            codexWebSearchToggle,
            modelHistory,
            chatMessages,
            draftCard,
            streamingIndicator,
            setSectionSummary,
          });
        });

        modeClaudeButton.addEventListener("click", async () => {
          if (!canChangeProvider()) return;
          setModeOverrideForItem(item.id, "claude_code");
          await renderPaneState({
            itemID: item.id,
            itemTitle: item.getField("title"),
            currentDocumentLabel,
            autoHighlightStatus,
            autoHighlightButton,
            researchBriefButton,
            contributionsButton,
            limitationsButton,
            followUpsButton,
            compareButton,
            compareHelper,
            saveWorkbenchNoteButton,
            saveWorkbenchCollectionButton,
            clearWorkbenchButton,
            paperToolStatus,
            paperToolCards,
            modeChip,
            modeStatus,
            runStateCard,
            codexActions,
            policyWarning,
            geminiFallbackCard,
            geminiEmbedCard,
            modelRow,
            modelInput,
            codexOptionsRow,
            codexWebSearchToggle,
            modelHistory,
            chatMessages,
            draftCard,
            streamingIndicator,
            setSectionSummary,
          });
        });

        modeCodexButton.addEventListener("click", async () => {
          if (!canChangeProvider()) return;
          setModeOverrideForItem(item.id, "codex_cli");
          await renderPaneState({
            itemID: item.id,
            itemTitle: item.getField("title"),
            currentDocumentLabel,
            autoHighlightStatus,
            autoHighlightButton,
            researchBriefButton,
            contributionsButton,
            limitationsButton,
            followUpsButton,
            compareButton,
            compareHelper,
            saveWorkbenchNoteButton,
            saveWorkbenchCollectionButton,
            clearWorkbenchButton,
            paperToolStatus,
            paperToolCards,
            modeChip,
            modeStatus,
            runStateCard,
            codexActions,
            policyWarning,
            geminiFallbackCard,
            geminiEmbedCard,
            modelRow,
            modelInput,
            codexOptionsRow,
            codexWebSearchToggle,
            modelHistory,
            chatMessages,
            draftCard,
            streamingIndicator,
            setSectionSummary,
          });
        });

        modeResetButton.addEventListener("click", async () => {
          if (!canChangeProvider()) return;
          clearModeOverrideForItem(item.id);
          await renderPaneState({
            itemID: item.id,
            itemTitle: item.getField("title"),
            currentDocumentLabel,
            autoHighlightStatus,
            autoHighlightButton,
            researchBriefButton,
            contributionsButton,
            limitationsButton,
            followUpsButton,
            compareButton,
            compareHelper,
            saveWorkbenchNoteButton,
            saveWorkbenchCollectionButton,
            clearWorkbenchButton,
            paperToolStatus,
            paperToolCards,
            modeChip,
            modeStatus,
            runStateCard,
            codexActions,
            policyWarning,
            geminiFallbackCard,
            geminiEmbedCard,
            modelRow,
            modelInput,
            codexOptionsRow,
            codexWebSearchToggle,
            modelHistory,
            chatMessages,
            draftCard,
            streamingIndicator,
            setSectionSummary,
          });
        });

        autoHighlightButton.addEventListener("click", async () => {
          setAutoHighlightState(item.id, {
            running: true,
            status: "Finding important passages…",
          });
          renderAutoHighlightState(
            autoHighlightButton,
            autoHighlightStatus,
            item.id,
          );
          try {
            const { summary } = await runAutoHighlightWorkflow({
              itemID: item.id,
              itemTitle: item.getField("title"),
              onStatus: (status) => {
                setAutoHighlightState(item.id, {
                  running: true,
                  status,
                });
                renderAutoHighlightState(
                  autoHighlightButton,
                  autoHighlightStatus,
                  item.id,
                );
              },
            });
            setAutoHighlightState(item.id, {
              running: false,
              status: summary,
            });
            renderAutoHighlightState(
              autoHighlightButton,
              autoHighlightStatus,
              item.id,
            );
          } catch (error) {
            const message =
              error instanceof Error ? error.message : "Auto-highlight failed.";
            setAutoHighlightState(item.id, {
              running: false,
              status: message,
            });
            renderAutoHighlightState(
              autoHighlightButton,
              autoHighlightStatus,
              item.id,
            );
            addMessage(chatMessages, `Auto-highlight error: ${message}`, "ai");
          }
          workbenchSection.markUpdated();
          notifyReaderPaneStateChanged(item.id);
        });

        pastSessionsButton.addEventListener("click", async () => {
          sessionHistoryOpen = sessionsSection.isExpanded();
          renamingSessionId = undefined;
          await renderSessionHistory();
        });

        researchBriefButton.addEventListener("click", async () => {
          await runPaperArtifactRequest({
            item,
            kind: "research-brief",
            input,
            chatMessages,
            streamingIndicator,
            statusElement: paperToolStatus,
            cardsElement: paperToolCards,
            elements: workbenchElements,
            onStateChange: () => updateWorkbenchSummary(true),
          });
        });

        compareButton.addEventListener("click", async () => {
          await runPaperCompareRequest({
            item,
            input,
            chatMessages,
            streamingIndicator,
            statusElement: paperToolStatus,
            cardsElement: paperToolCards,
            compareButton,
            elements: workbenchElements,
            onStateChange: () => updateWorkbenchSummary(true),
          });
        });

        contributionsButton.addEventListener("click", async () => {
          await runPaperArtifactRequest({
            item,
            kind: "summarize-contributions",
            input,
            chatMessages,
            streamingIndicator,
            statusElement: paperToolStatus,
            cardsElement: paperToolCards,
            elements: workbenchElements,
            onStateChange: () => updateWorkbenchSummary(true),
          });
        });

        limitationsButton.addEventListener("click", async () => {
          await runPaperArtifactRequest({
            item,
            kind: "extract-limitations",
            input,
            chatMessages,
            streamingIndicator,
            statusElement: paperToolStatus,
            cardsElement: paperToolCards,
            elements: workbenchElements,
            onStateChange: () => updateWorkbenchSummary(true),
          });
        });

        followUpsButton.addEventListener("click", async () => {
          await runPaperArtifactRequest({
            item,
            kind: "suggest-follow-ups",
            input,
            chatMessages,
            streamingIndicator,
            statusElement: paperToolStatus,
            cardsElement: paperToolCards,
            elements: workbenchElements,
            onStateChange: () => updateWorkbenchSummary(true),
          });
        });

        saveWorkbenchNoteButton.addEventListener("click", async () => {
          const [latestCard] = getPaperArtifactState(item.id).cards;
          if (!latestCard) {
            return;
          }

          try {
            await savePaperArtifactToNote({
              item,
              card: latestCard,
            });
            setPaperArtifactState(item.id, {
              ...getPaperArtifactState(item.id),
              status: `Saved ${latestCard.title.toLowerCase()} to Zotero note`,
            });
          } catch (error) {
            setPaperArtifactState(item.id, {
              ...getPaperArtifactState(item.id),
              status:
                error instanceof Error
                  ? `Save to note failed: ${error.message}`
                  : "Save to note failed.",
            });
          }

          renderPaperArtifactState(
            researchBriefButton,
            contributionsButton,
            limitationsButton,
            followUpsButton,
            saveWorkbenchNoteButton,
            saveWorkbenchCollectionButton,
            clearWorkbenchButton,
            paperToolStatus,
            paperToolCards,
            item.id,
          );
          updateWorkbenchSummary();
        });

        saveWorkbenchCollectionButton.addEventListener("click", async () => {
          const { cards } = getPaperArtifactState(item.id);
          if (!cards.length) {
            return;
          }

          try {
            await savePaperArtifactSetToCollection({
              item,
              cards,
            });
            setPaperArtifactState(item.id, {
              ...getPaperArtifactState(item.id),
              status:
                cards.length === 1
                  ? `Saved 1 workbench artifact for collection reuse`
                  : `Saved ${cards.length} workbench artifacts for collection reuse`,
            });
          } catch (error) {
            setPaperArtifactState(item.id, {
              ...getPaperArtifactState(item.id),
              status:
                error instanceof Error
                  ? `Save for collection failed: ${error.message}`
                  : "Save for collection failed.",
            });
          }

          renderPaperArtifactState(
            researchBriefButton,
            contributionsButton,
            limitationsButton,
            followUpsButton,
            saveWorkbenchNoteButton,
            saveWorkbenchCollectionButton,
            clearWorkbenchButton,
            paperToolStatus,
            paperToolCards,
            item.id,
          );
          updateWorkbenchSummary();
        });

        clearWorkbenchButton.addEventListener("click", () => {
          addon.data.paperArtifactStates?.set(item.id, {
            running: false,
            status: "",
            cards: [],
          });
          renderPaperArtifactState(
            researchBriefButton,
            contributionsButton,
            limitationsButton,
            followUpsButton,
            saveWorkbenchNoteButton,
            saveWorkbenchCollectionButton,
            clearWorkbenchButton,
            paperToolStatus,
            paperToolCards,
            item.id,
          );
          updateWorkbenchSummary();
        });

        let relatedConcernOrigin =
          getRelatedRecommendationState(item.id).concernOrigin || "user_text";
        relatedConcern.addEventListener("input", () => {
          relatedConcernOrigin = "user_text";
        });
        relatedRecommendButton.addEventListener("click", async () => {
          const currentRelatedState = getRelatedRecommendationState(item.id);
          if (currentRelatedState.reviewInsightRunningCandidateID) {
            publicReviewAbortControllers.get(item.id)?.abort();
            addon.data.relatedRecommendationStates?.set(item.id, {
              ...currentRelatedState,
              status: "Cancelling public-review analysis…",
            });
            return;
          }
          if (currentRelatedState.running) {
            relatedDiscoveryAbortControllers.get(item.id)?.abort();
            const current = getRelatedRecommendationState(item.id);
            addon.data.relatedRecommendationStates?.set(item.id, {
              ...current,
              status: "Cancelling research discovery…",
            });
            renderRelatedRecommendationState(
              relatedRecommendButton,
              relatedStatus,
              relatedGroups,
              compareButton,
              compareHelper,
              item.id,
              String(item.getField("title") || ""),
            );
            return;
          }
          const abortController = createPaneAbortController(
            relatedRecommendButton.ownerDocument,
          );
          relatedDiscoveryAbortControllers.set(item.id, abortController);
          const submission = {
            concern: relatedConcern.value.trim(),
            concernOrigin: relatedConcernOrigin,
            previousState: getRelatedRecommendationState(item.id),
          };
          let reservationOwned = false;
          try {
            await generateRelatedPaperGroups({
              itemID: item.id,
              itemTitle: item.getField("title"),
              concern: submission.concern
                ? {
                    text: submission.concern,
                    origin: submission.concernOrigin,
                  }
                : undefined,
              signal: abortController.signal,
              onReserved: () => {
                reservationOwned = true;
                addon.data.relatedRecommendationStates?.set(
                  item.id,
                  buildRelatedRunProgressState(
                    getRelatedRecommendationState(item.id),
                    submission,
                    "Understanding the research question",
                  ),
                );
                renderRelatedRecommendationState(
                  relatedRecommendButton,
                  relatedStatus,
                  relatedGroups,
                  compareButton,
                  compareHelper,
                  item.id,
                  String(item.getField("title") || ""),
                );
              },
              onStatus: (status) => {
                addon.data.relatedRecommendationStates?.set(
                  item.id,
                  buildRelatedRunProgressState(
                    getRelatedRecommendationState(item.id),
                    submission,
                    status,
                  ),
                );
                renderRelatedRecommendationState(
                  relatedRecommendButton,
                  relatedStatus,
                  relatedGroups,
                  compareButton,
                  compareHelper,
                  item.id,
                  String(item.getField("title") || ""),
                );
              },
              onSuccess: async (result) => {
                addon.data.relatedRecommendationStates?.set(
                  item.id,
                  buildRelatedRunSuccessState({
                    submission,
                    sessionID: sessionStore.get(item.id)?.sessionId,
                    groups: result.groups,
                    discovery: result.discovery,
                  }),
                );
                await sessionHistoryService.persistActiveSession({
                  itemID: item.id,
                  paperTitle: String(item.getField("title") || ""),
                });
              },
              onFailure: async (error) => {
                addon.data.relatedRecommendationStates?.set(
                  item.id,
                  buildRelatedRunFailureState({
                    submission,
                    sessionID: sessionStore.get(item.id)?.sessionId,
                    error,
                  }),
                );
                await sessionHistoryService.persistActiveSession({
                  itemID: item.id,
                  paperTitle: String(item.getField("title") || ""),
                });
              },
            });
          } catch (error) {
            if (!reservationOwned) {
              addMessage(
                chatMessages,
                error instanceof Error
                  ? error.message
                  : "Related paper recommendations could not start.",
                "ai",
              );
              return;
            }
          } finally {
            if (
              relatedDiscoveryAbortControllers.get(item.id) === abortController
            ) {
              relatedDiscoveryAbortControllers.delete(item.id);
            }
          }
          renderRelatedRecommendationState(
            relatedRecommendButton,
            relatedStatus,
            relatedGroups,
            compareButton,
            compareHelper,
            item.id,
            String(item.getField("title") || ""),
          );
          updateRelatedSummary(true);
          notifyReaderPaneStateChanged(item.id);
        });

        relatedSaveButton.addEventListener("click", async () => {
          const state = getRelatedRecommendationState(item.id);
          if (!state.discovery) return;
          relatedSaveButton.disabled = true;
          try {
            await saveDiscoveryToNote({
              item,
              paperTitle: String(item.getField("title") || "Current paper"),
              concern: state.concern,
              discovery: state.discovery,
              includeReviewInsights: canViewPublicReviewInsights(
                addon.data.criticalReadStates?.get(item.id),
              ),
            });
            addon.data.relatedRecommendationStates?.set(item.id, {
              ...state,
              status: "Discovery report saved to a Zotero note.",
            });
          } catch (error) {
            addon.data.relatedRecommendationStates?.set(item.id, {
              ...state,
              status:
                error instanceof Error
                  ? `Save failed: ${error.message}`
                  : "Discovery report could not be saved.",
            });
          }
          renderRelatedRecommendationState(
            relatedRecommendButton,
            relatedStatus,
            relatedGroups,
            compareButton,
            compareHelper,
            item.id,
          );
          await sessionHistoryService.persistActiveSession({
            itemID: item.id,
            paperTitle: String(item.getField("title") || ""),
          });
        });

        // --- Paper Mastery handlers ---
        const masteryActionsDiv = body.querySelector(
          "#paper-mastery-actions",
        ) as HTMLElement | null;

        let selectedHistoryDot: number = -1;

        masteryConfidence?.addEventListener("input", () => {
          if (masteryConfidenceValue) {
            masteryConfidenceValue.textContent = `${Math.round(Number(masteryConfidence.value) * 100)}%`;
          }
        });

        function renderMasteryMetrics(
          state: import("./comprehensionCheck/types").ComprehensionCheckState,
        ) {
          if (!masteryMetrics) return;
          const summary = state.summary;
          if (!summary || !state.rounds.length) {
            masteryMetrics.textContent = "";
            return;
          }
          const calibration =
            summary.calibration === null
              ? "not yet available"
              : `${Math.round(summary.calibration * 100)}%`;
          const nextReview = summary.nextReviewAt
            ? new Date(summary.nextReviewAt).toLocaleDateString()
            : "not scheduled";
          masteryMetrics.textContent = `Score ${Math.round(summary.averageScore * 100)}% · calibration ${calibration} · next review ${nextReview}`;
        }

        function addHistorySection(
          parent: HTMLElement,
          modifier: string,
          label: string,
          markdown: string,
        ) {
          const doc = parent.ownerDocument!;
          const section = doc.createElement("div");
          section.className = `pp-mastery-history-section pp-mastery-history-section--${modifier}`;
          const lbl = doc.createElement("div");
          lbl.className = "pp-mastery-history-label";
          lbl.textContent = label;
          const sectionBody = doc.createElement("div");
          sectionBody.className = "pp-mastery-history-body";
          sectionBody.appendChild(renderMarkdownFragment(markdown, doc));
          section.append(lbl, sectionBody);
          parent.appendChild(section);
        }

        function clearHistoryDotSelection() {
          if (!masteryProgress) {
            return;
          }
          selectedHistoryDot = -1;
          const dots = masteryProgress.querySelectorAll(
            ".pp-mastery-progress-dot--active",
          );
          dots.forEach((d) =>
            d.classList.remove("pp-mastery-progress-dot--active"),
          );
        }

        function showRoundHistory(
          state: import("./comprehensionCheck/types").ComprehensionCheckState,
          roundIndex: number,
        ) {
          if (!masteryFeedback) {
            return;
          }
          const r = state.rounds[roundIndex];
          if (!r) {
            return;
          }
          const doc = masteryFeedback.ownerDocument!;
          const topicLabel = state.topics[roundIndex]?.topic ?? "general";

          masteryFeedback.className =
            "pp-mastery-feedback pp-mastery-feedback--history";
          masteryFeedback.replaceChildren();
          masteryFeedback.setAttribute(
            "aria-label",
            `Round ${roundIndex + 1} history`,
          );

          const header = doc.createElement("div");
          header.className = "pp-mastery-history-header";
          header.textContent = `Round ${roundIndex + 1} — ${topicLabel}`;
          masteryFeedback.appendChild(header);

          addHistorySection(masteryFeedback, "question", "Q", r.question);
          addHistorySection(
            masteryFeedback,
            "answer",
            "Your Answer",
            r.userAnswer,
          );
          addHistorySection(
            masteryFeedback,
            "feedback",
            "Feedback",
            r.evaluation,
          );
          if (r.criterionScores?.length) {
            addHistorySection(
              masteryFeedback,
              "criteria",
              "Rubric scores",
              r.criterionScores
                .map(
                  (criterion) =>
                    `- **${criterion.criterionID}** ${criterion.score}/${criterion.maxScore}: ${criterion.feedback || "No additional feedback"}`,
                )
                .join("\n"),
            );
          }
          if (typeof r.learnerConfidence === "number") {
            addHistorySection(
              masteryFeedback,
              "confidence",
              "Calibration input",
              `Confidence ${Math.round(r.learnerConfidence * 100)}% · score ${Math.round((r.normalizedScore ?? 0) * 100)}%`,
            );
          }
          if (!r.understood && r.explanation) {
            addHistorySection(
              masteryFeedback,
              "explanation",
              "📚 Explanation",
              r.explanation,
            );
          }

          masteryFeedback.style.display = "";
        }

        function showCurrentRoundPreview(
          state: import("./comprehensionCheck/types").ComprehensionCheckState,
        ) {
          if (!masteryFeedback) {
            return;
          }
          const doc = masteryFeedback.ownerDocument!;
          const roundNum = state.rounds.length + 1;
          const currentTopic =
            state.topics[state.rounds.length]?.topic ?? "general";

          masteryFeedback.className =
            "pp-mastery-feedback pp-mastery-feedback--history";
          masteryFeedback.replaceChildren();
          masteryFeedback.setAttribute(
            "aria-label",
            `Round ${roundNum} — current`,
          );

          const header = doc.createElement("div");
          header.className = "pp-mastery-history-header";
          header.textContent = `Round ${roundNum} — ${currentTopic} (current)`;
          masteryFeedback.appendChild(header);

          if (state.currentQuestion) {
            addHistorySection(
              masteryFeedback,
              "question",
              "Q",
              state.currentQuestion,
            );
          }

          const userText = masteryAnswer?.value?.trim();
          if (userText) {
            addHistorySection(
              masteryFeedback,
              "answer",
              "Your Answer (draft)",
              userText,
            );
          }

          masteryFeedback.style.display = "";
        }

        function updateMasteryProgressDots(
          state: import("./comprehensionCheck/types").ComprehensionCheckState,
        ) {
          if (!masteryProgress) {
            return;
          }
          masteryProgress.replaceChildren();
          state.rounds.forEach((r, i) => {
            const dot = body.ownerDocument.createElement("span");
            dot.className = `pp-mastery-progress-dot pp-mastery-progress-dot--${r.understood ? "correct" : "incorrect"}`;
            dot.title = `Round ${i + 1}: ${r.understood ? "Understood" : "Needs review"}`;
            dot.style.cursor = "pointer";
            dot.setAttribute("tabindex", "0");
            dot.setAttribute("role", "button");
            dot.setAttribute(
              "aria-label",
              `Round ${i + 1}: ${r.understood ? "Understood" : "Needs review"}`,
            );
            const handleDotClick = () => {
              const currentPhase = getMasteryState(item.id)?.phase;
              if (
                currentPhase === "evaluating" ||
                currentPhase === "generating-question"
              ) {
                return;
              }
              if (selectedHistoryDot === i) {
                clearHistoryDotSelection();
                if (masteryFeedback) {
                  masteryFeedback.style.display = "none";
                  masteryFeedback.className = "pp-mastery-feedback";
                }
                return;
              }
              clearHistoryDotSelection();
              selectedHistoryDot = i;
              dot.classList.add("pp-mastery-progress-dot--active");
              const currentState = getMasteryState(item.id) ?? state;
              showRoundHistory(currentState, i);
            };
            dot.addEventListener("click", handleDotClick);
            dot.addEventListener("keydown", (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                handleDotClick();
              }
            });
            if (selectedHistoryDot === i) {
              dot.classList.add("pp-mastery-progress-dot--active");
            }
            masteryProgress.appendChild(dot);
          });
          if (state.phase !== "complete") {
            const currentIndex = state.rounds.length;
            const current = body.ownerDocument.createElement("span");
            current.className =
              "pp-mastery-progress-dot pp-mastery-progress-dot--current";
            current.title = "Current round";
            current.style.cursor = "pointer";
            current.setAttribute("tabindex", "0");
            current.setAttribute("role", "button");
            current.setAttribute("aria-label", "Current round");
            const handleCurrentDotClick = () => {
              const currentPhase = getMasteryState(item.id)?.phase;
              if (
                currentPhase === "evaluating" ||
                currentPhase === "generating-question"
              ) {
                return;
              }
              if (selectedHistoryDot === currentIndex) {
                clearHistoryDotSelection();
                if (masteryFeedback) {
                  masteryFeedback.style.display = "none";
                  masteryFeedback.className = "pp-mastery-feedback";
                }
                return;
              }
              clearHistoryDotSelection();
              selectedHistoryDot = currentIndex;
              current.classList.add("pp-mastery-progress-dot--active");
              const currentState = getMasteryState(item.id) ?? state;
              showCurrentRoundPreview(currentState);
            };
            current.addEventListener("click", handleCurrentDotClick);
            current.addEventListener("keydown", (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                handleCurrentDotClick();
              }
            });
            if (selectedHistoryDot === currentIndex) {
              current.classList.add("pp-mastery-progress-dot--active");
            }
            masteryProgress.appendChild(current);
          }
        }

        function showMasteryQuestion(
          question: string,
          options: { focus?: boolean; clearAnswer?: boolean } = {},
        ) {
          clearHistoryDotSelection();
          if (masteryQuestion) {
            masteryQuestion.replaceChildren(
              renderMarkdownFragment(question, masteryQuestion.ownerDocument!),
            );
            masteryQuestion.style.display = "";
          }
          if (masteryAnswer) {
            masteryAnswer.style.display = "";
            if (options.clearAnswer !== false) masteryAnswer.value = "";
            if (options.focus !== false) masteryAnswer.focus();
          }
          if (masteryConfidenceRow) masteryConfidenceRow.style.display = "";
          if (masteryConfidence && options.clearAnswer !== false) {
            masteryConfidence.value = "0.7";
          }
          if (masteryConfidenceValue) {
            masteryConfidenceValue.textContent = `${Math.round(Number(masteryConfidence?.value ?? 0.7) * 100)}%`;
          }
          if (masteryActionsDiv) {
            masteryActionsDiv.style.display = "";
          }
          if (masterySubmit) {
            masterySubmit.disabled = false;
          }
          if (masteryFeedback) {
            masteryFeedback.style.display = "none";
          }
        }

        function showMasteryFeedback(
          evaluation: string,
          understood: boolean,
          explanation?: string,
        ) {
          if (!masteryFeedback) {
            return;
          }
          masteryFeedback.className = `pp-mastery-feedback pp-mastery-feedback--${understood ? "correct" : "incorrect"}`;
          masteryFeedback.replaceChildren();

          addHistorySection(
            masteryFeedback,
            "feedback",
            "Feedback",
            evaluation,
          );
          if (!understood && explanation) {
            addHistorySection(
              masteryFeedback,
              "explanation",
              "📚 Explanation",
              explanation,
            );
          }

          masteryFeedback.style.display = "";
        }

        function renderMasteryCompletion(
          state: import("./comprehensionCheck/types").ComprehensionCheckState,
        ) {
          const understood = state.rounds.filter((r) => r.understood).length;
          const total = state.rounds.length;
          const score = total > 0 ? Math.round((understood / total) * 100) : 0;
          if (masteryQuestion) {
            const scoreContent = `## Session Complete!\n\nGreat work studying this paper.\n\n**Score: ${score}%** (${understood}/${total} questions understood)`;
            masteryQuestion.replaceChildren(
              renderMarkdownFragment(
                scoreContent,
                masteryQuestion.ownerDocument!,
              ),
            );
            masteryQuestion.style.display = "";
          }
          if (masteryFeedback) {
            masteryFeedback.style.display = "none";
          }
          if (masteryAnswer) {
            masteryAnswer.style.display = "none";
          }
          if (masteryConfidenceRow) {
            masteryConfidenceRow.style.display = "none";
          }
          if (masteryActionsDiv) {
            masteryActionsDiv.style.display = "none";
          }
          if (masteryStatus) {
            masteryStatus.textContent = state.running
              ? "Generating final report..."
              : "Complete";
          }
          renderMasteryMetrics(state);
          if (masteryReport) {
            if (state.finalReport) {
              masteryReport.replaceChildren(
                renderMarkdownFragment(
                  state.finalReport,
                  masteryReport.ownerDocument!,
                ),
              );
              masteryReport.style.display = "";
            } else if (state.finalReportError) {
              masteryReport.textContent = state.finalReportError;
              masteryReport.style.display = "";
            } else if (state.running) {
              masteryReport.textContent = "Generating final report...";
              masteryReport.style.display = "";
            } else {
              masteryReport.replaceChildren();
              masteryReport.style.display = "none";
            }
          }
        }

        async function showMasteryCompletion(
          state: import("./comprehensionCheck/types").ComprehensionCheckState,
          continuationToken?: ReaderRunToken,
        ) {
          if (state.finalReport || state.finalReportError) {
            renderMasteryCompletion(state);
            return;
          }

          const masterySessionID = state.sessionID;
          const markAdmitted = () => {
            if (!getMasteryStateForSession(item.id, masterySessionID)) return;
            state.phase = "complete";
            state.running = true;
            state.status = "Generating final report...";
            setMasteryState(item.id, state);
            renderMasteryCompletion(state);
          };
          await sendMasteryPrompt(
            buildFinalReportPrompt(state.rounds, state.topics),
            async (assistantText) => {
              const s = getMasteryStateForSession(item.id, masterySessionID);
              if (s) {
                s.running = false;
                s.status = "Complete";
                s.finalReport = assistantText;
                s.finalReportError = undefined;
                setMasteryState(item.id, s);
                renderMasteryCompletion(s);
                await sessionHistoryService.persistActiveSession({
                  itemID: item.id,
                  paperTitle: String(item.getField("title") || ""),
                });
              }
            },
            async () => {
              const s = getMasteryStateForSession(item.id, masterySessionID);
              if (s) {
                s.running = false;
                s.status = "Complete";
                s.finalReportError = "Could not generate final report.";
                setMasteryState(item.id, s);
                renderMasteryCompletion(s);
                await sessionHistoryService.persistActiveSession({
                  itemID: item.id,
                  paperTitle: String(item.getField("title") || ""),
                });
              }
            },
            continuationToken,
            markAdmitted,
          );
        }

        function hydrateMasteryState() {
          const state = getMasteryState(item.id);
          const hasProgress = Boolean(
            state &&
              (state.phase !== "idle" ||
                state.status ||
                state.rounds.length ||
                state.currentQuestion),
          );
          if (!state || !hasProgress) {
            if (masterySection) masterySection.style.display = "none";
            if (paperMasteryBtn) paperMasteryBtn.textContent = "Paper Mastery";
            if (masteryMetrics) masteryMetrics.textContent = "";
            return;
          }

          if (masterySection) masterySection.style.display = "";
          if (masteryStatus) masteryStatus.textContent = state.status;
          renderMasteryMetrics(state);
          updateMasteryProgressDots(state);
          if (paperMasteryBtn) {
            paperMasteryBtn.textContent =
              state.phase === "complete"
                ? "Restart Paper Mastery"
                : "Resume Paper Mastery";
          }

          if (masteryReport) {
            masteryReport.replaceChildren();
            masteryReport.style.display = "none";
          }
          if (state.phase === "complete") {
            renderMasteryCompletion(state);
            return;
          }
          if (state.currentQuestion) {
            showMasteryQuestion(state.currentQuestion, {
              focus: false,
              clearAnswer: false,
            });
          } else {
            if (masteryQuestion) masteryQuestion.style.display = "none";
            if (masteryAnswer) masteryAnswer.style.display = "none";
            if (masteryConfidenceRow)
              masteryConfidenceRow.style.display = "none";
            if (masteryActionsDiv) masteryActionsDiv.style.display = "none";
          }
          if (
            state.phase === "generating-question" ||
            state.phase === "evaluating"
          ) {
            if (masteryAnswer) masteryAnswer.style.display = "none";
            if (masteryConfidenceRow)
              masteryConfidenceRow.style.display = "none";
            if (masteryActionsDiv) masteryActionsDiv.style.display = "none";
          }
        }

        async function sendMasteryPrompt(
          prompt: string,
          onSuccess: (
            assistantText: string,
            continuationToken?: ReaderRunToken,
          ) => void | Promise<void>,
          onFailure?: (
            continuationToken?: ReaderRunToken,
          ) => void | Promise<void>,
          continuationToken?: ReaderRunToken,
          onAdmitted?: () => void,
          outputSchema?: StructuredOutputSchema,
        ) {
          const itemID = item.id;
          const { mode, placeholderResponse } =
            getProviderDescriptorForItem(itemID);
          const savedInput = input.value;
          try {
            input.value = prompt;
            await handleUserInput(
              input,
              chatMessages,
              mode,
              itemID,
              item.getField("title") as string,
              placeholderResponse,
              streamingIndicator,
              {
                silentUserMessage: true,
                suppressChatMessages: true,
                profile: "analysis",
                outputSchema,
                continuationToken,
                onAdmitted,
                onComplete: async (result) => {
                  if (result.success) {
                    await onSuccess(
                      result.assistantText,
                      result.continuationToken,
                    );
                  } else {
                    await onFailure?.(result.continuationToken);
                  }
                  await sessionHistoryService.persistActiveSession({
                    itemID,
                    paperTitle: String(item.getField("title") || ""),
                  });
                  workbenchSection.markUpdated();
                },
              },
            );
          } catch {
            await onFailure?.();
            await sessionHistoryService.persistActiveSession({
              itemID,
              paperTitle: String(item.getField("title") || ""),
            });
            workbenchSection.markUpdated();
          } finally {
            input.value = savedInput;
            input.disabled = false;
          }
        }

        paperMasteryBtn?.addEventListener("click", async () => {
          if (!masterySection) {
            return;
          }
          const existingState = getMasteryState(item.id);
          if (
            existingState?.running ||
            (existingState &&
              existingState.phase !== "idle" &&
              existingState.phase !== "complete")
          ) {
            hydrateMasteryState();
            return;
          }
          if (
            existingState?.phase === "complete" &&
            !confirmDestructive(
              paperMasteryBtn.ownerDocument,
              "Restart Paper Mastery",
              "Start Paper Mastery over? The current questions, answers, and final report will be replaced.",
            )
          ) {
            return;
          }
          const activeSession = sessionStore.getOrCreate(
            item.id,
            getModeForItem(item.id),
            String(item.getField("title") || ""),
          );
          let sourceSnapshot: import("./comprehensionCheck/types").MasterySourceSnapshot =
            {
              itemID: item.id,
            };
          try {
            const { paperWorkspaceContentCache } = await import(
              "./tools/paperWorkspaceContent"
            );
            const content =
              await paperWorkspaceContentCache.getPaperContent(item);
            sourceSnapshot = {
              itemID: item.id,
              libraryID: content.source?.libraryID,
              itemKey: content.source?.itemKey,
              attachmentKey: content.source?.attachmentKey,
              contentFingerprint: content.contentFingerprint?.value,
            };
          } catch {
            // The question runner will surface extraction errors. Preserve the
            // stable item identity so a failed preparation cannot bind elsewhere.
          }
          const state = buildInitialMasteryState({
            sessionID: activeSession.sessionId,
            sourceSnapshot,
          });
          const masterySessionID = state.sessionID;
          const markAdmitted = () => {
            if (sessionStore.get(item.id)?.sessionId !== masterySessionID)
              return;
            clearMasteryState(item.id);
            masterySection.style.display = "";
            state.phase = "generating-question";
            state.running = true;
            state.status = "Generating first question...";
            setMasteryState(item.id, state);
            if (masteryStatus) {
              masteryStatus.textContent = state.status;
            }
            updateMasteryProgressDots(state);
          };

          const resetOnFail = () => {
            const fs = getMasteryStateForSession(item.id, masterySessionID);
            if (fs) {
              fs.phase = "idle";
              fs.running = false;
              setMasteryState(item.id, fs);
            }
            if (masteryStatus) {
              masteryStatus.textContent =
                "Failed to generate question. Try again.";
            }
          };
          await sendMasteryPrompt(
            buildInitialMasteryPrompt(),
            (assistantText) => {
              const parsed = parseMasteryQuestionResponse(assistantText);
              if (!parsed) {
                resetOnFail();
                return;
              }
              const s = getMasteryStateForSession(item.id, masterySessionID);
              if (!s) return;
              s.phase = "awaiting-answer";
              s.running = false;
              s.currentQuestion = parsed.question;
              s.status = `Topic: ${parsed.topic} (${parsed.difficulty})`;
              s.topics.push({
                topic: parsed.topic,
                understood: false,
                confidence: 0,
                difficulty: parsed.difficulty,
              });
              setMasteryState(item.id, s);
              if (masteryStatus) {
                masteryStatus.textContent = s.status;
              }
              showMasteryQuestion(parsed.question);
              updateMasteryProgressDots(s);
            },
            resetOnFail,
            undefined,
            markAdmitted,
            MASTERY_QUESTION_OUTPUT_SCHEMA,
          );
        });

        masterySubmit?.addEventListener("click", async () => {
          const answer = masteryAnswer?.value?.trim();
          if (!answer) {
            return;
          }
          const state = getMasteryState(item.id);
          if (!state?.currentQuestion) {
            return;
          }
          if (state.phase !== "awaiting-answer") {
            return;
          }

          const markAdmitted = () => {
            const current = getMasteryStateForSession(
              item.id,
              masterySessionID,
            );
            if (
              !current ||
              current.phase !== "awaiting-answer" ||
              current.currentQuestion !== question
            ) {
              return;
            }
            current.phase = "evaluating";
            current.running = true;
            current.status = "Evaluating your answer...";
            setMasteryState(item.id, current);
            if (masteryStatus) {
              masteryStatus.textContent = current.status;
            }
            if (masterySubmit) {
              masterySubmit.disabled = true;
            }
          };

          const question = state.currentQuestion;
          const masterySessionID = state.sessionID;
          const learnerConfidence = Math.max(
            0,
            Math.min(1, Number(masteryConfidence?.value ?? 0.7)),
          );
          const resetSubmitOnFail = () => {
            const fs = getMasteryStateForSession(item.id, masterySessionID);
            if (fs) {
              fs.phase = "awaiting-answer";
              fs.running = false;
              setMasteryState(item.id, fs);
            }
            if (masteryStatus) {
              masteryStatus.textContent =
                "Failed to evaluate. Try submitting again.";
            }
            if (masterySubmit) {
              masterySubmit.disabled = false;
            }
          };
          await sendMasteryPrompt(
            buildEvaluateAnswerPrompt(question, answer, state.rounds),
            async (assistantText, continuationToken) => {
              const evalResult = parseMasteryEvaluationResponse(assistantText);
              if (!evalResult) {
                resetSubmitOnFail();
                return;
              }

              const s = getMasteryStateForSession(item.id, masterySessionID);
              if (!s || s.currentQuestion !== question) return;
              const activeTopic = s.topics[s.rounds.length];
              const round = createCanonicalMasteryRound({
                question,
                answer,
                topic: activeTopic?.topic,
                difficulty: activeTopic?.difficulty,
                learnerConfidence,
                evaluation: evalResult,
              });
              s.rounds.push(round);
              if (s.topics.length > 0) {
                const last = s.topics[s.topics.length - 1];
                last.understood = evalResult.understood;
                last.confidence = learnerConfidence;
              }
              Object.assign(s, updateCanonicalMasteryAnalytics(s));
              clearHistoryDotSelection();
              showMasteryFeedback(
                evalResult.evaluation,
                evalResult.understood,
                evalResult.understood ? undefined : evalResult.explanation,
              );
              updateMasteryProgressDots(s);
              renderMasteryMetrics(s);

              const MIN_ROUNDS = 3;
              const MAX_ROUNDS = 30;
              if (
                (!evalResult.nextTopic && s.rounds.length >= MIN_ROUNDS) ||
                s.rounds.length >= MAX_ROUNDS
              ) {
                await showMasteryCompletion(s, continuationToken);
                return;
              }

              s.phase = "generating-question";
              s.status = "Generating next question...";
              setMasteryState(item.id, s);
              if (masteryStatus) {
                masteryStatus.textContent = s.status;
              }

              await sendMasteryPrompt(
                buildFollowUpQuestionPrompt(
                  s.rounds,
                  evalResult.nextTopic ?? "general understanding",
                  evalResult.nextDifficulty,
                ),
                async (nextText, nextContinuationToken) => {
                  const parsed = parseMasteryQuestionResponse(nextText);
                  if (!parsed) {
                    const fst = getMasteryStateForSession(
                      item.id,
                      masterySessionID,
                    );
                    if (!fst) return;
                    await showMasteryCompletion(
                      fst ?? s,
                      nextContinuationToken,
                    );
                    return;
                  }
                  const st = getMasteryStateForSession(
                    item.id,
                    masterySessionID,
                  );
                  if (!st) return;
                  st.phase = "awaiting-answer";
                  st.running = false;
                  st.currentQuestion = parsed.question;
                  st.status = `Topic: ${parsed.topic} (${parsed.difficulty})`;
                  st.topics.push({
                    topic: parsed.topic,
                    understood: false,
                    confidence: 0,
                    difficulty: parsed.difficulty,
                  });
                  setMasteryState(item.id, st);
                  if (masteryStatus) {
                    masteryStatus.textContent = st.status;
                  }
                  showMasteryQuestion(parsed.question);
                  updateMasteryProgressDots(st);
                  if (masterySubmit) {
                    masterySubmit.disabled = false;
                  }
                },
                () => {
                  const fst = getMasteryStateForSession(
                    item.id,
                    masterySessionID,
                  );
                  if (!fst) return;
                  if (fst) {
                    fst.phase = "complete";
                    fst.running = false;
                    fst.status = "Complete";
                    fst.finalReportError =
                      "Paper Mastery stopped before the next question was generated.";
                    setMasteryState(item.id, fst);
                  }
                  renderMasteryCompletion(fst ?? s);
                },
                continuationToken,
                undefined,
                MASTERY_QUESTION_OUTPUT_SCHEMA,
              );
            },
            resetSubmitOnFail,
            undefined,
            markAdmitted,
            MASTERY_EVALUATION_OUTPUT_SCHEMA,
          );
        });

        masteryEnd?.addEventListener("click", async () => {
          const state = getMasteryState(item.id);
          if (!state) {
            return;
          }
          if (
            state.phase === "evaluating" ||
            state.phase === "generating-question" ||
            state.phase === "complete"
          ) {
            return;
          }
          if (state.rounds.length > 0) {
            await showMasteryCompletion(state);
          } else {
            if (masterySection) {
              masterySection.style.display = "none";
            }
            clearMasteryState(item.id);
          }
        });

        newSessionButton.addEventListener("click", async () => {
          const mode = getModeForItem(item.id);
          await runSessionRuntimeTransition(async () => {
            await sessionHistoryService.startNewSessionDraft({
              itemID: item.id,
              mode,
              paperTitle: String(item.getField("title") || ""),
            });
            resetBlankSessionState();
            sessionHistoryOpen = false;
            sessionsSection.setExpanded(false);
            renamingSessionId = undefined;
            await rerenderPane();
          });
        });

        codexAuthButton.addEventListener("click", async () => {
          const loginState = await probeCodexLoginState().catch(
            () => "unavailable" as const,
          );
          await refreshCodexStatus(
            modeChip,
            modeStatus,
            setSectionSummary,
            runStateCard,
            item.id,
            item.getField("title"),
            isCurrentRender,
          );
          addMessage(
            chatMessages,
            buildCodexAuthenticateMessage(
              loginState,
              addon.data.codexLastProbeError,
            ),
            "ai",
          );
        });

        codexDeviceAuthButton.addEventListener("click", () => {
          addMessage(
            chatMessages,
            "If your Codex CLI prompts for device auth, complete that flow in the terminal and then use Re-check status here.",
            "ai",
          );
        });

        codexRecheckButton.addEventListener("click", async () => {
          await renderPaneState({
            itemID: item.id,
            itemTitle: item.getField("title"),
            currentDocumentLabel,
            autoHighlightStatus,
            autoHighlightButton,
            researchBriefButton,
            contributionsButton,
            limitationsButton,
            followUpsButton,
            compareButton,
            compareHelper,
            saveWorkbenchNoteButton,
            saveWorkbenchCollectionButton,
            clearWorkbenchButton,
            paperToolStatus,
            paperToolCards,
            modeChip,
            modeStatus,
            runStateCard,
            codexActions,
            policyWarning,
            geminiFallbackCard,
            geminiEmbedCard,
            modelRow,
            modelInput,
            codexOptionsRow,
            codexWebSearchToggle,
            modelHistory,
            chatMessages,
            draftCard,
            streamingIndicator,
            setSectionSummary,
          });
        });

        modelSaveButton.addEventListener("click", async () => {
          if (!modelInput.value.trim()) {
            return;
          }
          const [savedModel, savedReasoningEffort] =
            modelInput.value.split("|");
          const activeMode = getCurrentProviderDescriptor(item.id).mode;
          if (activeMode === "gemini_cli") {
            setPref("geminiDefaultModel", savedModel);
          } else if (activeMode === "claude_code") {
            setPref("claudeDefaultModel", normalizeClaudeModel(savedModel));
          } else {
            const normalizedCodexModel = normalizeCodexModel(savedModel);
            setPref("codexDefaultModel", normalizedCodexModel);
            setPref(
              "codexReasoningEffort",
              normalizeCodexReasoningEffort(
                savedReasoningEffort || "",
                normalizedCodexModel,
              ),
            );
          }
          rememberRecentCodexModel(
            normalizeModelForMode(activeMode, savedModel),
          );
          await renderPaneState({
            itemID: item.id,
            itemTitle: item.getField("title"),
            currentDocumentLabel,
            autoHighlightStatus,
            autoHighlightButton,
            researchBriefButton,
            contributionsButton,
            limitationsButton,
            followUpsButton,
            compareButton,
            compareHelper,
            saveWorkbenchNoteButton,
            saveWorkbenchCollectionButton,
            clearWorkbenchButton,
            paperToolStatus,
            paperToolCards,
            modeChip,
            modeStatus,
            runStateCard,
            codexActions,
            policyWarning,
            geminiFallbackCard,
            geminiEmbedCard,
            modelRow,
            modelInput,
            codexOptionsRow,
            codexWebSearchToggle,
            modelHistory,
            chatMessages,
            draftCard,
            streamingIndicator,
            setSectionSummary,
          });
        });

        codexWebSearchToggle.addEventListener("change", async () => {
          setPref("codexEnableWebSearch", codexWebSearchToggle.checked);
          await renderPaneState({
            itemID: item.id,
            itemTitle: item.getField("title"),
            currentDocumentLabel,
            autoHighlightStatus,
            autoHighlightButton,
            researchBriefButton,
            contributionsButton,
            limitationsButton,
            followUpsButton,
            compareButton,
            compareHelper,
            saveWorkbenchNoteButton,
            saveWorkbenchCollectionButton,
            clearWorkbenchButton,
            paperToolStatus,
            paperToolCards,
            modeChip,
            modeStatus,
            runStateCard,
            codexActions,
            policyWarning,
            geminiFallbackCard,
            geminiEmbedCard,
            modelRow,
            modelInput,
            codexOptionsRow,
            codexWebSearchToggle,
            modelHistory,
            chatMessages,
            draftCard,
            streamingIndicator,
            setSectionSummary,
          });
        });

        const submitCurrentInput = async () => {
          const descriptor = getCurrentProviderDescriptor(item.id);
          await handleUserInput(
            input,
            chatMessages,
            descriptor.mode,
            item.id,
            item.getField("title"),
            descriptor.placeholderResponse,
            streamingIndicator,
          );
          renderDraftCard(draftCard, item.id);
          await renderSessionHistory();
        };

        input.addEventListener("keydown", async (e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
            e.preventDefault();
            await submitCurrentInput();
          }
        });
        sendButton.addEventListener("click", submitCurrentInput);

        const applyReaderActionToPane = async () => {
          const pendingDiscovery = addon.data.pendingDiscoveryConcerns?.get(
            item.id,
          );
          if (pendingDiscovery) {
            const activeSessionID = sessionStore.get(item.id)?.sessionId;
            if (
              pendingDiscovery.sessionId &&
              pendingDiscovery.sessionId !== activeSessionID
            ) {
              addon.data.pendingDiscoveryConcerns?.delete(item.id);
              return;
            }
            relatedConcern.value = pendingDiscovery.text;
            relatedConcernOrigin = pendingDiscovery.origin;
            relatedSection.setExpanded(true);
            addon.data.pendingDiscoveryConcerns?.delete(item.id);
            relatedRecommendButton.click();
            return;
          }
          const pending = addon.data.pendingReaderActions?.get(item.id);
          if (!pending) {
            return;
          }
          const activeSessionID = sessionStore.get(item.id)?.sessionId;
          if (pending.sessionId && pending.sessionId !== activeSessionID) {
            addon.data.pendingReaderActions?.delete(item.id);
            clearReaderActionDraft(item.id);
            return;
          }

          input.value = pending.question;
          input.dispatchEvent(
            new input.ownerDocument.defaultView!.Event("input"),
          );
          renderDraftCard(draftCard, item.id);
          input.focus();

          if (pending.autoSubmit) {
            await submitCurrentInput();
          }

          addon.data.pendingReaderActions?.delete(item.id);
        };
        addon.data.applyReaderActionToPane?.set(
          item.id,
          applyReaderActionToPane,
        );
        cleanupTasks.push(() => {
          if (
            addon.data.applyReaderActionToPane?.get(item.id) ===
            applyReaderActionToPane
          ) {
            addon.data.applyReaderActionToPane.delete(item.id);
          }
        });
        void addon.data.applyReaderActionToPane?.get(item.id)?.();
      }
    },
    onDestroy: ({ body }) => {
      paneCleanupByBody.get(body)?.();
      activePaneBodies.delete(body);
      paneCleanupByBody.delete(body);
      paneTemplateByBody.delete(body);
      paneLayoutByBody.delete(body);
    },
  });

  if (result) {
    addon.data.aiReaderPaneRegistered = true;
  }
}

function renderDraftCard(draftCard: HTMLElement, itemID: number) {
  const draft = addon.data.readerActionDrafts?.get(itemID);
  if (!draft) {
    draftCard.style.display = "none";
    draftCard.textContent = "";
    return;
  }

  const detail = draft.text
    ? `“${draft.text.slice(0, 180)}”`
    : draft.annotationIDs?.length
      ? `Annotations: ${draft.annotationIDs.join(", ")}`
      : "No text attached";

  draftCard.style.display = "block";
  draftCard.textContent = `Pending ${draft.source} action: ${draft.action} — ${detail}`;
}

function getCurrentProviderDescriptor(itemID?: number) {
  return getProviderDescriptorForItem(itemID);
}

function getModeShortLabel(mode?: EngineMode) {
  if (mode === "gemini_cli") {
    return "Gemini";
  }
  if (mode === "claude_code") {
    return "Claude";
  }
  return "Codex";
}

function getModeLabel(mode: EngineMode) {
  if (mode === "gemini_cli") return "Gemini CLI";
  if (mode === "claude_code") return "Claude Code";
  return "Codex CLI";
}

async function renderPaneState(params: {
  itemID: number;
  itemTitle: string;
  currentDocumentLabel: HTMLElement;
  autoHighlightStatus: HTMLElement;
  autoHighlightButton: HTMLButtonElement;
  researchBriefButton: HTMLButtonElement;
  contributionsButton: HTMLButtonElement;
  limitationsButton: HTMLButtonElement;
  followUpsButton: HTMLButtonElement;
  compareButton: HTMLButtonElement;
  compareHelper: HTMLElement;
  saveWorkbenchNoteButton: HTMLButtonElement;
  saveWorkbenchCollectionButton: HTMLButtonElement;
  clearWorkbenchButton: HTMLButtonElement;
  paperToolStatus: HTMLElement;
  paperToolCards: HTMLElement;
  modeChip: HTMLElement;
  modeStatus: HTMLElement;
  runStateCard: HTMLElement;
  codexActions: HTMLElement;
  policyWarning: HTMLElement;
  geminiFallbackCard: HTMLElement;
  geminiEmbedCard: HTMLElement;
  modelRow: HTMLElement;
  modelInput: HTMLSelectElement;
  codexOptionsRow: HTMLElement;
  codexWebSearchToggle: HTMLInputElement;
  modelHistory: HTMLElement;
  chatMessages: HTMLElement;
  draftCard: HTMLElement;
  streamingIndicator: HTMLElement;
  setSectionSummary: (summary: string) => void;
  isCurrent?: () => boolean;
}) {
  const defaultMode = getDefaultMode();
  const mode = getModeForItem(params.itemID);
  const descriptor = getCurrentProviderDescriptor(params.itemID);
  const session = sessionStore.getOrCreate(
    params.itemID,
    descriptor.mode,
    params.itemTitle,
  );
  addon.data.currentSessionId = session.sessionId;
  renderCurrentDocumentLabel(params.currentDocumentLabel, params.itemTitle);
  renderAutoHighlightState(
    params.autoHighlightButton,
    params.autoHighlightStatus,
    params.itemID,
  );
  renderPaperArtifactState(
    params.researchBriefButton,
    params.contributionsButton,
    params.limitationsButton,
    params.followUpsButton,
    params.saveWorkbenchNoteButton,
    params.saveWorkbenchCollectionButton,
    params.clearWorkbenchButton,
    params.paperToolStatus,
    params.paperToolCards,
    params.itemID,
  );
  renderCompareButtonState(
    params.compareButton,
    params.itemID,
    params.itemTitle,
  );
  renderCompareHelperState(
    params.compareHelper,
    params.itemID,
    params.itemTitle,
  );

  params.chatMessages.replaceChildren();
  renderRunStateCard(
    params.runStateCard,
    descriptor.mode,
    params.itemID,
    params.itemTitle,
    "not_checked",
  );
  renderCodexActions(params.codexActions, descriptor.mode);
  renderPolicyWarning(params.policyWarning, descriptor.mode);
  renderGeminiFallbackCard(params.geminiFallbackCard, descriptor.mode);
  renderGeminiEmbedCard(params.geminiEmbedCard, descriptor.mode);
  renderModelRow(params.modelRow, params.modelInput, descriptor.mode);
  renderCodexOptionsRow(
    params.codexOptionsRow,
    params.codexWebSearchToggle,
    descriptor.mode,
  );
  renderModelHistory(params.modelHistory, params.modelInput, descriptor.mode);
  renderModeHeader(
    params.modeChip,
    params.modeStatus,
    descriptor.label,
    descriptor.status,
  );
  renderMessageHistory(
    params.chatMessages,
    session.sessionId,
    descriptor.placeholderResponse,
  );
  renderDraftCard(params.draftCard, params.itemID);
  renderStreamingIndicator(params.streamingIndicator, false);
  params.setSectionSummary(`${descriptor.label} · ${descriptor.status}`);
  if (mode !== defaultMode) {
    params.modeStatus.textContent = `${params.modeStatus.textContent} · per-paper override`;
  }

  if (descriptor.mode === "codex_cli") {
    await refreshCodexStatus(
      params.modeChip,
      params.modeStatus,
      params.setSectionSummary,
      params.runStateCard,
      params.itemID,
      params.itemTitle,
      params.isCurrent,
    );
  }

  if (params.isCurrent && !params.isCurrent()) return;
  const activeRunMode = getActiveReaderRunMode(params.itemID);
  if (activeRunMode) {
    const activeLabel = getModeLabel(activeRunMode);
    renderModeHeader(
      params.modeChip,
      params.modeStatus,
      activeLabel,
      "running",
    );
    renderStreamingIndicator(params.streamingIndicator, true);
    params.setSectionSummary(`${activeLabel} · Running`);
  }
}

function renderCurrentDocumentLabel(
  currentDocumentLabel: HTMLElement,
  itemTitle: string,
) {
  currentDocumentLabel.textContent = `Document: ${itemTitle}`;
}

function getAutoHighlightState(itemID: number) {
  return (
    addon.data.autoHighlightStates?.get(itemID) || {
      running: false,
      status: "",
    }
  );
}

function setAutoHighlightState(
  itemID: number,
  state: { running: boolean; status: string },
) {
  addon.data.autoHighlightStates?.set(itemID, state);
}

function renderAutoHighlightState(
  button: HTMLButtonElement,
  status: HTMLElement,
  itemID: number,
) {
  const state = getAutoHighlightState(itemID);
  const enabled = shouldEnableAutoHighlight(true, state.running);
  button.disabled = !enabled;
  button.textContent = state.running
    ? "Highlighting…"
    : "Highlight key passages";
  status.textContent = state.status;
}

function getPaperArtifactState(itemID: number) {
  return (
    addon.data.paperArtifactStates?.get(itemID) || {
      running: false,
      status: "",
      cards: [] as PaperArtifactCard[],
    }
  );
}

interface WorkbenchElements {
  researchBriefButton: HTMLButtonElement;
  contributionsButton: HTMLButtonElement;
  limitationsButton: HTMLButtonElement;
  followUpsButton: HTMLButtonElement;
  saveWorkbenchNoteButton: HTMLButtonElement;
  saveWorkbenchCollectionButton: HTMLButtonElement;
  clearWorkbenchButton: HTMLButtonElement;
  statusElement: HTMLElement;
  cardsElement: HTMLElement;
}

function renderWorkbenchArtifactState(
  elements: WorkbenchElements,
  itemID: number,
) {
  renderPaperArtifactState(
    elements.researchBriefButton,
    elements.contributionsButton,
    elements.limitationsButton,
    elements.followUpsButton,
    elements.saveWorkbenchNoteButton,
    elements.saveWorkbenchCollectionButton,
    elements.clearWorkbenchButton,
    elements.statusElement,
    elements.cardsElement,
    itemID,
  );
}

function setPaperArtifactState(
  itemID: number,
  state: {
    running: boolean;
    status: string;
    activeKind?: PaperArtifactKind;
    cards: PaperArtifactCard[];
  },
) {
  addon.data.paperArtifactStates?.set(itemID, state);
}

function renderPaperArtifactState(
  researchBriefButton: HTMLButtonElement,
  contributionsButton: HTMLButtonElement,
  limitationsButton: HTMLButtonElement,
  followUpsButton: HTMLButtonElement,
  saveWorkbenchNoteButton: HTMLButtonElement,
  saveWorkbenchCollectionButton: HTMLButtonElement,
  clearWorkbenchButton: HTMLButtonElement,
  statusElement: HTMLElement,
  cardsElement: HTMLElement,
  itemID: number,
) {
  const state = getPaperArtifactState(itemID);
  researchBriefButton.disabled = state.running;
  contributionsButton.disabled = state.running;
  limitationsButton.disabled = state.running;
  followUpsButton.disabled = state.running;
  saveWorkbenchNoteButton.disabled = state.running || !state.cards.length;
  saveWorkbenchCollectionButton.disabled = state.running || !state.cards.length;
  clearWorkbenchButton.disabled = state.running || !state.cards.length;

  statusElement.style.display = state.status ? "block" : "none";
  statusElement.textContent = state.status;

  cardsElement.replaceChildren();
  if (!state.cards.length) {
    cardsElement.style.display = "none";
    return;
  }

  cardsElement.style.display = "flex";
  const doc = cardsElement.ownerDocument;
  for (const card of state.cards) {
    cardsElement.appendChild(buildPaperArtifactCardElement(doc, card, itemID));
  }
}

function getCurrentPaperTitle(itemID: number) {
  const item = Zotero.Items.get(itemID);
  return typeof item?.getField === "function"
    ? String(item.getField("title") || "").trim()
    : "";
}

function renderCompareButtonState(
  compareButton: HTMLButtonElement,
  itemID: number,
  currentPaperTitle = getCurrentPaperTitle(itemID),
) {
  const artifactState = getPaperArtifactState(itemID);
  if (artifactState.running && artifactState.activeKind === "paper-compare") {
    compareButton.disabled = true;
    compareButton.textContent = "Compare…";
    compareButton.title = "Generating paper comparison…";
    compareButton.setAttribute(
      "aria-label",
      "Compare unavailable while a paper comparison is generating",
    );
    return;
  }

  const recommendationState = getRelatedRecommendationState(itemID);
  const state = getPaperCompareButtonState({
    currentPaperTitle,
    groups: recommendationState.groups,
  });
  compareButton.disabled = recommendationState.running || !state.enabled;
  compareButton.textContent = state.label;
  compareButton.title = recommendationState.running
    ? "Compare unlocks when related paper recommendations finish."
    : state.title;
  compareButton.setAttribute(
    "aria-label",
    recommendationState.running
      ? "Compare unavailable while related paper recommendations are running"
      : state.ariaLabel,
  );
}

function renderCompareHelperState(
  compareHelper: HTMLElement,
  itemID: number,
  currentPaperTitle = getCurrentPaperTitle(itemID),
) {
  const workflowState = getPaperCompareWorkflowState({
    currentPaperTitle,
    groups: getRelatedRecommendationState(itemID).groups,
    recommendationsRunning: getRelatedRecommendationState(itemID).running,
  });
  compareHelper.textContent = workflowState.helperText;
  compareHelper.className =
    workflowState.tone === "ready"
      ? "pp-compare-helper pp-compare-helper--ready"
      : "pp-compare-helper pp-compare-helper--default";
}

function buildPaperArtifactCardElement(
  doc: Document,
  card: PaperArtifactCard,
  itemID: number,
) {
  const root = doc.createElement("section");
  root.className = "pp-artifact-card";

  const titleRow = doc.createElement("div");
  titleRow.className = "pp-artifact-card__header";
  const title = doc.createElement("div");
  title.textContent = card.title;
  title.className = "pp-artifact-card__title";
  const updated = doc.createElement("div");
  updated.textContent = new Date(card.updatedAt).toLocaleTimeString();
  updated.className = "pp-artifact-card__time";
  titleRow.append(title, updated);
  root.appendChild(titleRow);

  const summary = doc.createElement("div");
  summary.textContent = card.summary;
  summary.className = "pp-artifact-card__summary";
  root.appendChild(summary);

  const sourceLabel = doc.createElement("div");
  sourceLabel.textContent = card.sourceLabel;
  sourceLabel.className = "pp-artifact-card__source";
  root.appendChild(sourceLabel);

  for (const section of card.sections) {
    const sectionRoot = doc.createElement("div");
    sectionRoot.className = "pp-artifact-card__section";

    const headingRow = doc.createElement("div");
    headingRow.className = "pp-artifact-card__section-header";

    const heading = doc.createElement("div");
    heading.textContent = section.heading;
    heading.className = "pp-artifact-card__section-heading";
    headingRow.appendChild(heading);

    if (section.evidence) {
      const evidence = doc.createElement("span");
      evidence.textContent = section.evidence;
      evidence.className = "pp-artifact-card__evidence";
      headingRow.appendChild(evidence);
    }

    const list = doc.createElement("ul");
    list.className = "pp-artifact-card__list";
    for (const item of section.items) {
      const bullet = doc.createElement("li");
      const itemText = doc.createElement("span");
      itemText.textContent = item;
      bullet.appendChild(itemText);
      if (
        card.kind === "extract-limitations" ||
        card.kind === "suggest-follow-ups"
      ) {
        const findPriorWork = doc.createElement("button");
        findPriorWork.className = "pp-btn pp-btn--ghost";
        findPriorWork.textContent = "Find prior work";
        findPriorWork.addEventListener("click", () => {
          addon.data.pendingDiscoveryConcerns?.set(itemID, {
            sessionId: sessionStore.get(itemID)?.sessionId,
            text: item,
            origin:
              card.kind === "extract-limitations" ? "limitation" : "follow_up",
            updatedAt: new Date().toISOString(),
          });
          void addon.data.applyReaderActionToPane?.get(itemID)?.();
        });
        bullet.appendChild(findPriorWork);
      }
      list.appendChild(bullet);
    }

    sectionRoot.append(headingRow, list);
    root.appendChild(sectionRoot);
  }

  if (card.searchQueries?.length) {
    const queriesHeading = doc.createElement("div");
    queriesHeading.textContent = "Search queries";
    queriesHeading.className = "pp-artifact-card__section-heading";
    root.appendChild(queriesHeading);

    const list = doc.createElement("ul");
    list.className = "pp-artifact-card__list";
    for (const query of card.searchQueries) {
      const bullet = doc.createElement("li");
      bullet.textContent = query.rationale
        ? `${query.query} — ${query.rationale}`
        : query.query;
      list.appendChild(bullet);
    }
    root.appendChild(list);
  }

  return root;
}

function getRelatedRecommendationState(itemID: number) {
  const activeSessionID = sessionStore.get(itemID)?.sessionId;
  const stored = addon.data.relatedRecommendationStates?.get(itemID);
  return stored && stored.sessionID === activeSessionID
    ? stored
    : {
        sessionID: activeSessionID,
        running: false,
        status: "",
        groups: [],
      };
}

function renderRelatedRecommendationState(
  button: HTMLButtonElement,
  status: HTMLElement,
  groupsContainer: HTMLElement,
  compareButton: HTMLButtonElement,
  compareHelper: HTMLElement,
  itemID: number,
  currentPaperTitle = getCurrentPaperTitle(itemID),
) {
  const state = getRelatedRecommendationState(itemID);
  const doc = groupsContainer.ownerDocument;
  const pane = groupsContainer.closest("#paper-pilot-container");
  const saveButton = pane?.querySelector(
    "#chat-related-save",
  ) as HTMLButtonElement | null;
  if (saveButton) saveButton.disabled = state.running || !state.discovery;
  button.disabled = false;
  button.textContent = state.reviewInsightRunningCandidateID
    ? "Cancel review insights"
    : state.running
      ? "Cancel discovery"
      : state.groups.length
        ? "Refresh verified prior work"
        : "Find verified prior work";
  status.style.display = state.status ? "block" : "none";
  status.textContent = state.status;
  renderCompareButtonState(compareButton, itemID, currentPaperTitle);
  renderCompareHelperState(compareHelper, itemID, currentPaperTitle);

  const rerender = () =>
    renderRelatedRecommendationState(
      button,
      status,
      groupsContainer,
      compareButton,
      compareHelper,
      itemID,
      currentPaperTitle,
    );
  const setFailure = (error: unknown) => {
    const current = getRelatedRecommendationState(itemID);
    addon.data.relatedRecommendationStates?.set(itemID, {
      ...current,
      status:
        error instanceof Error
          ? error.message
          : "The discovery action could not be completed.",
    });
    rerender();
  };
  const samePaper = (
    left: Pick<
      RecommendedPaper,
      "candidateID" | "title" | "authors" | "year" | "doi" | "providerIDs"
    >,
    right: Pick<
      RecommendedPaper,
      "candidateID" | "title" | "authors" | "year" | "doi" | "providerIDs"
    >,
  ) =>
    (!left.candidateID ||
      !right.candidateID ||
      left.candidateID === right.candidateID) &&
    areLikelySamePaper(
      {
        title: left.title,
        authors: left.authors || [],
        year: left.year,
        doi: left.doi,
        providerIDs: left.providerIDs || {},
      },
      {
        title: right.title,
        authors: right.authors || [],
        year: right.year,
        doi: right.doi,
        providerIDs: right.providerIDs || {},
      },
    );
  const updateDiscoveryPaper = (
    discovery: typeof state.discovery,
    paper: RecommendedPaper,
    patch: Partial<RecommendedPaper>,
  ) => {
    if (!discovery) return discovery;
    const updateLane = (lane: typeof discovery.verifiedMain) =>
      lane.map((entry) =>
        samePaper(entry, paper)
          ? {
              ...entry,
              ...(patch.existingItemID
                ? { existingItemID: patch.existingItemID }
                : {}),
              ...(patch.reviewInsight
                ? { reviewInsight: patch.reviewInsight }
                : {}),
            }
          : entry,
      );
    return {
      ...discovery,
      verifiedMain: updateLane(discovery.verifiedMain),
      otherPeerReviewed: updateLane(discovery.otherPeerReviewed),
      noveltyRadar: updateLane(discovery.noveltyRadar),
    };
  };
  const criticalRead = addon.data.criticalReadStates?.get(itemID);
  const reviewInsightsVisible = canViewPublicReviewInsights(criticalRead);

  renderDiscoverySection({
    container: groupsContainer,
    groups: state.groups,
    discovery: state.discovery,
    buildRow: (paper) =>
      buildDiscoveryRow({
        doc,
        paper,
        reviewInsightsVisible,
        canViewReviewInsights: () =>
          canViewPublicReviewInsights(
            addon.data.criticalReadStates?.get(itemID),
          ),
        reviewInsightRunning:
          state.reviewInsightRunningCandidateID === paper.candidateID,
        actions: {
          onOpen: (target) =>
            openRecommendedPaper(target, {
              includeReviewURL: canViewPublicReviewInsights(
                addon.data.criticalReadStates?.get(itemID),
              ),
            }),
          onOpenURL: (url) => Zotero.launchURL(url),
          onError: setFailure,
          onAdd: async (target) => {
            const result = await addRecommendationToCollection({
              sourceItemID: itemID,
              paper: target,
              includeReviewURL: canViewPublicReviewInsights(
                addon.data.criticalReadStates?.get(itemID),
              ),
            });
            const current = getRelatedRecommendationState(itemID);
            const patch = { existingItemID: result.itemID };
            addon.data.relatedRecommendationStates?.set(itemID, {
              ...current,
              running: false,
              status: "Added to collection",
              groups: current.groups.map((group: RecommendationGroup) => ({
                ...group,
                papers: group.papers.map((entry) =>
                  samePaper(entry, target) ? { ...entry, ...patch } : entry,
                ),
              })),
              discovery: updateDiscoveryPaper(current.discovery, target, patch),
            });
            rerender();
            await sessionHistoryService.persistActiveSession({
              itemID,
              paperTitle: currentPaperTitle,
            });
          },
          onReviewInsight: async (target) => {
            const runningController = publicReviewAbortControllers.get(itemID);
            if (runningController) {
              runningController.abort(
                new Error("Public-review analysis cancelled."),
              );
              const current = getRelatedRecommendationState(itemID);
              addon.data.relatedRecommendationStates?.set(itemID, {
                ...current,
                status: "Cancelling public-review analysis…",
              });
              rerender();
              return;
            }
            if (
              !canViewPublicReviewInsights(
                addon.data.criticalReadStates?.get(itemID),
              )
            ) {
              throw new Error(
                "Complete Critical Read Steps 4–6 before viewing public review insights.",
              );
            }
            const abortController = createPaneAbortController(doc);
            publicReviewAbortControllers.set(itemID, abortController);
            const before = getRelatedRecommendationState(itemID);
            addon.data.relatedRecommendationStates?.set(itemID, {
              ...before,
              reviewInsightRunningCandidateID:
                target.candidateID || target.title,
              status: "Reading public reviews…",
            });
            rerender();
            try {
              const insight = await generatePublicReviewInsight({
                itemID,
                itemTitle: currentPaperTitle,
                paper: target,
                signal: abortController.signal,
                onStatus: (message) => {
                  const current = getRelatedRecommendationState(itemID);
                  addon.data.relatedRecommendationStates?.set(itemID, {
                    ...current,
                    status: message,
                  });
                  status.textContent = message;
                  status.style.display = "block";
                },
              });
              const current = getRelatedRecommendationState(itemID);
              const patch = { reviewInsight: insight };
              addon.data.relatedRecommendationStates?.set(itemID, {
                ...current,
                reviewInsightRunningCandidateID: undefined,
                status: "Public review insights ready",
                groups: current.groups.map((group: RecommendationGroup) => ({
                  ...group,
                  papers: group.papers.map((entry) =>
                    samePaper(entry, target) ? { ...entry, ...patch } : entry,
                  ),
                })),
                discovery: updateDiscoveryPaper(
                  current.discovery,
                  target,
                  patch,
                ),
              });
              const criticalState = addon.data.criticalReadStates?.get(itemID);
              if (criticalState) {
                let updatedCritical = attachPublicReviewInsightToCriticalRead({
                  state: criticalState,
                  paper: target,
                  insight,
                });
                if (updatedCritical !== criticalState) {
                  updatedCritical = {
                    ...updatedCritical,
                    reportMarkdown:
                      updatedCritical.phase === "complete"
                        ? buildCriticalReadReportMarkdown({
                            paperTitle: currentPaperTitle,
                            state: updatedCritical,
                          })
                        : undefined,
                  };
                  addon.data.criticalReadStates?.set(itemID, updatedCritical);
                }
              }
            } finally {
              if (
                publicReviewAbortControllers.get(itemID) === abortController
              ) {
                publicReviewAbortControllers.delete(itemID);
              }
              const current = getRelatedRecommendationState(itemID);
              if (current.reviewInsightRunningCandidateID) {
                addon.data.relatedRecommendationStates?.set(itemID, {
                  ...current,
                  reviewInsightRunningCandidateID: undefined,
                });
              }
              rerender();
            }
            await sessionHistoryService.persistActiveSession({
              itemID,
              paperTitle: currentPaperTitle,
            });
          },
        },
      }),
  });
}
async function refreshCodexStatus(
  chip: HTMLElement,
  status: HTMLElement,
  setSectionSummary: (summary: string) => void,
  runStateCard: HTMLElement,
  itemID: number,
  itemTitle: string,
  isCurrent: () => boolean = () => true,
) {
  try {
    if (!isCurrent() || getActiveReaderRunMode(itemID)) return;
    renderModeHeader(chip, status, "Codex CLI", "checking");
    const loginState = await probeCodexLoginState();
    if (!isCurrent() || getActiveReaderRunMode(itemID)) return;
    const workspaceRoot = resolvePaperWorkspaceRoot(
      getPref("codexWorkspaceRoot"),
    );
    const workspaceWritable = await probeWorkspaceWritable(workspaceRoot);
    if (!isCurrent() || getActiveReaderRunMode(itemID)) return;
    renderModeHeader(chip, status, "Codex CLI", loginState);
    status.textContent = `${status.textContent}${workspaceWritable ? "" : " · workspace not writable"}`;
    setSectionSummary(`Codex CLI · ${getStatusLabel(loginState)}`);
    renderRunStateCard(
      runStateCard,
      "codex_cli",
      itemID,
      itemTitle,
      loginState,
      workspaceWritable,
    );
  } catch {
    if (!isCurrent() || getActiveReaderRunMode(itemID)) return;
    renderModeHeader(chip, status, "Codex CLI", "error");
    setSectionSummary("Codex CLI · Error");
    renderRunStateCard(
      runStateCard,
      "codex_cli",
      itemID,
      itemTitle,
      "unavailable",
      false,
    );
  }
}

function renderRunStateCard(
  runStateCard: HTMLElement,
  mode: EngineMode,
  itemID: number,
  itemTitle: string,
  loginState: "ready" | "login_required" | "unavailable" | "not_checked",
  workspaceWritable?: boolean,
) {
  void mode;
  void itemTitle;
  void loginState;
  void workspaceWritable;
  runProgressCardByContainer
    .get(runStateCard)
    ?.render(getRunProgressState(itemID));
}

function renderCodexActions(codexActions: HTMLElement, mode: EngineMode) {
  codexActions.style.display = mode === "codex_cli" ? "flex" : "none";
}

function renderPolicyWarning(policyWarning: HTMLElement, mode: EngineMode) {
  const shouldShow = mode === "gemini_cli" && false;
  if (!shouldShow) {
    policyWarning.style.display = "none";
    policyWarning.textContent = "";
    return;
  }

  policyWarning.style.display = "block";
  policyWarning.textContent =
    "Gemini CLI mode runs through the local Gemini CLI and follows the current workspace/tooling constraints.";
}

function renderGeminiFallbackCard(
  geminiFallbackCard: HTMLElement,
  mode: EngineMode,
) {
  void mode;
  geminiFallbackCard.style.display = "none";
  geminiFallbackCard.textContent = "";
}

function renderGeminiEmbedCard(geminiEmbedCard: HTMLElement, mode: EngineMode) {
  void mode;
  geminiEmbedCard.style.display = "none";
  geminiEmbedCard.textContent = "";
}

function confirmDestructive(
  ownerDocument: Document,
  title: string,
  message: string,
): boolean {
  const services = (
    globalThis as {
      Services?: { prompt?: { confirm?: (...args: unknown[]) => boolean } };
    }
  ).Services;
  const win = ownerDocument.defaultView ?? null;
  const promptConfirm = services?.prompt?.confirm;
  if (typeof promptConfirm === "function") {
    try {
      return Boolean(promptConfirm(win, title, message));
    } catch {
      // fall through to window.confirm
    }
  }
  if (win && typeof win.confirm === "function") {
    return win.confirm(`${title}\n\n${message}`);
  }
  return false;
}

function renderHelpState(chatMessages: HTMLElement, response: string) {
  if (chatMessages.childElementCount > 0) {
    return;
  }

  const doc = chatMessages.ownerDocument;
  const help = doc.createElement("div");
  help.className = "pp-chat-help";
  help.dataset.ppChatHelp = "true";
  help.setAttribute("role", "note");

  const title = doc.createElement("div");
  title.className = "pp-chat-help__title";
  title.textContent = "Start with this paper";

  const body = doc.createElement("div");
  body.className = "pp-chat-help__body";
  body.textContent = response;

  help.append(title, body);
  chatMessages.appendChild(help);
}

function renderMessageHistory(
  chatMessages: HTMLElement,
  sessionId: string,
  placeholderResponse: string,
) {
  const getMessages = () =>
    messageStore
      .list(sessionId)
      .filter((message) => !isLikelySilentToolMessage(message));
  const messages = getMessages();

  if (!messages.length) {
    disposeChatTranscriptWindow(chatMessages);
    renderHelpState(chatMessages, placeholderResponse);
    return;
  }

  renderChatTranscriptWindow({
    container: chatMessages,
    getItems: getMessages,
    getKey: (message) => message.id,
    renderItem: (message) => {
      const messageElement = addMessage(
        chatMessages,
        message.status === "error" ? `Error: ${message.text}` : message.text,
        message.role === "assistant" ? "ai" : "user",
      );
      return messageElement?.parentElement || null;
    },
  });
}

function renderStreamingIndicator(
  streamingIndicator: HTMLElement,
  visible: boolean,
) {
  streamingIndicator.style.display = visible ? "flex" : "none";
}

function getActiveRunMessage(mode: EngineMode, itemID: number) {
  if (
    getPendingEngineCompletion(itemID) ||
    isReaderLifecycleClaimActive(itemID)
  ) {
    return "A run is already starting, running, or finishing for this paper. Wait for it to settle before starting another request.";
  }

  if (mode === "codex_cli" && isCodexRunActiveForItem(itemID)) {
    return "A Codex CLI run is already active for this paper. Cancel it or wait for it to finish before starting another request.";
  }

  if (mode === "claude_code" && isClaudeRunActiveForItem(itemID)) {
    return "A Claude Code run is already active for this paper. Wait for it to finish before starting another request.";
  }

  if (mode === "gemini_cli" && isGeminiRunActiveForItem(itemID)) {
    return "A Gemini CLI run is already active for this paper. Wait for it to finish before starting another request.";
  }

  return undefined;
}

async function runCriticalReadAgentRequest(params: {
  item: Zotero.Item;
  state: CriticalReadState;
  readerInput: string;
  input: HTMLTextAreaElement;
  chatMessages: HTMLElement;
  streamingIndicator: HTMLElement;
  onAdmitted(): void;
  onComplete(result: {
    success: boolean;
    assistantText: string;
  }): void | Promise<void>;
}) {
  const step = getCriticalReadStep(params.state);
  if (!step || step.id === 3) {
    throw new Error("This Critical Read step does not use the paper agent.");
  }
  const prompt = buildCriticalReadStepPrompt({
    state: params.state,
    stepID: step.id,
    readerInput: params.readerInput || undefined,
    responseLanguage: normalizeResponseLanguage(getPref("responseLanguage")),
  });
  params.input.value = prompt;
  await handleUserInput(
    params.input,
    params.chatMessages,
    getCurrentProviderDescriptor(params.item.id).mode,
    params.item.id,
    params.item.getField("title"),
    getCurrentProviderDescriptor(params.item.id).placeholderResponse,
    params.streamingIndicator,
    {
      displayQuestion: `Critical Read · Step ${step.id}`,
      silentUserMessage: true,
      suppressChatMessages: true,
      profile: "analysis",
      outputSchema: getCriticalReadOutputSchema(step.id),
      onAdmitted: params.onAdmitted,
      onComplete: params.onComplete,
    },
  );
}

async function runPaperArtifactRequest(params: {
  item: Zotero.Item;
  kind: PaperArtifactKind;
  input: HTMLTextAreaElement;
  chatMessages: HTMLElement;
  streamingIndicator: HTMLElement;
  statusElement: HTMLElement;
  cardsElement: HTMLElement;
  elements: WorkbenchElements;
  onStateChange?: () => void;
}) {
  const request = buildPaperArtifactRequest(params.item, params.kind);
  const existing = getPaperArtifactState(params.item.id);
  const markAdmitted = () => {
    setPaperArtifactState(params.item.id, {
      running: true,
      status: `Generating ${request.label.toLowerCase()}…`,
      activeKind: params.kind,
      cards: existing.cards,
    });

    renderWorkbenchArtifactState(params.elements, params.item.id);
  };

  params.input.value = request.prompt;
  await handleUserInput(
    params.input,
    params.chatMessages,
    getCurrentProviderDescriptor(params.item.id).mode,
    params.item.id,
    params.item.getField("title"),
    getCurrentProviderDescriptor(params.item.id).placeholderResponse,
    params.streamingIndicator,
    {
      displayQuestion: request.label,
      silentUserMessage: true,
      suppressChatMessages: true,
      profile: "analysis",
      outputSchema: request.outputSchema,
      onAdmitted: markAdmitted,
      onComplete: async ({ success, assistantText }) => {
        if (!success) {
          setPaperArtifactState(params.item.id, {
            running: false,
            status: `${request.label} failed: ${assistantText}`,
            cards: getPaperArtifactState(params.item.id).cards,
          });
        } else {
          try {
            const card = parsePaperArtifactCard(request.kind, assistantText);
            const cards = [
              card,
              ...getPaperArtifactState(params.item.id).cards.filter(
                (existingCard) => existingCard.kind !== card.kind,
              ),
            ];
            setPaperArtifactState(params.item.id, {
              running: false,
              status: `${request.label} ready`,
              activeKind: request.kind,
              cards,
            });
          } catch (error) {
            setPaperArtifactState(params.item.id, {
              running: false,
              status:
                error instanceof Error
                  ? `${request.label} parse failed: ${error.message}`
                  : `${request.label} parse failed.`,
              cards: getPaperArtifactState(params.item.id).cards,
            });
          }
        }

        renderWorkbenchArtifactState(params.elements, params.item.id);
        params.onStateChange?.();
        await sessionHistoryService.persistActiveSession({
          itemID: params.item.id,
          paperTitle: String(params.item.getField("title") || ""),
        });
      },
    },
  );
}

async function runPaperCompareRequest(params: {
  item: Zotero.Item;
  input: HTMLTextAreaElement;
  chatMessages: HTMLElement;
  streamingIndicator: HTMLElement;
  statusElement: HTMLElement;
  cardsElement: HTMLElement;
  compareButton: HTMLButtonElement;
  elements: WorkbenchElements;
  onStateChange?: () => void;
}) {
  const groups = getRelatedRecommendationState(params.item.id).groups;
  const currentTitle = String(params.item.getField("title") || "").trim();
  const currentAuthors =
    typeof params.item.getCreators === "function"
      ? params.item
          .getCreators()
          .map((creator: { firstName?: string; lastName?: string }) =>
            [creator.firstName, creator.lastName]
              .filter(Boolean)
              .join(" ")
              .trim(),
          )
          .filter(Boolean)
      : [];

  let request: ReturnType<typeof buildPaperCompareRequestFromRecommendations>;
  try {
    request = buildPaperCompareRequestFromRecommendations({
      currentPaper: {
        title: currentTitle || "Unknown title",
        authors: currentAuthors,
        year:
          params.item.getField("year") ||
          params.item.getField("date") ||
          undefined,
        abstract: params.item.getField("abstractNote") || undefined,
      },
      groups,
      includeReviewURLs: canViewPublicReviewInsights(
        addon.data.criticalReadStates?.get(params.item.id),
      ),
      responseLanguage: normalizeResponseLanguage(getPref("responseLanguage")),
    });
  } catch (error) {
    setPaperArtifactState(params.item.id, {
      ...getPaperArtifactState(params.item.id),
      running: false,
      status:
        error instanceof Error
          ? `Compare unavailable: ${error.message}`
          : "Compare unavailable.",
      cards: getPaperArtifactState(params.item.id).cards,
    });
    renderWorkbenchArtifactState(params.elements, params.item.id);
    params.onStateChange?.();
    return;
  }

  const existing = getPaperArtifactState(params.item.id);
  const markAdmitted = () => {
    params.compareButton.disabled = true;
    setPaperArtifactState(params.item.id, {
      running: true,
      status: "Generating paper comparison…",
      activeKind: "paper-compare",
      cards: existing.cards,
    });
    renderCompareButtonState(
      params.compareButton,
      params.item.id,
      currentTitle,
    );
    renderWorkbenchArtifactState(params.elements, params.item.id);
  };

  params.input.value = request.prompt;
  await handleUserInput(
    params.input,
    params.chatMessages,
    getCurrentProviderDescriptor(params.item.id).mode,
    params.item.id,
    params.item.getField("title"),
    getCurrentProviderDescriptor(params.item.id).placeholderResponse,
    params.streamingIndicator,
    {
      displayQuestion: request.label,
      silentUserMessage: true,
      suppressChatMessages: true,
      profile: "analysis",
      outputSchema: request.outputSchema,
      onAdmitted: markAdmitted,
      onComplete: async ({ success, assistantText }) => {
        if (!success) {
          setPaperArtifactState(params.item.id, {
            running: false,
            status: `Compare failed: ${assistantText}`,
            cards: getPaperArtifactState(params.item.id).cards,
          });
        } else {
          try {
            const card = buildPaperCompareCard(
              parsePaperCompareResponse(assistantText, request.selection),
              request.selection,
            );
            const cards = [
              card,
              ...getPaperArtifactState(params.item.id).cards.filter(
                (existingCard) => existingCard.kind !== card.kind,
              ),
            ];
            setPaperArtifactState(params.item.id, {
              running: false,
              status: "Compare ready",
              activeKind: "paper-compare",
              cards,
            });
          } catch (error) {
            setPaperArtifactState(params.item.id, {
              running: false,
              status:
                error instanceof Error
                  ? `Compare parse failed: ${error.message}`
                  : "Compare parse failed.",
              cards: getPaperArtifactState(params.item.id).cards,
            });
          }
        }

        renderCompareButtonState(
          params.compareButton,
          params.item.id,
          currentTitle,
        );
        renderWorkbenchArtifactState(params.elements, params.item.id);
        params.onStateChange?.();
        await sessionHistoryService.persistActiveSession({
          itemID: params.item.id,
          paperTitle: String(params.item.getField("title") || ""),
        });
      },
    },
  );
}

async function handleUserInput(
  input: HTMLTextAreaElement,
  chatMessages: HTMLElement,
  mode: EngineMode,
  itemID: number,
  itemTitle: string,
  placeholderResponse: string,
  streamingIndicator: HTMLElement,
  options?: {
    displayQuestion?: string;
    silentUserMessage?: boolean;
    profile?: RunProfile;
    outputSchema?: StructuredOutputSchema;
    suppressChatMessages?: boolean;
    continuationToken?: ReaderRunToken;
    onAdmitted?: () => void;
    onComplete?: (result: ReaderRunCompletionResult) => void | Promise<void>;
  },
) {
  const question = input.value.trim();
  if (!question) {
    return;
  }

  const activeRunMessage = getActiveRunMessage(mode, itemID);
  const continuingParent = Boolean(
    options?.continuationToken &&
      isReaderRunTokenActive(itemID, options.continuationToken),
  );
  if (activeRunMessage && !continuingParent) {
    if (options?.silentUserMessage) {
      input.value = "";
      input.style.height = `${CHAT_INPUT_MIN_HEIGHT}px`;
    }
    if (!options?.suppressChatMessages) {
      addMessage(chatMessages, activeRunMessage, "ai");
    }
    return;
  }

  const admissionToken = claimChatEngineRequest(itemID);
  if (!admissionToken) {
    const assistantText =
      "A run is already starting, running, or finishing for this paper. Wait for it to settle before starting another request.";
    if (!options?.suppressChatMessages) {
      addMessage(chatMessages, assistantText, "ai");
    }
    return;
  }

  try {
    const profile = options?.profile || "chat";
    options?.onAdmitted?.();
    ztoolkit.log("Placeholder question:", question);
    if (!options?.silentUserMessage) {
      chatMessages.querySelector('[data-pp-chat-help="true"]')?.remove();
      addMessage(chatMessages, options?.displayQuestion || question, "user");
    }
    input.value = "";
    input.style.height = `${CHAT_INPUT_MIN_HEIGHT}px`;
    input.scrollTop = 0;
    input.disabled = true;
    renderStreamingIndicator(streamingIndicator, true);

    const activeSessionID = sessionStore.get(itemID)?.sessionId;
    const candidateDraft = addon.data.readerActionDrafts?.get(itemID);
    const draft =
      candidateDraft &&
      (!candidateDraft.sessionId ||
        candidateDraft.sessionId === activeSessionID)
        ? candidateDraft
        : undefined;
    if (candidateDraft && !draft) clearReaderActionDraft(itemID);
    const readerContext: { selectedText?: string } | undefined = draft
      ? undefined
      : await getCurrentReaderContext().catch(() => ({
          selectedText: undefined,
        }));
    const selectedText =
      draft?.text ||
      (readerContext?.selectedText
        ? String(readerContext.selectedText)
        : undefined);
    const session = options?.silentUserMessage
      ? sessionStore.touch(itemID, mode, itemTitle)
      : await sessionHistoryService.persistUserMessage({
          itemID,
          mode,
          paperTitle: itemTitle,
          text: question,
        });
    if (mode === "codex_cli") {
      if (draft) {
        if (!options?.suppressChatMessages) {
          addMessage(
            chatMessages,
            `Attached draft from ${draft.source}: ${draft.action}`,
            "ai",
          );
        }
        clearReaderActionDraft(itemID);
      }

      await handleCodexQuestion({
        itemID,
        sessionId: session.sessionId,
        sessionTitle: session.threadTitle,
        paperTitle: itemTitle,
        question,
        selectedText,
        annotationIDs: draft?.annotationIDs,
        useResume: profile === "chat" && Boolean(session.lastCodexSessionID),
        resumeSessionId:
          profile === "chat" ? session.lastCodexSessionID : undefined,
        profile,
        outputSchema: options?.outputSchema,
        chatMessages,
        streamingIndicator,
        suppressChatMessages: options?.suppressChatMessages,
        continuationToken: options?.continuationToken,
        onComplete: options?.onComplete,
      });
      return;
    }

    if (mode === "claude_code") {
      if (draft) {
        if (!options?.suppressChatMessages) {
          addMessage(
            chatMessages,
            `Attached draft from ${draft.source}: ${draft.action}`,
            "ai",
          );
        }
        clearReaderActionDraft(itemID);
      }

      await handleClaudeQuestion({
        itemID,
        sessionId: session.sessionId,
        sessionTitle: session.threadTitle,
        paperTitle: itemTitle,
        question,
        selectedText,
        annotationIDs: draft?.annotationIDs,
        resumeSessionId:
          profile === "chat" ? session.lastClaudeSessionID : undefined,
        profile,
        outputSchema: options?.outputSchema,
        chatMessages,
        streamingIndicator,
        suppressChatMessages: options?.suppressChatMessages,
        continuationToken: options?.continuationToken,
        onComplete: options?.onComplete,
      });
      return;
    }

    if (mode === "gemini_cli") {
      if (draft) {
        if (!options?.suppressChatMessages) {
          addMessage(
            chatMessages,
            `Attached draft from ${draft.source}: ${draft.action}`,
            "ai",
          );
        }
        clearReaderActionDraft(itemID);
      }

      await handleGeminiQuestion({
        itemID,
        sessionId: session.sessionId,
        sessionTitle: session.threadTitle,
        paperTitle: itemTitle,
        question,
        selectedText,
        annotationIDs: draft?.annotationIDs,
        resumeSessionId:
          profile === "chat" ? session.lastGeminiSessionID : undefined,
        profile,
        outputSchema: options?.outputSchema,
        chatMessages,
        streamingIndicator,
        suppressChatMessages: options?.suppressChatMessages,
        continuationToken: options?.continuationToken,
        onComplete: options?.onComplete,
      });
      return;
    }

    if (draft) {
      if (!options?.suppressChatMessages) {
        addMessage(
          chatMessages,
          `Attached draft from ${draft.source}: ${draft.action}`,
          "ai",
        );
      }
      clearReaderActionDraft(itemID);
    }
    const assistantText = `${placeholderResponse}\n\nGemini CLI mode is active.`;
    if (!options?.suppressChatMessages) {
      addMessage(chatMessages, assistantText, "ai");
      messageStore.append(session.sessionId, {
        role: "assistant",
        text: assistantText,
        sourceMode: mode,
        status: "done",
      });
    }
    await options?.onComplete?.({
      success: true,
      assistantText,
    });
  } finally {
    releaseChatEngineRequest(itemID, admissionToken);
    if (
      mode !== "codex_cli" &&
      mode !== "claude_code" &&
      mode !== "gemini_cli"
    ) {
      renderStreamingIndicator(streamingIndicator, false);
    }
    input.disabled = false;
    input.focus();
  }
}
