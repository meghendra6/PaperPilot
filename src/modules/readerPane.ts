import { config } from "../../package.json";
import { getLocaleID } from "../utils/locale";
import { getPref, setPref } from "../utils/prefs";
import {
  clearModeOverrideForItem,
  getDefaultMode,
  getModeForItem,
  hasModeOverrideForItem,
  selectModeForItem,
} from "./ai/modeStore";
import { getProviderDescriptorForItem } from "./ai/providerRegistry";
import { retryLastEngineQuestion } from "./ai/retryEngineRequest";
import { cancelActiveEngineRun } from "./ai/runControl";
import {
  advanceRunProgress,
  claimChatEngineRequest,
  failRunProgress,
  isChatEngineRequestPending,
  isChatPreparationCancelled,
  startRunProgress,
  claimReaderSessionTransition,
  getPendingEngineCompletion,
  isReaderLifecycleClaimActive,
  releaseChatEngineRequest,
  releaseReaderSessionTransition,
} from "./ai/runLifecycle";
import {
  getActiveReaderRunMode,
  isReaderRunTokenActive,
  notifyReaderPaneStateChanged,
  subscribeToReaderRunEvents,
  type ReaderRunCompletionResult,
  type ReaderRunToken,
} from "./ai/runPresentation";
import type { RunProfile } from "./ai/runProfile";
import {
  clearTerminalRunProgressState,
  getRunProgressState,
  isRunProgressVisibleInSession,
} from "./ai/runProgress";
import { isReaderChatBusy } from "./ai/readerBusy";
import {
  getBusySubmitHint,
  renderChatComposer,
  shouldIgnoreStopActivation,
} from "./ui/chatComposer";
import { captureChatSearchReturn } from "./ui/chatSearchReturn";
import { getStatusLabel } from "./ai/statusLabels";
import type { StructuredOutputSchema } from "./ai/structuredOutput";
import type { EngineMode } from "./ai/types";
import {
  formatAutoHighlightCancelledStatus,
  getAutoHighlightButtonPresentation,
} from "./autoHighlight/status";
import {
  AutoHighlightCancelledError,
  runAutoHighlightWorkflow,
} from "./autoHighlight/workflow";
import {
  handleClaudeQuestion,
  stopClaudeRunSilently,
} from "./claude/controller";
import { isClaudeRunActiveForItem } from "./claude/runState";
import { buildCodexAuthenticateMessage } from "./codex/authAction";
import { handleCodexQuestion, stopCodexRunSilently } from "./codex/controller";
import { rememberRecentModel } from "./codex/modelHistory";
import {
  normalizeClaudeModel,
  normalizeClaudeReasoningEffort,
  normalizeCodexModel,
  normalizeCodexReasoningEffort,
} from "./codex/modelOptions";
import { isCodexRunActiveForItem } from "./codex/runState";
import { probeCodexLoginState } from "./codex/status";
import { addMessage } from "./components/ChatMessage";
import { renderMarkdownFragment } from "./components/markdownRenderer";
import {
  createCanonicalMasteryRound,
  updateCanonicalMasteryAnalytics,
} from "./comprehensionCheck/analytics";
import {
  buildEvaluateAnswerPrompt,
  buildFinalReportPrompt,
  buildFollowUpQuestionPrompt,
  buildInitialMasteryPrompt,
  MASTERY_EVALUATION_OUTPUT_SCHEMA,
  MASTERY_QUESTION_OUTPUT_SCHEMA,
  parseMasteryEvaluationResponse,
  parseMasteryQuestionResponse,
} from "./comprehensionCheck/prompt";
import {
  buildInitialMasteryState,
  clearMasteryState,
  getMasteryState,
  getMasteryStateForSession,
  setMasteryState,
} from "./comprehensionCheck/status";
import { clearIndexedChunks } from "./context/indexStore";
import {
  assertRequestContextCurrent,
  captureRequestContext,
} from "./context/requestContext";
import { getVerifiedProviderResume } from "./session/providerBinding";
import { captureExecutionSettings } from "./ai/executionSettings";
import {
  getChatDraft,
  updateChatDraft,
  consumeChatDraft,
  restoreChatDraft,
  createChatDraftSubmission,
  formatDraftAnnotationNotice,
  formatDraftSourceLabel,
  shouldReadLiveSelection,
  type ChatDraftSubmission,
} from "./ui/chatDraft";
import { persistChatDraftSubmission } from "./ui/chatAdmission";
import {
  buildReaderActionQuestion,
  readerActionNeedsPassage,
} from "./readerActionPrompt";
import { createChatTools, showChatReviewPanel } from "./ui/chatTools";
import {
  buildChatContextStatus,
  renderChatContextStatus,
  withChatContextTiming,
  type ChatContextStatus,
} from "./ui/chatContextStatus";
import type { MessageRecord } from "./message/types";
import { openChatCitation } from "./message/chatCitations";
import {
  buildChatNotePreview,
  resolveChatNoteTarget,
  saveChatMessageToNote,
} from "./note/chatNote";
import {
  loadResearchWorkspaceHome,
  addResearchWorkspaceComparisonQuestion,
  addResearchWorkspaceCandidate,
} from "./researchWorkspace/facade";
import { createCriticalReadLocalizer } from "./criticalRead/localization";
import { parseCriticalReadOutput } from "./criticalRead/parser";
import {
  buildCriticalReadStepPrompt,
  getCriticalReadOutputSchema,
} from "./criticalRead/prompt";
import { buildCriticalReadReportMarkdown } from "./criticalRead/report";
import type { CriticalReadState } from "./criticalRead/types";
import {
  attachPublicReviewInsightToCriticalRead,
  buildInitialCriticalReadState,
  canViewPublicReviewInsights,
  completeCriticalReadStep,
  failCriticalReadStep,
  getCriticalReadRevisionInvalidations,
  getCriticalReadStep,
  markCriticalReadStepRunning,
  reviseCriticalReadStep,
  startCriticalRead,
} from "./criticalRead/workflow";
import { getDiscoveryAvailability } from "./discovery/capabilities";
import { areLikelySamePaper } from "./discovery/normalize";
import { messageStore } from "./message/messageStore";
import { saveCriticalReadToNote } from "./note/criticalReadNote";
import { saveDiscoveryToNote } from "./note/discoveryNote";
import {
  savePaperArtifactSetToCollection,
  savePaperArtifactToNote,
} from "./note/paperArtifactNote";
import {
  buildPaperArtifactRequest,
  parsePaperArtifactCard,
  type PaperArtifactKind,
} from "./paperArtifacts";
import {
  buildPaperCompareCard,
  buildPaperCompareRequestFromRecommendations,
  getPaperCompareButtonState,
  getPaperCompareWorkflowState,
  parsePaperCompareResponse,
} from "./paperCompare";
import {
  addRecommendationToCollection,
  buildRelatedRunFailureState,
  buildRelatedRunProgressState,
  buildRelatedRunSuccessState,
  generatePublicReviewInsight,
  generateRelatedPaperGroups,
  isCollectionChoiceCancelled,
  openRecommendedPaper,
  type RecommendationGroup,
  type RecommendedPaper,
} from "./relatedRecommendations";
import { resolveSessionHistoryPrefs } from "./session/historyPrefs";
import { describeNewSessionImpact } from "./session/newSessionImpact";
import { sessionHistoryService } from "./session/sessionHistoryService";
import { sessionStore } from "./session/sessionStore";
import { isLikelySilentToolMessage } from "./session/silentTurnFilter";
import {
  normalizeResponseLanguage,
  subscribeToResponseLanguageChanges,
} from "./translation/responseLanguage";
import {
  installChatComposerAutosize,
  resizeChatComposer,
} from "./ui/chatComposerSizing";
import {
  captureChatPosition,
  clearChatNewResponse,
  hasChatNewResponse,
  jumpToChatMessage,
  isChatFollowingLatest,
  disposeChatTranscriptWindow,
  notifyChatTranscriptUpdate,
  renderChatTranscriptWindow,
} from "./ui/chatTranscriptWindow";
import { createCollapsibleSection } from "./ui/collapsibleSection";
import {
  clearCriticalReadViewState,
  getCriticalReadDraft,
  getExpandedCriticalReadSteps,
  pruneCriticalReadDrafts,
  setCriticalReadDraft,
  setCriticalReadStepExpanded,
} from "./ui/criticalReadDraft";
import { renderCriticalReadSection } from "./ui/criticalReadSection";
import {
  appendOpenResearchWorkspaceAction,
  createOpenResearchWorkspaceButton,
  showResearchWorkspaceRequiredPanel,
} from "./ui/researchWorkspaceLauncher";
import { buildDiscoveryRow } from "./ui/discoveryRow";
import {
  getDiscoveryButtonPresentation,
  resolveDiscoveryRequest,
} from "./ui/discoveryEntryState";
import { renderDiscoverySection } from "./ui/discoverySection";
import {
  createPaneHeader,
  normalizeModelForMode,
  renderCodexAuthActions,
  renderEffortInput,
  renderCodexOptionsRow,
  renderEngineSelection,
  renderModeHeader,
  renderModelHistory,
  renderModelRow,
} from "./ui/paneHeader";
import {
  clearMasteryAnswerDraft,
  clearMasteryPanelMemory,
  getMasteryAnswerDraft,
  getMasteryPanelChoices,
  getMasteryPanelView,
  isMasteryPreparing,
  masteryRunKey,
  setMasteryAnswerDraft,
  setMasteryPanelChoices,
  setMasteryPreparing,
  syncMasteryPanelChoices,
} from "./ui/masteryPanelView";
import { createVerticalResizeHandle } from "./ui/paneResize";
import {
  installAutomaticPaneHeight,
  MIN_READER_PANE_HEIGHT,
} from "./ui/paneAutoSize";
import type { PaneSectionID } from "./ui/paneSectionState";
import { installPopoverDismissal } from "./ui/popoverDismissal";
import {
  getPaperArtifactState,
  getWorkbenchBlockForItem,
  renderPaperArtifactState,
  renderWorkbenchArtifactState,
  renderWorkbenchBusyState,
  setPaperArtifactState,
  WorkbenchElements,
} from "./ui/readerWorkbench";
import {
  buildClearCardsConfirmation,
  formatClearedCardsStatus,
} from "./ui/workbenchAvailability";
import {
  createRunProgressCard,
  PAPER_PILOT_PREF_PANE_ID,
  type RunProgressCardHandle,
} from "./ui/runProgressCard";
import { resolvePaperWorkspaceRoot } from "./workspace/pathBuilder";
import { probeWorkspaceWritable } from "./workspace/status";

/** How long the composer keeps a "nothing was sent" hint visible. */
const COMPOSER_HINT_MS = 4000;
const composerNoticeTimers = new WeakMap<
  HTMLElement,
  ReturnType<typeof setTimeout>
>();

/**
 * Status notices go to the composer hint, never the transcript. The transcript
 * is rebuilt from saved messages, so a notice added there looked like an answer
 * and then vanished on the next run event. A sticky notice holds instructions
 * until the next notice or the next sent question replaces it.
 */
function showComposerNotice(
  anchor: Element,
  text: string,
  options: { sticky?: boolean } = {},
) {
  const hint = anchor
    .closest("#paper-pilot-container")
    ?.querySelector("#chat-composer-hint") as HTMLElement | null;
  if (!hint) return;
  const previous = composerNoticeTimers.get(hint);
  if (previous) clearTimeout(previous);
  composerNoticeTimers.delete(hint);
  hint.textContent = text;
  if (!text || options.sticky) return;
  composerNoticeTimers.set(
    hint,
    setTimeout(() => {
      composerNoticeTimers.delete(hint);
      if (hint.textContent === text) hint.textContent = "";
    }, COMPOSER_HINT_MS),
  );
}
const publicReviewAbortControllers = new Map<number, AbortController>();
const relatedDiscoveryAbortControllers = new Map<number, AbortController>();
const autoHighlightAbortControllers = new Map<number, AbortController>();
/** Last observed Codex login state; it decides whether auth controls show. */
let lastCodexLoginState: string | undefined;
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

const paneCleanupByBody = new WeakMap<HTMLElement, () => void>();
const activePaneBodies = new Set<HTMLElement>();
const paneTemplateByBody = new WeakMap<HTMLElement, HTMLElement>();
const paneItemByBody = new WeakMap<HTMLElement, number>();
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

function logReaderPaneError(context: string, error: unknown) {
  const normalized = error instanceof Error ? error : new Error(String(error));
  addon.data.ztoolkit?.log(`Paper Pilot ${context}:`, normalized);
  Zotero.logError?.(normalized);
}

export function pruneReaderPaneItemState(itemID: number) {
  const item = Zotero.Items?.get?.(itemID);
  if (item?.key && item.libraryID !== undefined) {
    clearIndexedChunks({
      libraryID: item.libraryID,
      itemKey: String(item.key),
    });
  }
  addon.data.modeOverrides?.delete(itemID);
  addon.data.relatedRecommendationStates?.delete(itemID);
  addon.data.autoHighlightStates?.delete(itemID);
  addon.data.paperArtifactStates?.delete(itemID);
  addon.data.comprehensionCheckStates?.delete(itemID);
  addon.data.criticalReadStates?.delete(itemID);
  addon.data.pendingReaderActions?.delete(itemID);
  addon.data.pendingDiscoveryConcerns?.delete(itemID);
  addon.data.readerActionDrafts?.delete(itemID);
  addon.data.applyReaderActionToPane?.delete(itemID);
  addon.data.showReaderPaneNotice?.delete(itemID);
  addon.data.activateReaderCapability?.delete(itemID);
  clearMasteryPanelMemory(itemID);
}

export function disposeReaderPaneRunProgressCards(): void {
  for (const card of activeRunProgressCards) card.dispose();
  activeRunProgressCards.clear();
}

export function unregisterPaperPilotPaneSection(): void {
  for (const body of [...activePaneBodies]) {
    paneCleanupByBody.get(body)?.();
    paneCleanupByBody.delete(body);
    paneTemplateByBody.delete(body);
    paneItemByBody.delete(body);
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

const chatMessageOptions = new WeakMap<
  HTMLElement,
  (message: MessageRecord) => NonNullable<Parameters<typeof addMessage>[3]>
>();

export function setReaderActionDraft(
  draft: NonNullable<typeof addon.data.readerActionDrafts> extends Map<
    number,
    infer Draft
  >
    ? Draft
    : never,
  options: { attachToComposer?: boolean } = {},
) {
  addon.data.readerActionDrafts?.set(draft.itemID, draft);
  if (options.attachToComposer === false) return;
  updateChatDraft(draft.itemID, draft.sessionId, {
    context: {
      text: draft.text,
      annotationIDs: draft.annotationIDs,
      attachmentID: draft.attachmentID,
      pageIndex: draft.pageIndex,
      pageLabel: draft.pageLabel,
    },
  });
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
              <span id="chat-auto-highlight-status" class="pp-session-status" role="status" aria-live="polite"></span>
            </div>
            <div id="chat-paper-workbench">
              <html:button id="chat-research-brief" class="pp-btn pp-btn--secondary">Research brief</html:button>
              <html:button id="chat-tool-compare" class="pp-btn pp-btn--secondary">Compare</html:button>
              <html:button id="chat-tool-contributions" class="pp-btn pp-btn--secondary">Contributions</html:button>
              <html:button id="chat-tool-limitations" class="pp-btn pp-btn--secondary">Limitations</html:button>
              <html:button id="chat-tool-followups" class="pp-btn pp-btn--secondary">Follow-ups</html:button>
              <html:button id="chat-tool-save-note" class="pp-btn pp-btn--ghost" title="Save the newest Workbench card as a child note of this paper">Save latest to note</html:button>
              <html:button id="chat-tool-save-collection" class="pp-btn pp-btn--ghost" title="Save every Workbench card as one note in a Zotero collection">Save for collection</html:button>
              <html:button id="chat-tool-clear" class="pp-btn pp-btn--ghost">Clear cards</html:button>
              <html:button id="chat-paper-mastery" class="pp-btn pp-btn--secondary">Paper Mastery</html:button>
              <html:button id="chat-critical-read" class="pp-btn pp-btn--secondary">Critical Read</html:button>
            </div>
            <div id="chat-compare-helper" class="pp-compare-helper pp-compare-helper--default" role="status" aria-live="polite" aria-atomic="true"></div>
            <div id="chat-paper-tool-status" class="pp-status-text" role="status" aria-live="polite" style="display: none;"></div>
            <div id="chat-paper-tool-cards" class="pp-tool-cards" style="display: none;"></div>
            <div id="paper-pilot-mastery-section" class="pp-mastery-panel" style="display: none;">
              <div class="pp-mastery-topic-card">
                <div id="paper-mastery-status" class="pp-mastery-status" role="status" aria-live="polite"></div>
                <div id="paper-mastery-metrics" class="pp-mastery-metrics"></div>
                <div id="paper-mastery-progress" class="pp-mastery-progress"></div>
              </div>
              <div id="paper-mastery-question" class="pp-mastery-question" style="display: none;"></div>
              <div id="paper-mastery-feedback" class="pp-mastery-feedback" style="display: none;"></div>
              <div id="paper-mastery-report" class="pp-mastery-report" style="display: none;"></div>
              <html:textarea id="paper-mastery-answer" class="pp-mastery-answer" aria-label="Your answer" placeholder="Type your answer here..." style="display: none;" />
              <label id="paper-mastery-confidence-row" class="pp-mastery-confidence" style="display: none;">
                Confidence before grading
                <html:input id="paper-mastery-confidence" type="range" min="0" max="1" step="0.05" value="0.7" aria-valuetext="70%" />
                <span id="paper-mastery-confidence-value">70%</span>
              </label>
              <div id="paper-mastery-actions" class="pp-mastery-actions" style="display: none;">
                <html:button id="paper-mastery-submit" class="pp-btn pp-btn--primary">Submit Answer</html:button>
                <html:button id="paper-mastery-next" class="pp-btn pp-btn--primary" style="display: none;">Next question</html:button>
                <html:button id="paper-mastery-end" class="pp-btn pp-btn--ghost">End Session</html:button>
                <html:button id="paper-mastery-report-retry" class="pp-btn pp-btn--secondary" style="display: none;">Generate final report</html:button>
              </div>
            </div>
            <div id="paper-pilot-critical-read" class="pp-critical-read" style="display: none;"></div>
          </div>
          <div id="paper-pilot-related-mount">
            <label for="chat-related-concern" class="pp-related-concern-label">Research concern or idea</label>
            <html:textarea id="chat-related-concern" class="pp-related-concern" placeholder="Optional: describe the research concern or novelty question." />
            <html:button id="chat-related-recommend" class="pp-btn pp-btn--secondary">Find verified prior work</html:button>
            <div id="chat-related-availability" class="pp-related-availability" role="note" style="display: none;"></div>
            <html:button id="chat-related-save" class="pp-btn pp-btn--ghost" disabled="true" title="Save the verified prior-work results as a child note of this paper">Save prior-work note</html:button>
            <div class="pp-related-disclosure">Paper Pilot infers the field and leading venues, then verifies main-track acceptance from official paper-level sources. Workshops and preprints stay in separate lanes.</div>
            <div id="chat-related-status" class="pp-status-text" role="status" aria-live="polite" style="display: none;"></div>
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
          <span class="pp-streaming-text">Waiting for answer…</span>
        </div>
        <div id="chat-messages" role="log" aria-live="polite" aria-relevant="additions text" aria-label="Paper conversation"></div>
        <div id="paper-pilot-composer">
          <div id="paper-pilot-draft" class="pp-status-card pp-status-card--draft" style="display: none;"></div>
          <div id="chat-composer-hint" class="pp-composer-hint" role="status" aria-live="polite"></div>
          <div id="chat-input-shell">
            <html:textarea id="chat-input" aria-label="Ask about this paper" placeholder="Ask a question about this paper or the current selection."/>
            <html:button id="chat-send" class="pp-btn pp-btn--primary" aria-label="Send message">Send</html:button>
          </div>
        </div>
      </div>
    `,
    onRender: ({ body, item, setSectionSummary: setHostSectionSummary }) => {
      paneCleanupByBody.get(body)?.();
      paneItemByBody.set(body, item.id);
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
      const automaticPaneHeight = installAutomaticPaneHeight({
        target: paneContainer,
        hasManualHeight: () => paneLayout.paneHeight !== undefined,
      });
      const paneResize = createVerticalResizeHandle({
        doc: body.ownerDocument,
        target: paneContainer,
        label: "Resize Paper Pilot pane",
        minHeight: MIN_READER_PANE_HEIGHT,
        getMaxHeight: () =>
          Math.max(
            1200,
            (body.ownerDocument.defaultView?.innerHeight || 800) * 2,
          ),
        initialHeight: paneLayout.paneHeight,
        onHeightChange: (height) => {
          paneLayout.paneHeight = height;
          if (height === undefined) automaticPaneHeight.refresh();
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
      const focusButton = body.ownerDocument.createElement("button");
      focusButton.type = "button";
      focusButton.className = "pp-btn pp-btn--ghost pp-chat-focus";
      focusButton.textContent = "Focus chat";
      focusButton.setAttribute("aria-pressed", "false");
      focusButton.title = "Hide the Workbench to give chat more room";
      paneHeader.root.append(focusButton);
      focusButton.addEventListener("click", () => {
        // The name stays "Focus chat". aria-pressed and its style carry state.
        const focused = focusButton.getAttribute("aria-pressed") !== "true";
        focusButton.setAttribute("aria-pressed", String(focused));
        focusButton.title = focused
          ? "Show the Workbench again"
          : "Hide the Workbench to give chat more room";
        sectionStack.hidden = focused;
        workspaceResize.root.hidden = focused;
      });

      const cleanupTasks: Array<() => void> = [
        () => paneHeader.dispose(),
        () => workbenchSection.dispose(),
        () => relatedSection.dispose(),
        () => sessionsSection.dispose(),
        () => workspaceResize.dispose(),
        () => paneResize.dispose(),
        () => automaticPaneHeight.dispose(),
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
      let draftSessionID = sessionStore.getOrCreate(
        item.id,
        getModeForItem(item.id),
        String(item.getField("title") || ""),
      ).sessionId;
      input.value = getChatDraft(item.id, draftSessionID).text;
      const saveInputDraft = () =>
        updateChatDraft(item.id, draftSessionID, { text: input.value });
      input.addEventListener("input", saveInputDraft);
      // Send stays disabled while the composer is empty.
      const renderSendAvailability = () =>
        renderChatComposerForItem(input, item.id);
      input.addEventListener("input", renderSendAvailability);
      cleanupTasks.push(() => {
        input.removeEventListener("input", saveInputDraft);
        input.removeEventListener("input", renderSendAvailability);
      });
      const restoreInputDraft = () => {
        const next = sessionStore.get(item.id)?.sessionId;
        if (next && next !== draftSessionID) {
          draftSessionID = next;
          input.value = getChatDraft(item.id, next).text;
          resizeChatComposer(input);
          renderChatComposerForItem(input, item.id);
        }
      };

      const chatMessages = body.querySelector("#chat-messages") as HTMLElement;
      if (chatMessages) {
        cleanupTasks.push(() => disposeChatTranscriptWindow(chatMessages));
      }
      const draftCard = body.querySelector("#paper-pilot-draft") as HTMLElement;
      void ztoolkit.Reader.getReader()
        .then((reader) => {
          if (
            !reader ||
            !isCurrentRender() ||
            getChatDraft(item.id, draftSessionID).context
          )
            return;
          const attachmentID = Number(reader._item?.id ?? reader.itemID);
          const attachment = Zotero.Items.get(attachmentID);
          if (
            !attachment ||
            ((Number(attachment.parentItemID) || attachmentID) !== item.id &&
              attachmentID !== item.id)
          )
            return;
          updateChatDraft(item.id, draftSessionID, {
            context: {
              attachmentID,
              text: ztoolkit.Reader.getSelectedText?.(reader) || "",
              pageIndex: reader._state?.primaryViewStats?.pageIndex,
              pageLabel: reader._state?.primaryViewStats?.pageLabel,
              origin: "pane-open",
            },
          });
          renderDraftCard(draftCard, item.id);
        })
        .catch((error) =>
          logReaderPaneError("Reader context preview unavailable", error),
        );

      const streamingIndicator = body.querySelector(
        "#chat-streaming-indicator",
      ) as HTMLElement;
      const {
        modeChip,
        modeStatus,
        modeClaudeButton,
        modeCodexButton,
        modeResetButton,
        newSessionButton,
        codexActions,
        codexAuthButton,
        codexDeviceAuthButton,
        codexRecheckButton,
        modelRow,
        modelInput,
        effortInput,
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
        modelRow &&
        modelInput &&
        effortInput &&
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
        const paneElements: PaneElements = {
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
          modelRow,
          modelInput,
          effortInput,
          codexOptionsRow,
          codexWebSearchToggle,
          modelHistory,
          chatMessages,
          draftCard,
          streamingIndicator,
          setSectionSummary,
        };
        const refreshPaneState = (
          options: {
            isCurrent?: () => boolean;
            renderTranscript?: boolean;
          } = {},
        ) => {
          restoreInputDraft();
          chatTools.refresh();
          return renderPaneState({
            itemID: item.id,
            itemTitle: String(item.getField("title") || ""),
            elements: paneElements,
            ...options,
          });
        };
        const cancelCurrentRun = async () => {
          const state = getRunProgressState(item.id);
          const cancelled = await cancelActiveEngineRun(item.id);
          const updatedState = getRunProgressState(item.id);
          showComposerNotice(
            input,
            cancelled
              ? isReaderChatBusy(item.id)
                ? "Stopping the current request. Wait for it to settle before sending another message."
                : `${getModeLabel(state?.engine ?? getModeForItem(item.id))} run cancelled.`
              : updatedState?.failure?.userMessage ||
                  "No cancellable run is active for this paper.",
          );
          renderStreamingIndicator(
            streamingIndicator,
            Boolean(getActiveReaderRunMode(item.id)),
          );
          runProgressCard.render(getVisibleRunProgressState(item.id));
          renderChatComposerForItem(input, item.id);
        };
        const runProgressCard = createRunProgressCard({
          container: runStateCard,
          focusAfterCard: () => input,
          actions: {
            onRetry: () => {
              // A retry acts on the instruction a notice gave; drop it.
              showComposerNotice(input, "");
              return retryLastEngineQuestion({
                itemID: item.id,
                itemTitle: String(item.getField("title") || ""),
                chatMessages,
                streamingIndicator,
              });
            },
            onOpenSettings: () => {
              Zotero.Utilities.Internal.openPreferences(
                PAPER_PILOT_PREF_PANE_ID,
              );
            },
            onShowLoginHelp: (engine) => {
              const command =
                engine === "codex_cli" ? "codex login" : "claude /login";
              showComposerNotice(
                input,
                `Authenticate in a terminal with ${command}, then retry the request.`,
                { sticky: true },
              );
            },
            onDismiss: (state) => {
              showComposerNotice(input, "");
              clearTerminalRunProgressState(item.id, state.token);
              runProgressCard.render(getVisibleRunProgressState(item.id));
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
        runProgressCard.render(getVisibleRunProgressState(item.id));

        let sessionHistoryOpen = sessionsSection.isExpanded();
        let renamingSessionId: string | undefined;
        // Run events rebuild Past sessions. Keep the typed name and caret.
        let renameDraft: { sessionId: string; value: string } | undefined;
        let renameFocus:
          | { mode: "select" }
          | { mode: "restore"; start: number | null; end: number | null }
          | undefined;
        let activeKebabClose: (() => void) | undefined;
        let activeKebabRoot: HTMLElement | undefined;
        // Run events rebuild Past sessions; an open menu reopens afterwards.
        let openKebabSessionId: string | undefined;
        // The last failed session action, shown at the top of Past sessions.
        let sessionHistoryError: string | undefined;
        cleanupTasks.push(
          installPopoverDismissal({
            doc: body.ownerDocument,
            getRoot: () => activeKebabRoot,
            dismiss: (restoreFocus) => {
              const trigger = activeKebabRoot?.querySelector(
                '[aria-haspopup="menu"]',
              ) as HTMLButtonElement | null;
              activeKebabClose?.();
              if (restoreFocus) trigger?.focus();
            },
          }),
        );

        const beginSessionRuntimeTransition = async () => {
          const activeMode = getActiveReaderRunMode(item.id);
          const lifecycleReserved = Boolean(
            getPendingEngineCompletion(item.id) ||
              isReaderLifecycleClaimActive(item.id),
          );
          if (activeMode || lifecycleReserved) {
            showComposerNotice(
              input,
              `${getModeLabel(activeMode ?? getModeForItem(item.id))} is still running or finishing for this paper. Wait for it to settle before changing sessions.`,
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
            showComposerNotice(
              input,
              "Paper Pilot could not safely change sessions because a local process could not be stopped. Try Cancel again or restart Zotero.",
              { sticky: true },
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
          resizeChatComposer(input);
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

        let startPaperMastery: () => Promise<void> = async () => undefined;
        // Per-run Mastery view memory (reviewed round, opened dot, preparing)
        // lives in ui/masteryPanelView.ts so a pane rebuild keeps it.
        const updateMasteryChoices = (
          patch: Partial<import("./ui/masteryPanelView").MasteryPanelChoices>,
        ) =>
          setMasteryPanelChoices(item.id, {
            ...getMasteryPanelChoices(item.id),
            ...patch,
          });
        let renderedMasteryDots: string | undefined;
        let renderedMasteryQuestion: string | undefined;
        let renderedMasteryFeedback: string | undefined;
        let renderedMasteryReport: string | undefined;
        let criticalReadPreparing = false;
        let criticalReadSaving = false;
        const getCriticalReadBusyReason = () => {
          const block = getWorkbenchBlockForItem(item.id);
          return block.blocked
            ? (block.reason ?? "Wait for the Workbench request to finish.")
            : undefined;
        };
        const renderCriticalRead = (readerInput?: string) => {
          const state = getCriticalReadStateForItem();
          const responseLanguage = normalizeResponseLanguage(
            getPref("responseLanguage"),
          );
          const t = createCriticalReadLocalizer(responseLanguage);
          criticalReadButton.textContent =
            state.phase === "idle"
              ? "Critical Read"
              : state.phase === "complete"
                ? "Critical Read · Complete"
                : `Critical Read · ${state.steps.filter((step) => step.status === "complete").length}/7`;
          // Every status update rebuilds the section. Unsent input and open
          // completed steps come from memory so a rebuild cannot erase them.
          pruneCriticalReadDrafts(
            item.id,
            state.sessionID,
            state.steps
              .filter((step) => step.status === "complete")
              .map((step) => step.id),
          );
          const currentStep = getCriticalReadStep(state);
          renderCriticalReadSection({
            root: criticalReadRoot,
            state,
            responseLanguage,
            paperTitle: String(item.getField("title") || t("Current paper")),
            readerInput:
              readerInput ??
              (currentStep
                ? getCriticalReadDraft(item.id, state.sessionID, currentStep.id)
                : undefined),
            expandedStepIDs: getExpandedCriticalReadSteps(
              item.id,
              state.sessionID,
            ),
            preparing: criticalReadPreparing,
            saving: criticalReadSaving,
            busyReason: getCriticalReadBusyReason(),
            discoveryUnavailableReason: (() => {
              const discovery = getDiscoveryAvailability(
                getModeForItem(item.id),
              );
              return discovery.available ? undefined : discovery.reason;
            })(),
            actions: {
              onDraftChange: (stepID, text) =>
                setCriticalReadDraft(item.id, state.sessionID, stepID, text),
              onToggleStep: (stepID, expanded) =>
                setCriticalReadStepExpanded(
                  item.id,
                  state.sessionID,
                  stepID,
                  expanded,
                ),
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
                // Agent steps gave no sign that Cancel was received.
                setCriticalReadStateForItem({
                  ...getCriticalReadStateForItem(),
                  status: "Cancelling Critical Read step…",
                  updatedAt: new Date().toISOString(),
                });
                renderCriticalRead();
                await cancelActiveEngineRun(item.id);
              },
              onStartMastery: () => {
                void startPaperMastery();
              },
              onStart: async () => {
                if (criticalReadPreparing) return;
                let orientations: ReturnType<
                  typeof import("./criticalRead/orientation").buildCriticalReadOrientations
                > = {};
                criticalReadPreparing = true;
                renderCriticalRead();
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
                } catch (error) {
                  logReaderPaneError(
                    "Critical Read orientation extraction failed",
                    error,
                  );
                  const { buildCriticalReadOrientations } = await import(
                    "./criticalRead/orientation"
                  );
                  orientations = buildCriticalReadOrientations({});
                } finally {
                  criticalReadPreparing = false;
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
                // Name the completed steps the revision clears, from the
                // same map the workflow applies.
                const completedIDs = new Set(
                  getCriticalReadStateForItem()
                    .steps.filter((entry) => entry.status === "complete")
                    .map((entry) => entry.id),
                );
                const clearedSteps = [
                  ...getCriticalReadRevisionInvalidations(stepID).keys(),
                ].filter((id) => id !== stepID && completedIDs.has(id));
                const confirmed =
                  promptService?.confirm?.(
                    null,
                    t("Revise Critical Read step"),
                    clearedSteps.length
                      ? t(
                          "Replace Step {step}? Completed Steps {steps} depend on it and will be cleared. Other completed steps are kept.",
                          { step: stepID, steps: clearedSteps.join(", ") },
                        )
                      : t(
                          "Replace Step {step}? Other completed steps are kept.",
                          { step: stepID },
                        ),
                  ) ?? false;
                if (!confirmed) return;
                setCriticalReadStateForItem(
                  reviseCriticalReadStep(getCriticalReadStateForItem(), stepID),
                );
                renderCriticalRead();
                await persistCriticalReadState();
              },
              onSave: async () => {
                // Each save creates a new note, so ignore repeat clicks.
                if (criticalReadSaving) return;
                criticalReadSaving = true;
                renderCriticalRead();
                const current = getCriticalReadStateForItem();
                try {
                  const note = await saveCriticalReadToNote({
                    item,
                    paperTitle: String(
                      item.getField("title") || "Current paper",
                    ),
                    state: current,
                    responseLanguage: normalizeResponseLanguage(
                      getPref("responseLanguage"),
                    ),
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
                } finally {
                  criticalReadSaving = false;
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
                // The engine runs one request per paper. Without this the
                // click would be dropped with no message.
                // A re-render shows Run disabled with the reason as its
                // tooltip. The saved status is left alone, so it cannot go
                // stale once the other run ends.
                if (getCriticalReadBusyReason()) {
                  renderCriticalRead(readerInput);
                  return;
                }
                if (criticalReadDiscoveryAbortControllers.has(item.id)) return;

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
                    const requestContext = await captureRequestContext({
                      itemID: item.id,
                      reader: await ztoolkit.Reader.getReader().catch(
                        () => undefined,
                      ),
                      selectedText: "",
                    });
                    await generateRelatedPaperGroups({
                      itemID: item.id,
                      itemTitle: String(item.getField("title") || ""),
                      requestContext,
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
                        // Open the result the reader just waited for.
                        setCriticalReadStepExpanded(
                          item.id,
                          completed.sessionID,
                          step.id,
                          true,
                        );
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
                        // Parser messages name internal fields. Tell the
                        // reader what to do and keep the detail in the log.
                        logReaderPaneError(
                          `Critical Read Step ${step.id} output was rejected`,
                          error,
                        );
                        nextState = failCriticalReadStep(
                          getCriticalReadStateForItem(),
                          `Step ${step.id} returned an incomplete answer. Run it again.`,
                        );
                      }
                    }
                    setCriticalReadStateForItem(nextState);
                    if (
                      nextState.steps.find((entry) => entry.id === step.id)
                        ?.status === "complete"
                    ) {
                      // Open the result the reader just waited for.
                      setCriticalReadStepExpanded(
                        item.id,
                        nextState.sessionID,
                        step.id,
                        true,
                      );
                    }
                    renderCriticalRead();
                    await persistCriticalReadState();
                  },
                });
              },
            },
          });
        };

        cleanupTasks.push(
          subscribeToResponseLanguageChanges(() => {
            if (!isCurrentRender()) return;
            // The unsent assessment is kept in the draft store on every edit.
            const scrollTop = criticalReadRoot.scrollTop;
            renderCriticalRead();
            criticalReadRoot.scrollTop = scrollTop;
          }),
        );

        const syncCriticalReadToggle = () =>
          criticalReadButton.setAttribute(
            "aria-expanded",
            String(criticalReadRoot.style.display !== "none"),
          );
        criticalReadButton.setAttribute("aria-controls", criticalReadRoot.id);
        const openCriticalRead = () => {
          const visible = criticalReadRoot.style.display !== "none";
          criticalReadRoot.style.display = visible ? "none" : "block";
          syncCriticalReadToggle();
          if (!visible) renderCriticalRead();
        };
        // Requests from the Research Workspace window only open a panel. They
        // expand the Workbench, leave Focus chat through its own button, and
        // scroll the panel into view so the window's "opened" is true.
        const revealWorkbenchPanel = (panel?: HTMLElement | null) => {
          workbenchSection.setExpanded(true);
          if (focusButton.getAttribute("aria-pressed") === "true") {
            focusButton.click();
          }
          if (panel && panel.style.display !== "none") {
            panel.scrollIntoView?.({ block: "nearest" });
          }
        };
        const showCriticalRead = () => {
          criticalReadRoot.style.display = "block";
          syncCriticalReadToggle();
          renderCriticalRead();
          revealWorkbenchPanel(criticalReadRoot);
        };
        criticalReadButton.addEventListener("click", openCriticalRead);
        criticalReadButton.after(
          createOpenResearchWorkspaceButton(body.ownerDocument, {
            items: [item],
            label: "Research Workspace",
            className: "pp-btn pp-btn--ghost",
            onError: (error) =>
              logReaderPaneError("Research Workspace launch failed", error),
          }),
        );
        if (addon.data.criticalReadStates?.has(item.id)) {
          criticalReadRoot.style.display = "block";
        }
        syncCriticalReadToggle();
        renderCriticalRead();

        // Keep text the reader typed until the stored concern itself changes.
        let renderedRelatedConcern = "";
        const syncRelatedConcern = () => {
          const stored = getRelatedRecommendationState(item.id).concern || "";
          if (
            relatedConcern.value === renderedRelatedConcern ||
            stored !== renderedRelatedConcern
          ) {
            relatedConcern.value = stored;
          }
          renderedRelatedConcern = stored;
        };

        const rerenderPane = async (
          options: { renderTranscript?: boolean } = {},
        ) => {
          await refreshPaneState({ isCurrent: isCurrentRender, ...options });
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
          syncRelatedConcern();
          renderCriticalRead();
          await renderSessionHistory();
          if (disposed) return;
          updateWorkbenchSummary();
          updateRelatedSummary();
          renderMasteryPanel();
        };

        // Rename, Open, and Delete used to fail with no message. Show the
        // error at the top of Past sessions instead.
        const runSessionHistoryAction = async (
          action: () => Promise<unknown>,
        ) => {
          sessionHistoryError = undefined;
          try {
            await action();
          } catch (error) {
            logReaderPaneError("session history action failed", error);
            sessionHistoryError =
              error instanceof Error
                ? `That session action failed: ${error.message}`
                : "That session action failed.";
            await renderSessionHistory();
          }
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
          const previousRenameInput =
            sessionHistoryPanel.querySelector<HTMLInputElement>(
              ".pp-session-history__rename-input",
            );
          if (
            !renameFocus &&
            previousRenameInput &&
            doc.activeElement === previousRenameInput
          ) {
            renameFocus = {
              mode: "restore",
              start: previousRenameInput.selectionStart,
              end: previousRenameInput.selectionEnd,
            };
          }
          // A rebuild replaces the focused button. Remember which session
          // control had focus so the same control gets it back.
          const focusedControl = (() => {
            const active = doc.activeElement as HTMLElement | null;
            if (!active || !sessionHistoryPanel.contains(active)) return;
            const sessionId = (
              active.closest("[data-session-id]") as HTMLElement | null
            )?.dataset.sessionId;
            const action = active.dataset.sessionAction;
            return sessionId && action ? { sessionId, action } : undefined;
          })();
          sessionHistoryPanel.style.display = "block";
          sessionHistoryPanel.replaceChildren();

          if (sessionHistoryError) {
            const error = doc.createElement("div");
            error.className = "pp-session-history__error";
            error.setAttribute("role", "status");
            error.textContent = sessionHistoryError;
            sessionHistoryPanel.appendChild(error);
          }

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
              await runSessionHistoryAction(() =>
                runSessionRuntimeTransition(async () => {
                  resetBlankSessionState();
                  await sessionHistoryService.deleteAllSavedSessions({
                    itemID: item.id,
                  });
                  clearCriticalReadViewState(item.id);
                  sessionHistoryOpen = false;
                  sessionsSection.setExpanded(false);
                  await rerenderPane();
                }),
              );
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
          let reopenKebab: (() => void) | undefined;
          // The old menu was detached with its row; forget it first.
          if (openKebabSessionId) {
            const reopenID = openKebabSessionId;
            activeKebabClose?.();
            openKebabSessionId = reopenID;
          }

          for (const entry of entries) {
            const row = doc.createElement("div");
            row.className = "pp-session-history__item";
            row.dataset.sessionId = entry.sessionId;
            row.title = `Created ${new Date(entry.createdAt).toLocaleString()}`;

            const info = doc.createElement("div");
            info.className = "pp-session-history__info";

            const titleRow = doc.createElement("div");
            titleRow.className = "pp-session-history__item-header";

            if (renamingSessionId === entry.sessionId) {
              const renameInput = doc.createElement("input");
              renameInput.className = "pp-session-history__rename-input";
              renameInput.setAttribute("aria-label", "Session name");
              renameInput.value =
                renameDraft?.sessionId === entry.sessionId
                  ? renameDraft.value
                  : entry.title;
              titleRow.appendChild(renameInput);

              // An empty name used to be ignored without a word.
              const saveRename = async () => {
                if (!renameInput.value.trim()) return;
                await runSessionHistoryAction(async () => {
                  await sessionHistoryService.renameSavedSession({
                    itemID: item.id,
                    sessionId: entry.sessionId,
                    title: renameInput.value,
                  });
                  renamingSessionId = undefined;
                  renameDraft = undefined;
                  await renderSessionHistory();
                });
              };
              const cancelRename = async () => {
                renamingSessionId = undefined;
                renameDraft = undefined;
                await renderSessionHistory();
              };
              renameInput.addEventListener("keydown", (event) => {
                if (event.key === "Enter" && !event.isComposing) {
                  event.preventDefault();
                  void saveRename();
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  event.stopPropagation();
                  void cancelRename();
                }
              });

              const saveRenameButton = doc.createElement("button");
              saveRenameButton.type = "button";
              saveRenameButton.className = "pp-btn pp-btn--secondary";
              saveRenameButton.textContent = "Save";
              const syncSaveRename = () => {
                const empty = !renameInput.value.trim();
                saveRenameButton.disabled = empty;
                saveRenameButton.title = empty ? "Enter a session name" : "";
              };
              syncSaveRename();
              renameInput.addEventListener("input", () => {
                renameDraft = {
                  sessionId: entry.sessionId,
                  value: renameInput.value,
                };
                syncSaveRename();
              });
              saveRenameButton.addEventListener("click", saveRename);
              titleRow.appendChild(saveRenameButton);

              const cancelRenameButton = doc.createElement("button");
              cancelRenameButton.type = "button";
              cancelRenameButton.className = "pp-btn pp-btn--ghost";
              cancelRenameButton.textContent = "Cancel";
              cancelRenameButton.addEventListener("click", cancelRename);
              titleRow.appendChild(cancelRenameButton);
            } else {
              const entryTitle = doc.createElement("div");
              entryTitle.className = "pp-session-history__item-title";
              entryTitle.textContent = entry.title;
              // The title is cut with an ellipsis; hovering shows all of it.
              entryTitle.title = entry.title;
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
                const cardsLabel =
                  "Has saved cards, discovery, Critical Read, or mastery state";
                cardsBadge.setAttribute("role", "img");
                cardsBadge.setAttribute("aria-label", cardsLabel);
                cardsBadge.title = cardsLabel;
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
            openButton.dataset.sessionAction = "open";
            openButton.disabled = currentSessionId === entry.sessionId;
            if (openButton.disabled)
              openButton.title = "This is the open session";
            openButton.addEventListener("click", async () => {
              await runSessionHistoryAction(() =>
                runSessionRuntimeTransition(async () => {
                  await sessionHistoryService.openSavedSession({
                    itemID: item.id,
                    sessionId: entry.sessionId,
                  });
                  input.value = "";
                  resizeChatComposer(input);
                  sessionHistoryOpen = false;
                  sessionsSection.setExpanded(false);
                  renamingSessionId = undefined;
                  await rerenderPane();
                }),
              );
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
            kebabButton.setAttribute("aria-haspopup", "menu");
            kebabButton.setAttribute("aria-expanded", "false");
            kebabButton.dataset.sessionAction = "more";
            const kebabMenuID = `pp-session-menu-${entry.sessionId}`;

            let kebabMenu: HTMLElement | undefined;
            const closeKebab = () => {
              kebabMenu?.remove();
              kebabMenu = undefined;
              kebabButton.setAttribute("aria-expanded", "false");
              kebabButton.removeAttribute("aria-controls");
              if (openKebabSessionId === entry.sessionId) {
                openKebabSessionId = undefined;
              }
              if (activeKebabClose === closeKebab) {
                activeKebabClose = undefined;
                activeKebabRoot = undefined;
              }
            };

            const openKebab = (focusItem?: "rename" | "delete") => {
              activeKebabClose?.();
              activeKebabClose = closeKebab;
              activeKebabRoot = kebabContainer;
              openKebabSessionId = entry.sessionId;

              kebabMenu = doc.createElement("div");
              kebabMenu.className = "pp-session-history__kebab-menu";
              kebabMenu.id = kebabMenuID;
              kebabMenu.setAttribute("role", "menu");
              kebabMenu.setAttribute(
                "aria-label",
                `Actions for session "${entry.title}"`,
              );
              kebabButton.setAttribute("aria-expanded", "true");
              kebabButton.setAttribute("aria-controls", kebabMenuID);

              const renameItem = doc.createElement("button");
              renameItem.type = "button";
              renameItem.className = "pp-btn pp-btn--ghost";
              renameItem.setAttribute("role", "menuitem");
              renameItem.dataset.sessionAction = "rename";
              renameItem.textContent = "Rename";
              renameItem.addEventListener("click", async (renameEvent) => {
                renameEvent.stopPropagation();
                closeKebab();
                renamingSessionId = entry.sessionId;
                renameDraft = undefined;
                renameFocus = { mode: "select" };
                await renderSessionHistory();
              });
              kebabMenu.appendChild(renameItem);

              const deleteItem = doc.createElement("button");
              deleteItem.type = "button";
              deleteItem.className = "pp-btn pp-btn--ghost";
              deleteItem.setAttribute("role", "menuitem");
              deleteItem.dataset.sessionAction = "delete";
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
                  await runSessionHistoryAction(() =>
                    runSessionRuntimeTransition(async () => {
                      await sessionHistoryService.deleteSavedSession({
                        itemID: item.id,
                        sessionId: entry.sessionId,
                      });
                      clearCriticalReadViewState(item.id, entry.sessionId);
                      resetBlankSessionState();
                      renamingSessionId = undefined;
                      await rerenderPane();
                    }),
                  );
                  return;
                }
                await runSessionHistoryAction(async () => {
                  await sessionHistoryService.deleteSavedSession({
                    itemID: item.id,
                    sessionId: entry.sessionId,
                  });
                  clearCriticalReadViewState(item.id, entry.sessionId);
                  renamingSessionId = undefined;
                  await rerenderPane();
                });
              });
              kebabMenu.appendChild(deleteItem);

              // Arrow keys move between the two menu items.
              const items = [renameItem, deleteItem];
              kebabMenu.addEventListener("keydown", (keyEvent) => {
                if (keyEvent.key !== "ArrowDown" && keyEvent.key !== "ArrowUp")
                  return;
                keyEvent.preventDefault();
                const index = items.indexOf(
                  doc.activeElement as HTMLButtonElement,
                );
                const step = keyEvent.key === "ArrowDown" ? 1 : -1;
                items[(index + step + items.length) % items.length].focus();
              });

              kebabContainer.appendChild(kebabMenu);
              if (focusItem === "rename") renameItem.focus();
              if (focusItem === "delete") deleteItem.focus();
            };

            kebabButton.addEventListener("click", (event) => {
              event.stopPropagation();
              if (kebabMenu) {
                closeKebab();
                return;
              }
              openKebab("rename");
            });
            if (openKebabSessionId === entry.sessionId) {
              reopenKebab = () =>
                openKebab(
                  focusedControl?.sessionId === entry.sessionId &&
                    (focusedControl.action === "rename" ||
                      focusedControl.action === "delete")
                    ? focusedControl.action
                    : undefined,
                );
            }

            kebabContainer.appendChild(kebabButton);
            rowActions.appendChild(kebabContainer);

            row.appendChild(rowActions);
            sessionHistoryPanel.appendChild(row);
          }

          if (reopenKebab) {
            reopenKebab();
          } else {
            openKebabSessionId = undefined;
          }
          if (focusedControl && !doc.activeElement?.closest?.("[role=menu]")) {
            const rows = Array.from(
              sessionHistoryPanel.querySelectorAll("[data-session-id]"),
            ) as HTMLElement[];
            const row = rows.find(
              (candidate) =>
                candidate.dataset.sessionId === focusedControl.sessionId,
            );
            const controls = Array.from(
              row?.querySelectorAll("[data-session-action]") ?? [],
            ) as HTMLElement[];
            const control = controls.find(
              (candidate) =>
                candidate.dataset.sessionAction === focusedControl.action,
            );
            if (control && !(control as HTMLButtonElement).disabled) {
              control.focus();
            }
          }

          const focusRequest = renameFocus;
          renameFocus = undefined;
          const renameInput =
            sessionHistoryPanel.querySelector<HTMLInputElement>(
              ".pp-session-history__rename-input",
            );
          if (focusRequest && renameInput) {
            renameInput.focus();
            if (focusRequest.mode === "select") renameInput.select();
            else
              renameInput.setSelectionRange(
                focusRequest.start ?? renameInput.value.length,
                focusRequest.end ?? renameInput.value.length,
              );
          }
        };

        let searchOrigin:
          | {
              sessionId: string;
              position: ReturnType<typeof captureChatPosition>;
              restore?: () => void;
            }
          | undefined;
        const chatTools = createChatTools({
          doc: body.ownerDocument,
          input,
          getLength: () => getChatDraft(item.id, draftSessionID).responseLength,
          onLength: (responseLength) => {
            updateChatDraft(item.id, draftSessionID, { responseLength });
          },
          onAction: (action) => {
            const command = buildReaderActionQuestion(action);
            const existing = /^\/[a-z]*$/i.test(input.value)
              ? ""
              : input.value.trim();
            input.value = existing
              ? `${existing}\n\n${command.question}`
              : command.question;
            saveInputDraft();
            input.focus();
            resizeChatComposer(input);
            renderChatComposerForItem(input, item.id);
            chatTools.setStatus(
              "Edit the question, then Send. Your existing draft is kept.",
            );
            if (!readerActionNeedsPassage(action)) return;
            // The question names "the selected passage"; say so when none
            // would be attached. This mirrors what a send does: the same
            // live-selection rule and the same same-PDF check.
            const recorded = getChatDraft(item.id, draftSessionID).context;
            if (recorded?.text || recorded?.annotationIDs?.length) return;
            const noPassage =
              "No passage is selected. Select one in the PDF before you send, or edit the question to ask about the whole paper.";
            if (
              !shouldReadLiveSelection({ context: recorded, visibleChat: true })
            ) {
              chatTools.setStatus(noPassage);
              return;
            }
            void ztoolkit.Reader.getReader()
              .catch(() => undefined)
              .then((reader) => {
                if (!isCurrentRender()) return;
                const readerAttachmentID = Number(
                  reader?._item?.id ?? reader?.itemID,
                );
                const samePDF =
                  recorded?.attachmentID === undefined ||
                  recorded.attachmentID === readerAttachmentID;
                const selected =
                  reader && samePDF
                    ? ztoolkit.Reader.getSelectedText?.(reader)?.trim()
                    : "";
                chatTools.setStatus(
                  selected
                    ? "Edit the question, then Send. Your draft is kept, and the passage selected in the PDF is attached when you send."
                    : noPassage,
                );
              });
          },
          onSearch: async (query, scope) => {
            searchOrigin ??= {
              sessionId: sessionStore.get(item.id)!.sessionId,
              position: captureChatPosition(chatMessages),
            };
            return sessionHistoryService.searchMessages({
              itemID: item.id,
              query,
              scope,
            });
          },
          onResult: async (result) => {
            if (isReaderChatBusy(item.id))
              throw new Error(
                "Wait for the current response before opening a search result.",
              );
            if (result.sessionId !== sessionStore.get(item.id)?.sessionId) {
              const changed = await runSessionRuntimeTransition(async () => {
                await sessionHistoryService.persistActiveSession({
                  itemID: item.id,
                  paperTitle: String(item.getField("title") || ""),
                });
                const current = sessionStore.get(item.id);
                if (current && current.sessionId === searchOrigin?.sessionId) {
                  searchOrigin.restore = captureChatSearchReturn(
                    current,
                    addon.data,
                  );
                }
                if (
                  result.sessionId === searchOrigin?.sessionId &&
                  searchOrigin.restore
                ) {
                  searchOrigin.restore();
                } else {
                  const opened = await sessionHistoryService.openSavedSession({
                    itemID: item.id,
                    sessionId: result.sessionId,
                  });
                  if (!opened)
                    throw new Error("This conversation is no longer saved.");
                }
              });
              if (!changed)
                throw new Error("Wait for the conversation change to finish.");
              await rerenderPane();
            }
            jumpToChatMessage(chatMessages, result.messageId);
          },
          onSearchClose: async () => {
            const origin = searchOrigin;
            if (!origin) return true;
            if (
              origin.sessionId !== sessionStore.get(item.id)?.sessionId &&
              isReaderChatBusy(item.id)
            ) {
              chatTools.setStatus(
                "Wait for the current response before returning to the original conversation. Your reading position is retained.",
              );
              return false;
            }
            if (origin.sessionId !== sessionStore.get(item.id)?.sessionId) {
              const changed = await runSessionRuntimeTransition(async () => {
                await sessionHistoryService.persistActiveSession({
                  itemID: item.id,
                  paperTitle: String(item.getField("title") || ""),
                });
                if (origin.restore) origin.restore();
                else {
                  const opened = await sessionHistoryService.openSavedSession({
                    itemID: item.id,
                    sessionId: origin.sessionId,
                  });
                  if (!opened)
                    throw new Error(
                      "The original conversation is no longer available.",
                    );
                }
              });
              if (!changed) return false;
              await rerenderPane();
            }
            if (origin.position)
              jumpToChatMessage(
                chatMessages,
                origin.position.key,
                origin.position.offset,
              );
            searchOrigin = undefined;
            return true;
          },
          onSummary: async () => {
            if (resolveSessionHistoryPrefs().mode === "prompts-only")
              throw new Error(
                "Conversation summaries are unavailable in prompts-only history mode.",
              );
            if (isReaderChatBusy(item.id))
              throw new Error(
                "Wait for the current response before summarizing.",
              );
            const session = sessionStore.get(item.id)!;
            const last = messageStore
              .list(session.sessionId)
              .filter(
                (message) =>
                  message.role === "assistant" &&
                  message.status === "done" &&
                  message.requestContext,
              )
              .at(-1);
            if (!last?.requestContext)
              throw new Error(
                "Complete a source-grounded chat answer before summarizing.",
              );
            const continuity = sessionHistoryService.getContinuityContext({
              itemID: item.id,
              sourceFingerprint: last.requestContext.contentFingerprint,
            });
            const descriptor = getCurrentProviderDescriptor(item.id);
            const question = `Summarize the conversation below for future continuity. Preserve user goals, definitions, unresolved questions and source limitations. Mark assistant interpretations; do not turn them into paper facts. Return compact Markdown only.\n\n${continuity.text}`;
            await handleUserInput(
              input,
              chatMessages,
              descriptor.mode,
              item.id,
              String(item.getField("title") || ""),
              descriptor.placeholderResponse,
              streamingIndicator,
              {
                question,
                requestContext: last.requestContext,
                preserveComposer: true,
                silentUserMessage: true,
                suppressChatMessages: true,
                profile: "analysis",
                // This runs after the summary button's promise settled, so a
                // thrown error would reach no one. Report it in the status.
                onComplete: async (result) => {
                  if (!result.success) {
                    chatTools.setStatus(
                      `Summary failed: ${result.assistantText || "the engine returned no summary."}`,
                    );
                    return;
                  }
                  if (
                    sessionStore.get(item.id)?.sessionId !== session.sessionId
                  ) {
                    chatTools.setStatus(
                      "The summary was discarded because the conversation changed.",
                    );
                    return;
                  }
                  try {
                    await sessionHistoryService.setSummary({
                      itemID: item.id,
                      paperTitle: String(item.getField("title") || ""),
                      text: result.assistantText,
                      basedOnMessageId: last.id,
                      sourceFingerprint:
                        last.requestContext!.contentFingerprint,
                    });
                  } catch (error) {
                    logReaderPaneError(
                      "conversation summary save failed",
                      error,
                    );
                    chatTools.setStatus(
                      `Summary failed: ${error instanceof Error ? error.message : "it could not be saved."}`,
                    );
                    return;
                  }
                  const keptNote = resolveSessionHistoryPrefs().persistHistory
                    ? "Saved with this session."
                    : "Kept in memory for this Zotero session.";
                  chatTools.setStatus(
                    `Conversation summary ready. ${keptNote}`,
                  );
                  if (!isCurrentRender()) return;
                  const summaryBody = body.ownerDocument.createElement("div");
                  summaryBody.className = "pp-chat-review__summary";
                  try {
                    summaryBody.appendChild(
                      renderMarkdownFragment(
                        result.assistantText,
                        body.ownerDocument,
                      ),
                    );
                  } catch {
                    summaryBody.textContent = result.assistantText;
                  }
                  // The summary arrives on its own; keep focus where the
                  // reader is unless it is already in the chat tools.
                  showChatReviewPanel({
                    mount: chatTools.root,
                    title: "Conversation summary",
                    body: `Model-generated context for later questions in this conversation, not paper evidence. ${keptNote}`,
                    fields: [summaryBody],
                    focus: chatTools.root.contains(
                      body.ownerDocument.activeElement,
                    ),
                  });
                },
              },
            );
          },
        });
        draftCard.before(chatTools.root);
        cleanupTasks.push(
          () => chatTools.dispose(),
          () => chatMessageOptions.delete(chatMessages),
        );
        chatMessageOptions.set(chatMessages, (message) => ({
          message,
          actions: {
            onEdit: async () => {
              if (isReaderChatBusy(item.id))
                throw new Error(
                  "Wait for the current response before editing.",
                );
              const originalSession = sessionStore.get(item.id)!;
              const user =
                message.role === "user"
                  ? message
                  : messageStore.getTurn(
                      originalSession.sessionId,
                      message.turnId,
                    );
              if (!user)
                throw new Error("The original question is unavailable.");
              await runSessionRuntimeTransition(async () => {
                const branch = await sessionHistoryService.forkSession({
                  itemID: item.id,
                  sessionId: originalSession.sessionId,
                  messageId: user.id,
                  kind: "edit",
                  paperTitle: String(item.getField("title") || ""),
                });
                const context = user.request?.requestContext;
                updateChatDraft(item.id, branch.sessionId, {
                  text: user.text,
                  responseLength: user.request?.responseLength ?? "default",
                  context: context
                    ? {
                        attachmentID: context.attachmentID,
                        text: context.selectedText,
                        annotationIDs: context.annotations.map(
                          (annotation) => annotation.key,
                        ),
                        pageIndex: context.pageIndex,
                        pageLabel: context.pageLabel,
                      }
                    : undefined,
                });
              });
              await rerenderPane();
              input.focus();
            },
            onFork: async () => {
              if (isReaderChatBusy(item.id))
                throw new Error(
                  "Wait for the current response before branching.",
                );
              await runSessionRuntimeTransition(async () => {
                await sessionHistoryService.forkSession({
                  itemID: item.id,
                  sessionId: sessionStore.get(item.id)!.sessionId,
                  messageId: message.id,
                  kind: "answer",
                  paperTitle: String(item.getField("title") || ""),
                });
              });
              await rerenderPane();
              input.focus();
            },
            onPin: async () => {
              if (
                message.role === "assistant" &&
                !resolveSessionHistoryPrefs().persistAssistantMessages
              )
                throw new Error(
                  "Assistant pins are unavailable in this history mode because assistant text is excluded from future request context. You can pin the user question instead.",
                );
              const pinned = await sessionHistoryService.togglePin({
                itemID: item.id,
                messageId: message.id,
                paperTitle: String(item.getField("title") || ""),
              });
              chatTools.setStatus(
                pinned
                  ? `${resolveSessionHistoryPrefs().persistHistory ? "Pinned for future questions." : "Pinned in memory for this Zotero session."}${message.role === "assistant" ? " Assistant text remains interpretation." : ""}`
                  : "Removed from pinned context.",
              );
              await refreshPaneState();
            },
            onSaveNote: async () => {
              const target = await resolveChatNoteTarget(message);
              const sessionID = sessionStore.get(item.id)!.sessionId;
              const question =
                message.role === "user"
                  ? message.text
                  : messageStore.getTurn(sessionID, message.turnId)?.text;
              const noteContext = { sessionID, question };
              showChatReviewPanel({
                mount: chatTools.root,
                title: "Save answer to Zotero note",
                body: buildChatNotePreview(message, target, noteContext),
                confirmLabel: "Save note",
                onConfirm: async () => {
                  await saveChatMessageToNote(message, target, noteContext);
                  return `Saved under ${target.title}.`;
                },
              });
            },
            onSendToProject: async () => {
              const home = await loadResearchWorkspaceHome();
              if (!home.projects.length) {
                showResearchWorkspaceRequiredPanel({
                  mount: chatTools.root,
                  title: "Send comparison question to project",
                  body: "Create a Research Workspace project first, then send this question.",
                  items: [item],
                });
                return;
              }
              const doc = body.ownerDocument;
              const select = doc.createElement("select");
              select.setAttribute("aria-label", "Destination project");
              for (const project of home.projects) {
                const option = doc.createElement("option");
                option.value = project.projectID;
                option.textContent = project.name;
                select.append(option);
              }
              const question = doc.createElement("textarea");
              question.setAttribute("aria-label", "Comparison question");
              question.value =
                (message.role === "user"
                  ? message.text
                  : messageStore.getTurn(
                      sessionStore.get(item.id)!.sessionId,
                      message.turnId,
                    )?.text) ??
                "How does this paper compare with the project papers?";
              const sessionID = sessionStore.get(item.id)!.sessionId;
              showChatReviewPanel({
                mount: chatTools.root,
                title: "Send comparison question to project",
                body: "Review the question and destination. It will be added to the project without starting an analysis.",
                fields: [select, question],
                confirmLabel: "Add question",
                onConfirm: async () => {
                  await addResearchWorkspaceComparisonQuestion({
                    projectID: select.value,
                    question: question.value,
                    provenance: {
                      sessionID,
                      messageID: message.id,
                      sourceID:
                        message.requestContext?.sourceID ??
                        message.request?.requestContext?.sourceID,
                    },
                  });
                  return "Question added to the project.";
                },
              });
            },
          },
          onCitation: async (citation) => {
            const context =
              message.requestContext ?? message.request?.requestContext;
            if (!context) throw new Error("The original PDF is unavailable.");
            await openChatCitation(citation, context);
          },
        }));

        renderChatComposerForItem(input, item.id);
        // Workbench and Compare share the paper's engine slot with chat.
        // Refresh their availability on every run event so they never look
        // usable while a click would be dropped.
        const renderBusyDependentControls = () => {
          renderWorkbenchBusyState(workbenchElements, item.id);
          renderCompareButtonState(
            compareButton,
            item.id,
            String(item.getField("title") || ""),
          );
          renderAutoHighlightState(
            autoHighlightButton,
            autoHighlightStatus,
            item.id,
          );
          renderDiscoveryEntryButton(relatedRecommendButton, item.id);
          renderMasteryPanel();
        };
        const isWorkbenchRequestBlocked = () => {
          if (!getWorkbenchBlockForItem(item.id).blocked) return false;
          renderBusyDependentControls();
          return true;
        };
        const cleanupComposerSizing = installChatComposerAutosize(input);
        const unsubscribeFromRunEvents = subscribeToReaderRunEvents(
          item.id,
          (event) => {
            if (!isCurrentRender()) return;
            renderChatComposerForItem(input, item.id);
            renderBusyDependentControls();
            runProgressCard.render(getVisibleRunProgressState(item.id));
            if (event.type === "started") {
              // A new run makes an earlier failure or login notice stale.
              showComposerNotice(input, "");
              const activeLabel = getModeLabel(event.mode);
              renderModeHeader(modeChip, modeStatus, activeLabel, "running");
              renderStreamingIndicator(streamingIndicator, true);
              setSectionSummary(`${activeLabel} · Running`);
              return;
            }
            // The live answer bubble is not stored until the run finishes.
            // Rebuilding the transcript mid-run would detach it.
            void rerenderPane({
              renderTranscript: !getActiveReaderRunMode(item.id),
            });
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
        syncRelatedConcern();
        updateWorkbenchSummary();
        updateRelatedSummary();

        const canChangeProvider = () => {
          const activeMode = getActiveReaderRunMode(item.id);
          const preparing =
            streamingIndicator.style.display === "flex" ||
            Boolean(getPendingEngineCompletion(item.id)) ||
            isReaderLifecycleClaimActive(item.id);
          if (!activeMode && !preparing) return true;
          showComposerNotice(
            input,
            `${getModeLabel(activeMode ?? getModeForItem(item.id))} is still running for this paper. Wait for it to finish or cancel it before changing providers.`,
          );
          return false;
        };

        const renderRelatedState = () =>
          renderRelatedRecommendationState(
            relatedRecommendButton,
            relatedStatus,
            relatedGroups,
            compareButton,
            compareHelper,
            item.id,
            String(item.getField("title") || ""),
          );
        // Discovery availability depends on the engine and its web-search
        // setting, so engine changes also refresh the discovery entry points.
        const refreshAfterEngineChange = async () => {
          await refreshPaneState({
            isCurrent: isCurrentRender,
            renderTranscript: false,
          });
          if (!isCurrentRender()) return;
          renderRelatedState();
        };
        // Zotero Settings can change these outside the pane. Discovery
        // availability and the engine popover follow them without a reload.
        const engineSettingObservers = (
          ["defaultMode", "codexEnableWebSearch"] as const
        ).map((key) =>
          Zotero.Prefs.registerObserver(
            `${config.prefsPrefix}.${key}`,
            () => void refreshAfterEngineChange(),
            true,
          ),
        );
        cleanupTasks.push(() => {
          for (const observer of engineSettingObservers)
            Zotero.Prefs.unregisterObserver(observer);
        });

        modeClaudeButton.addEventListener("click", async () => {
          if (!canChangeProvider()) return;
          selectModeForItem(item.id, "claude_code");
          await refreshAfterEngineChange();
        });

        modeCodexButton.addEventListener("click", async () => {
          if (!canChangeProvider()) return;
          selectModeForItem(item.id, "codex_cli");
          await refreshAfterEngineChange();
        });

        modeResetButton.addEventListener("click", async () => {
          if (!canChangeProvider()) return;
          clearModeOverrideForItem(item.id);
          await refreshAfterEngineChange();
        });

        autoHighlightButton.addEventListener("click", async () => {
          const presentation = getAutoHighlightButtonPresentation({
            running: getAutoHighlightState(item.id).running,
            cancelling: isAutoHighlightCancelling(item.id),
          });
          if (presentation.action === "cancel") {
            const controller = autoHighlightAbortControllers.get(item.id);
            controller?.abort();
            // Without a controller nothing is running; clear the stale state.
            setAutoHighlightState(item.id, {
              running: Boolean(controller),
              status: controller ? "Cancelling highlighting…" : "",
            });
            renderAutoHighlightState(
              autoHighlightButton,
              autoHighlightStatus,
              item.id,
            );
            return;
          }
          if (presentation.action !== "start") return;
          const abortController = createPaneAbortController(
            autoHighlightButton.ownerDocument,
          );
          autoHighlightAbortControllers.set(item.id, abortController);
          const isActiveRun = () =>
            autoHighlightAbortControllers.get(item.id) === abortController;
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
            const workflow = runAutoHighlightWorkflow({
              itemID: item.id,
              itemTitle: item.getField("title"),
              signal: abortController.signal,
              onStatus: (status) => {
                // A late cleanup message must not mark a finished run active.
                setAutoHighlightState(item.id, {
                  running: isActiveRun(),
                  status,
                });
                renderAutoHighlightState(
                  autoHighlightButton,
                  autoHighlightStatus,
                  item.id,
                );
              },
            });
            // The workflow reserves the paper synchronously; show that now.
            renderBusyDependentControls();
            const { summary } = await workflow;
            setAutoHighlightState(item.id, {
              running: false,
              status: summary,
            });
          } catch (error) {
            if (abortController.signal.aborted) {
              setAutoHighlightState(item.id, {
                running: false,
                status: formatAutoHighlightCancelledStatus(
                  error instanceof AutoHighlightCancelledError
                    ? error.keptHighlights
                    : 0,
                ),
              });
            } else {
              logReaderPaneError("auto-highlight workflow failed", error);
              const message =
                error instanceof Error
                  ? error.message
                  : "Auto-highlight failed.";
              // The highlight status line next to the button shows it.
              setAutoHighlightState(item.id, {
                running: false,
                status: `Highlighting failed: ${message}`,
              });
            }
          } finally {
            if (isActiveRun()) autoHighlightAbortControllers.delete(item.id);
          }
          renderAutoHighlightState(
            autoHighlightButton,
            autoHighlightStatus,
            item.id,
          );
          workbenchSection.markUpdated();
          notifyReaderPaneStateChanged(item.id);
        });

        pastSessionsButton.addEventListener("click", async () => {
          sessionHistoryOpen = sessionsSection.isExpanded();
          renamingSessionId = undefined;
          await renderSessionHistory();
        });

        researchBriefButton.addEventListener("click", async () => {
          if (isWorkbenchRequestBlocked()) return;
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
          if (isWorkbenchRequestBlocked()) return;
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
          if (isWorkbenchRequestBlocked()) return;
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
          if (isWorkbenchRequestBlocked()) return;
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
          if (isWorkbenchRequestBlocked()) return;
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

        // Each save creates a new note, so a second click waits for the first.
        let workbenchSaving = false;
        const startWorkbenchSave = () => {
          if (workbenchSaving) return false;
          workbenchSaving = true;
          saveWorkbenchNoteButton.disabled = true;
          saveWorkbenchCollectionButton.disabled = true;
          return true;
        };

        saveWorkbenchNoteButton.addEventListener("click", async () => {
          const [latestCard] = getPaperArtifactState(item.id).cards;
          if (!latestCard || !startWorkbenchSave()) {
            return;
          }

          try {
            await savePaperArtifactToNote({
              item,
              card: latestCard,
            });
            setPaperArtifactState(item.id, {
              ...getPaperArtifactState(item.id),
              status: `Saved “${latestCard.title}” to a Zotero note`,
            });
          } catch (error) {
            logReaderPaneError("workbench note save failed", error);
            setPaperArtifactState(item.id, {
              ...getPaperArtifactState(item.id),
              status:
                error instanceof Error
                  ? `Save to note failed: ${error.message}`
                  : "Save to note failed.",
            });
          } finally {
            workbenchSaving = false;
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
          if (!cards.length || !startWorkbenchSave()) {
            return;
          }

          try {
            const { collection } = await savePaperArtifactSetToCollection({
              item,
              cards,
            });
            setPaperArtifactState(item.id, {
              ...getPaperArtifactState(item.id),
              status: `Saved ${cards.length === 1 ? "1 card" : `${cards.length} cards`} as a note in the collection “${collection.name}”`,
            });
          } catch (error) {
            // Dismissing the collection picker is a choice, not a failure.
            if (!isCollectionChoiceCancelled(error)) {
              logReaderPaneError("workbench collection save failed", error);
              setPaperArtifactState(item.id, {
                ...getPaperArtifactState(item.id),
                status:
                  error instanceof Error
                    ? `Save for collection failed: ${error.message}`
                    : "Save for collection failed.",
              });
            }
          } finally {
            workbenchSaving = false;
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

        clearWorkbenchButton.addEventListener("click", async () => {
          const { cards } = getPaperArtifactState(item.id);
          if (!cards.length) return;
          const confirmation = buildClearCardsConfirmation(cards.length);
          if (
            !confirmDestructive(
              body.ownerDocument,
              confirmation.title,
              confirmation.message,
            )
          ) {
            return;
          }
          setPaperArtifactState(item.id, {
            running: false,
            status: formatClearedCardsStatus(cards.length),
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
          try {
            await sessionHistoryService.persistActiveSession({
              itemID: item.id,
              paperTitle: String(item.getField("title") || ""),
            });
          } catch (error) {
            logReaderPaneError("workbench clear persistence failed", error);
          }
        });

        let relatedConcernOrigin =
          getRelatedRecommendationState(item.id).concernOrigin || "user_text";
        relatedConcern.addEventListener("input", () => {
          relatedConcernOrigin = "user_text";
        });
        const getDiscoveryUnavailableReason = () => {
          const availability = getDiscoveryAvailability(
            getModeForItem(item.id),
          );
          return availability.available ? undefined : availability.reason;
        };
        const showRelatedStatus = (status: string) => {
          addon.data.relatedRecommendationStates?.set(item.id, {
            ...getRelatedRecommendationState(item.id),
            status,
          });
          renderRelatedState();
        };
        /**
         * Starts discovery unless one is already starting or running. Code
         * paths call this directly; they never click the Cancel toggle.
         */
        const requestRelatedDiscovery = async (beforeStart?: () => void) => {
          const decision = resolveDiscoveryRequest({
            running:
              relatedDiscoveryAbortControllers.has(item.id) ||
              getRelatedRecommendationState(item.id).running,
            unavailableReason: getDiscoveryUnavailableReason(),
          });
          if (decision.action !== "start") {
            // Keep the running search's concern text in place.
            showRelatedStatus(decision.message);
            return;
          }
          beforeStart?.();
          await startRelatedDiscovery();
        };
        relatedRecommendButton.addEventListener("click", async () => {
          const currentRelatedState = getRelatedRecommendationState(item.id);
          if (currentRelatedState.reviewInsightRunningCandidateID) {
            publicReviewAbortControllers.get(item.id)?.abort();
            addon.data.relatedRecommendationStates?.set(item.id, {
              ...currentRelatedState,
              status: "Cancelling public-review analysis…",
            });
            // Show the cancellation now, like the discovery branch below.
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
          if (currentRelatedState.running) {
            relatedDiscoveryAbortControllers.get(item.id)?.abort();
            const current = getRelatedRecommendationState(item.id);
            addon.data.relatedRecommendationStates?.set(item.id, {
              ...current,
              status: "Cancelling the prior-work search…",
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
          await requestRelatedDiscovery();
        });
        const startRelatedDiscovery = async () => {
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
            const requestContext = await captureRequestContext({
              itemID: item.id,
              reader: await ztoolkit.Reader.getReader().catch(() => undefined),
              selectedText: "",
            });
            await generateRelatedPaperGroups({
              itemID: item.id,
              itemTitle: item.getField("title"),
              requestContext,
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
                renderBusyDependentControls();
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
            logReaderPaneError("related-paper discovery failed", error);
            if (!reservationOwned) {
              // Report it under the prior-work button, not as a chat answer.
              addon.data.relatedRecommendationStates?.set(item.id, {
                ...getRelatedRecommendationState(item.id),
                status:
                  error instanceof Error
                    ? error.message
                    : "Prior-work search could not start.",
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
        };

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
            logReaderPaneError("discovery note save failed", error);
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
        const masteryNext = body.querySelector(
          "#paper-mastery-next",
        ) as HTMLButtonElement | null;
        const masteryReportRetry = body.querySelector(
          "#paper-mastery-report-retry",
        ) as HTMLButtonElement | null;

        const getCurrentMasteryDraft = (
          state:
            | import("./comprehensionCheck/types").ComprehensionCheckState
            | undefined,
        ) =>
          getMasteryAnswerDraft(
            item.id,
            state?.sessionID,
            state?.currentQuestion,
          );

        // Moves focus only when it is already in Mastery or nowhere, so a
        // question that arrives late never pulls the reader out of the PDF.
        const focusMasteryControl = (control: HTMLElement | null) => {
          if (!control || !masterySection) return;
          const doc = body.ownerDocument;
          const active = doc.activeElement;
          // With nothing focused, Gecko may report the root element.
          if (
            active &&
            active !== doc.body &&
            active !== doc.documentElement &&
            active !== paperMasteryBtn &&
            !masterySection.contains(active)
          ) {
            return;
          }
          control.focus();
        };

        function renderMasteryConfidence(value: number) {
          const label = `${Math.round(value * 100)}%`;
          if (masteryConfidence) {
            if (Number(masteryConfidence.value) !== value) {
              masteryConfidence.value = String(value);
            }
            masteryConfidence.setAttribute("aria-valuetext", label);
          }
          if (masteryConfidenceValue)
            masteryConfidenceValue.textContent = label;
        }

        masteryAnswer?.addEventListener("input", () => {
          const state = getMasteryState(item.id);
          if (!state?.currentQuestion || state.phase !== "awaiting-answer") {
            return;
          }
          setMasteryAnswerDraft(
            item.id,
            state.sessionID,
            state.currentQuestion,
            { text: masteryAnswer.value },
          );
          renderMasteryPanel();
        });

        masteryAnswer?.addEventListener("keydown", (event) => {
          if (event.key !== "Enter" || !(event.ctrlKey || event.metaKey)) {
            return;
          }
          event.preventDefault();
          if (masterySubmit && !masterySubmit.disabled) masterySubmit.click();
        });

        masteryConfidence?.addEventListener("input", () => {
          const value = Number(masteryConfidence.value);
          const state = getMasteryState(item.id);
          if (state?.currentQuestion) {
            setMasteryAnswerDraft(
              item.id,
              state.sessionID,
              state.currentQuestion,
              { confidence: value },
            );
          }
          renderMasteryConfidence(value);
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
          masteryMetrics.textContent = `Average rubric score ${Math.round(summary.averageScore * 100)}% · confidence calibration ${calibration} · next review ${nextReview}`;
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
              `Confidence ${Math.round(r.learnerConfidence * 100)}% · rubric score ${Math.round((r.normalizedScore ?? 0) * 100)}%`,
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

          const userText = getCurrentMasteryDraft(state).text.trim();
          if (userText) {
            addHistorySection(
              masteryFeedback,
              "answer",
              "Your Answer (draft)",
              userText,
            );
          }
        }

        /** The graded result of one round, kept on screen for review. */
        function showMasteryResult(
          state: import("./comprehensionCheck/types").ComprehensionCheckState,
          roundIndex: number,
        ) {
          const round = state.rounds[roundIndex];
          if (!masteryFeedback || !round) return;
          masteryFeedback.className = `pp-mastery-feedback pp-mastery-feedback--${round.understood ? "correct" : "incorrect"}`;
          masteryFeedback.replaceChildren();
          masteryFeedback.setAttribute(
            "aria-label",
            `Round ${roundIndex + 1} result`,
          );
          addHistorySection(
            masteryFeedback,
            "answer",
            "Your Answer",
            round.userAnswer,
          );
          addHistorySection(
            masteryFeedback,
            "feedback",
            "Feedback",
            round.evaluation,
          );
          if (!round.understood && round.explanation) {
            addHistorySection(
              masteryFeedback,
              "explanation",
              "📚 Explanation",
              round.explanation,
            );
          }
        }

        const toggleMasteryRound = (roundIndex: number) => {
          const phase = getMasteryState(item.id)?.phase;
          if (phase === "evaluating" || phase === "generating-question") {
            return;
          }
          updateMasteryChoices({
            selectedRound:
              getMasteryPanelChoices(item.id).selectedRound === roundIndex
                ? undefined
                : roundIndex,
          });
          renderMasteryPanel();
        };

        // Dots are rebuilt only when the rounds change, so a dot keeps keyboard
        // focus while the reader opens and closes rounds.
        function updateMasteryProgressDots(
          state: import("./comprehensionCheck/types").ComprehensionCheckState,
          interactive: boolean,
        ) {
          if (!masteryProgress) {
            return;
          }
          // A failed start (idle) has no current question to open.
          const showCurrent =
            state.phase !== "complete" && state.phase !== "idle";
          const dotsKey = `${state.sessionID}:${state.rounds
            .map((round) => (round.understood ? "1" : "0"))
            .join("")}:${showCurrent}`;
          if (dotsKey !== renderedMasteryDots) {
            renderedMasteryDots = dotsKey;
            const doc = body.ownerDocument;
            const makeDot = (
              index: number,
              modifier: string,
              label: string,
            ) => {
              const dot = doc.createElement("span");
              dot.className = `pp-mastery-progress-dot pp-mastery-progress-dot--${modifier}`;
              dot.title = label;
              dot.dataset.round = String(index);
              dot.setAttribute("tabindex", "0");
              dot.setAttribute("role", "button");
              dot.setAttribute("aria-label", label);
              dot.addEventListener("click", () => toggleMasteryRound(index));
              dot.addEventListener("keydown", (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  toggleMasteryRound(index);
                }
              });
              return dot;
            };
            masteryProgress.replaceChildren(
              ...state.rounds.map((r, i) =>
                makeDot(
                  i,
                  r.understood ? "correct" : "incorrect",
                  `Round ${i + 1}: ${r.understood ? "Understood" : "Needs review"}`,
                ),
              ),
              ...(showCurrent
                ? [makeDot(state.rounds.length, "current", "Current round")]
                : []),
            );
          }
          for (const dot of Array.from(
            masteryProgress.querySelectorAll(".pp-mastery-progress-dot"),
          ) as HTMLElement[]) {
            const selected =
              interactive &&
              Number(dot.dataset.round) ===
                getMasteryPanelChoices(item.id).selectedRound;
            dot.classList.toggle("pp-mastery-progress-dot--active", selected);
            dot.setAttribute("aria-pressed", String(selected));
            dot.setAttribute("aria-disabled", String(!interactive));
          }
        }

        function renderMasteryReport(
          state: import("./comprehensionCheck/types").ComprehensionCheckState,
        ) {
          if (!masteryReport) return;
          const report =
            state.phase !== "complete"
              ? undefined
              : state.finalReport
                ? { markdown: state.finalReport }
                : state.finalReportError
                  ? { text: state.finalReportError }
                  : state.running
                    ? { text: "Generating final report..." }
                    : undefined;
          const key = report ? JSON.stringify(report) : "";
          if (key !== renderedMasteryReport) {
            renderedMasteryReport = key;
            if (report?.markdown) {
              masteryReport.replaceChildren(
                renderMarkdownFragment(
                  report.markdown,
                  masteryReport.ownerDocument!,
                ),
              );
            } else {
              masteryReport.textContent = report?.text ?? "";
            }
          }
          masteryReport.style.display = report ? "" : "none";
        }

        const applyMasteryButton = (
          button: HTMLButtonElement | null,
          view: import("./ui/masteryPanelView").MasteryButtonView,
        ) => {
          if (!button) return;
          button.style.display = view.visible ? "" : "none";
          button.disabled = view.disabled;
          if (view.label) button.textContent = view.label;
          if (view.title) button.title = view.title;
          else button.removeAttribute("title");
        };

        /**
         * The single Mastery renderer. Live handlers and pane re-renders both
         * call it, so a run event can no longer hide a result being read.
         */
        function renderMasteryPanel() {
          const state = getMasteryState(item.id);
          const choices = syncMasteryPanelChoices(
            getMasteryPanelChoices(item.id),
            state,
          );
          setMasteryPanelChoices(item.id, choices);
          const draft = getCurrentMasteryDraft(state);
          const view = getMasteryPanelView(state, choices, {
            answerText: draft.text,
            busyReason: getMasteryBusyReason(),
            preparing: isMasteryPreparing(item.id),
          });
          applyMasteryButton(paperMasteryBtn, view.start);
          if (!masterySection) return;
          masterySection.style.display = view.visible ? "" : "none";
          if (!view.visible || !state) {
            if (masteryMetrics) masteryMetrics.textContent = "";
            return;
          }

          // Rewriting an unchanged live region would announce it again.
          if (masteryStatus && masteryStatus.textContent !== view.status) {
            masteryStatus.textContent = view.status;
          }
          renderMasteryMetrics(state);
          updateMasteryProgressDots(state, view.dotsInteractive);

          if (masteryQuestion) {
            const questionKey = view.question
              ? `${view.question.kind}:${view.question.markdown}`
              : "";
            if (questionKey !== renderedMasteryQuestion) {
              renderedMasteryQuestion = questionKey;
              masteryQuestion.replaceChildren(
                ...(view.question
                  ? [
                      renderMarkdownFragment(
                        view.question.markdown,
                        masteryQuestion.ownerDocument!,
                      ),
                    ]
                  : []),
              );
            }
            masteryQuestion.style.display = view.question ? "" : "none";
          }

          if (masteryFeedback) {
            const feedback = view.feedback;
            const feedbackKey = feedback
              ? [
                  state.sessionID,
                  state.rounds.length,
                  state.currentQuestion,
                  feedback.kind,
                  feedback.kind === "current" ? "" : feedback.roundIndex,
                ].join(":")
              : "";
            if (feedbackKey !== renderedMasteryFeedback) {
              renderedMasteryFeedback = feedbackKey;
              if (!feedback) {
                masteryFeedback.replaceChildren();
                masteryFeedback.className = "pp-mastery-feedback";
                masteryFeedback.removeAttribute("aria-label");
              } else if (feedback.kind === "result") {
                showMasteryResult(state, feedback.roundIndex);
              } else if (feedback.kind === "history") {
                showRoundHistory(state, feedback.roundIndex);
              } else {
                showCurrentRoundPreview(state);
              }
            }
            masteryFeedback.style.display = feedback ? "" : "none";
          }

          if (masteryAnswer) {
            masteryAnswer.style.display = view.answerVisible ? "" : "none";
            masteryAnswer.readOnly = view.answerReadOnly;
            if (masteryAnswer.value !== draft.text) {
              masteryAnswer.value = draft.text;
            }
          }
          if (masteryConfidenceRow) {
            masteryConfidenceRow.style.display = view.answerVisible
              ? ""
              : "none";
          }
          if (masteryConfidence) {
            masteryConfidence.disabled = view.answerReadOnly;
          }
          renderMasteryConfidence(draft.confidence);

          applyMasteryButton(masterySubmit, view.submit);
          applyMasteryButton(masteryNext, view.next);
          applyMasteryButton(masteryEnd, view.end);
          applyMasteryButton(masteryReportRetry, view.retryReport);
          if (masteryActionsDiv) {
            masteryActionsDiv.style.display =
              view.submit.visible ||
              view.next.visible ||
              view.end.visible ||
              view.retryReport.visible
                ? ""
                : "none";
          }
          renderMasteryReport(state);
        }

        /** Returns false when the engine refused to start the report run. */
        async function showMasteryCompletion(
          state: import("./comprehensionCheck/types").ComprehensionCheckState,
          continuationToken?: ReaderRunToken,
          options: { regenerate?: boolean } = {},
        ): Promise<boolean> {
          if (
            !options.regenerate &&
            (state.finalReport || state.finalReportError)
          ) {
            renderMasteryPanel();
            return true;
          }

          const masterySessionID = state.sessionID;
          const markAdmitted = () => {
            if (!getMasteryStateForSession(item.id, masterySessionID)) return;
            state.phase = "complete";
            state.running = true;
            state.status = "Generating final report...";
            // A retry clears the old reason only once the run has started.
            state.finalReportError = undefined;
            setMasteryState(item.id, state);
            renderMasteryPanel();
          };
          return sendMasteryPrompt(
            buildFinalReportPrompt(state.rounds, state.topics),
            async (assistantText) => {
              const s = getMasteryStateForSession(item.id, masterySessionID);
              if (s) {
                s.running = false;
                s.status = "Complete";
                s.finalReport = assistantText;
                s.finalReportError = undefined;
                setMasteryState(item.id, s);
                renderMasteryPanel();
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
                renderMasteryPanel();
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
        ): Promise<boolean> {
          const itemID = item.id;
          const { mode, placeholderResponse } =
            getProviderDescriptorForItem(itemID);
          // handleUserInput returns without calling back when the engine is
          // busy, so admission is the only sign that the run started.
          let admitted = false;
          try {
            await handleUserInput(
              input,
              chatMessages,
              mode,
              itemID,
              item.getField("title") as string,
              placeholderResponse,
              streamingIndicator,
              {
                question: prompt,
                preserveComposer: true,
                silentUserMessage: true,
                suppressChatMessages: true,
                profile: "analysis",
                outputSchema,
                continuationToken,
                onAdmitted: () => {
                  admitted = true;
                  onAdmitted?.();
                },
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
          } catch (error) {
            logReaderPaneError("structured workflow failed", error);
            await onFailure?.();
            await sessionHistoryService.persistActiveSession({
              itemID,
              paperTitle: String(item.getField("title") || ""),
            });
            workbenchSection.markUpdated();
          }
          return admitted;
        }

        const getMasteryBusyReason = () => {
          const block = getWorkbenchBlockForItem(item.id);
          return block.blocked
            ? (block.reason ?? "Wait for the Workbench request to finish.")
            : undefined;
        };
        // A refused run used to leave Mastery unchanged with no message.
        const reportMasteryRunRefused = () => {
          showComposerNotice(
            input,
            `Paper Mastery could not start a run. ${getMasteryBusyReason() ?? "Another Paper Pilot task is using this paper."}`,
          );
          renderMasteryPanel();
        };

        startPaperMastery = async () => {
          if (!masterySection) {
            return;
          }
          if (isMasteryPreparing(item.id)) return;
          const existingState = getMasteryState(item.id);
          if (
            existingState?.running ||
            (existingState &&
              existingState.phase !== "idle" &&
              existingState.phase !== "complete")
          ) {
            renderMasteryPanel();
            return;
          }
          if (
            existingState?.phase === "complete" &&
            !confirmDestructive(
              body.ownerDocument,
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
          // First use extracts the PDF, which can take a while. Say so and
          // ignore repeat clicks until it finishes.
          setMasteryPreparing(item.id, true);
          renderMasteryPanel();
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
          } catch (error) {
            logReaderPaneError("Paper Mastery source extraction failed", error);
            // The question runner will surface extraction errors. Preserve the
            // stable item identity so a failed preparation cannot bind elsewhere.
          } finally {
            setMasteryPreparing(item.id, false);
            if (isCurrentRender()) renderMasteryPanel();
          }
          // Another run may have started while the paper was being read.
          if (getMasteryBusyReason()) {
            reportMasteryRunRefused();
            return;
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
            clearMasteryAnswerDraft(item.id);
            state.phase = "generating-question";
            state.running = true;
            state.status = "Generating first question...";
            setMasteryState(item.id, state);
            setMasteryPanelChoices(item.id, {
              runKey: masteryRunKey(getMasteryState(item.id)),
            });
            renderMasteryPanel();
            // Starting from the Critical Read report leaves the reader below
            // this panel; bring it into view.
            masterySection.scrollIntoView?.({ block: "nearest" });
          };

          // The status is saved with the state; a pane re-render would
          // otherwise bring back "Generating first question..." for good.
          const resetOnFail = () => {
            const fs = getMasteryStateForSession(item.id, masterySessionID);
            if (fs) {
              fs.phase = "idle";
              fs.running = false;
              fs.status =
                "The first question was not generated. Click Paper Mastery to try again.";
              setMasteryState(item.id, fs);
            }
            renderMasteryPanel();
          };
          const started = await sendMasteryPrompt(
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
              renderMasteryPanel();
              focusMasteryControl(masteryAnswer);
            },
            resetOnFail,
            undefined,
            markAdmitted,
            MASTERY_QUESTION_OUTPUT_SCHEMA,
          );
          if (!started) reportMasteryRunRefused();
        };
        paperMasteryBtn?.addEventListener("click", startPaperMastery);
        const activateCapability = async (
          capability: import("./readerCapabilityBridge").ReaderCapabilityAction,
        ) => {
          if (capability === "critical-read") {
            showCriticalRead();
            return true;
          }
          if (!masterySection) return false;
          revealWorkbenchPanel();
          if (getMasteryState(item.id)?.phase === "complete") {
            // Opening a finished session shows its report. Restarting stays
            // an explicit choice behind the pane's Restart button.
            renderMasteryPanel();
          } else {
            await startPaperMastery();
          }
          revealWorkbenchPanel(masterySection);
          return true;
        };
        addon.data.activateReaderCapability?.set(item.id, activateCapability);
        cleanupTasks.push(() => {
          if (
            addon.data.activateReaderCapability?.get(item.id) ===
            activateCapability
          ) {
            addon.data.activateReaderCapability.delete(item.id);
          }
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
            updateMasteryChoices({ selectedRound: undefined });
            renderMasteryPanel();
          };

          const question = state.currentQuestion;
          const masterySessionID = state.sessionID;
          const learnerConfidence = Math.max(
            0,
            Math.min(1, Number(masteryConfidence?.value ?? 0.7)),
          );
          // The unsent draft stays, so submitting again needs no retyping.
          const resetSubmitOnFail = () => {
            const fs = getMasteryStateForSession(item.id, masterySessionID);
            if (fs) {
              fs.phase = "awaiting-answer";
              fs.running = false;
              fs.status = "Your answer was not graded. Submit it again.";
              setMasteryState(item.id, fs);
            }
            renderMasteryPanel();
          };
          const graded = await sendMasteryPrompt(
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
              // The graded answer now lives in the round. Its result stays
              // on screen until the reader chooses Next question.
              clearMasteryAnswerDraft(item.id);
              setMasteryPanelChoices(item.id, {
                runKey: masteryRunKey(s),
                reviewRound: s.rounds.length - 1,
              });

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
              renderMasteryPanel();

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
                  renderMasteryPanel();
                  focusMasteryControl(masteryNext);
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
                      "The next question was not generated, so the session ended. Generate the final report from the answered rounds, or restart Paper Mastery.";
                    setMasteryState(item.id, fst);
                  }
                  renderMasteryPanel();
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
          // The draft stays in the answer box; say why nothing happened.
          if (!graded) reportMasteryRunRefused();
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
          // Ending drops an answer that was typed but never submitted.
          const unsent = getCurrentMasteryDraft(state).text.trim();
          if (
            unsent &&
            !confirmDestructive(
              body.ownerDocument,
              "End Paper Mastery",
              "End the session now? Your unsent answer will be discarded.",
            )
          ) {
            return;
          }
          if (state.rounds.length > 0) {
            // Keep the draft until the report run has actually started.
            if (await showMasteryCompletion(state)) {
              clearMasteryAnswerDraft(item.id);
            } else {
              reportMasteryRunRefused();
            }
          } else {
            clearMasteryAnswerDraft(item.id);
            clearMasteryState(item.id);
            renderMasteryPanel();
            // Without a save, reopening the session brings Mastery back.
            await sessionHistoryService.persistActiveSession({
              itemID: item.id,
              paperTitle: String(item.getField("title") || ""),
            });
          }
        });

        // The final report had no retry after a failure or a stopped session.
        masteryReportRetry?.addEventListener("click", async () => {
          const state = getMasteryState(item.id);
          if (
            !state ||
            state.phase !== "complete" ||
            state.running ||
            state.finalReport ||
            !state.rounds.length
          ) {
            return;
          }
          // The failure reason stays until the new run has started.
          const started = await showMasteryCompletion(state, undefined, {
            regenerate: true,
          });
          if (!started) reportMasteryRunRefused();
        });

        masteryNext?.addEventListener("click", () => {
          if (getMasteryState(item.id)?.phase !== "awaiting-answer") return;
          updateMasteryChoices({
            reviewRound: undefined,
            selectedRound: undefined,
          });
          renderMasteryPanel();
          masteryAnswer?.focus();
        });

        newSessionButton.addEventListener("click", async () => {
          const mode = getModeForItem(item.id);
          const impact = describeNewSessionImpact({
            criticalRead: getCriticalReadStateForItem(),
            mastery: getMasteryState(item.id),
            historyMode: resolveSessionHistoryPrefs().mode,
          });
          if (
            impact &&
            !confirmDestructive(
              body.ownerDocument,
              impact.title,
              impact.message,
            )
          ) {
            return;
          }
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
          if (!isCurrentRender()) return;
          // Guidance stays inside the open popover, not in the transcript.
          paneHeader.setCodexAuthStatus(
            buildCodexAuthenticateMessage(
              loginState,
              addon.data.codexLastProbeError,
            ),
          );
        });

        codexDeviceAuthButton.addEventListener("click", () => {
          paneHeader.setCodexAuthStatus(
            "If your Codex CLI prompts for device auth, complete that flow in the terminal, then click Re-check status.",
          );
        });

        codexRecheckButton.addEventListener("click", async () => {
          paneHeader.setCodexAuthStatus("Checking Codex CLI status…");
          await refreshPaneState({
            isCurrent: isCurrentRender,
            renderTranscript: false,
          });
          if (!isCurrentRender()) return;
          const loginState = lastCodexLoginState;
          paneHeader.setCodexAuthStatus(
            loginState === "login_required" ||
              loginState === "unavailable" ||
              loginState === "error"
              ? buildCodexAuthenticateMessage(
                  loginState === "error" ? "unavailable" : loginState,
                  addon.data.codexLastProbeError,
                )
              : "",
          );
        });

        modelSaveButton.addEventListener("click", async () => {
          const savedModel = modelInput.value.trim();
          if (!savedModel) {
            return;
          }
          const activeMode = getCurrentProviderDescriptor(item.id).mode;
          if (activeMode === "claude_code") {
            setPref("claudeDefaultModel", normalizeClaudeModel(savedModel));
            setPref(
              "claudeReasoningEffort",
              normalizeClaudeReasoningEffort(effortInput.value),
            );
          } else {
            const normalizedCodexModel = normalizeCodexModel(savedModel);
            setPref("codexDefaultModel", normalizedCodexModel);
            setPref(
              "codexReasoningEffort",
              normalizeCodexReasoningEffort(
                effortInput.value,
                normalizedCodexModel,
              ),
            );
          }
          rememberRecentModel(
            activeMode,
            normalizeModelForMode(activeMode, savedModel),
          );
          paneHeader.markModelSaved();
          // Saving finishes the task, so the popover closes like Escape does.
          paneHeader.setOpen(false, true);
          await refreshPaneState({ renderTranscript: false });
        });

        codexWebSearchToggle.addEventListener("change", async () => {
          setPref("codexEnableWebSearch", codexWebSearchToggle.checked);
          await refreshAfterEngineChange();
        });

        const showComposerHint = (text: string) =>
          showComposerNotice(input, text);
        let lastSendClickAt: number | undefined;

        const submitCurrentInput = async () => {
          // A bare /word picks a command or reports an unknown one. It is
          // never sent as a question.
          if (chatTools.submitSlashCommand()) return;
          if (isReaderChatBusy(item.id)) {
            if (input.value.trim()) {
              showComposerHint(getBusySubmitHint(getComposerRunFlags(item.id)));
            }
            return;
          }
          // A new question replaces any instruction left from the last run.
          showComposerNotice(input, "");
          saveInputDraft();
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
          if (e.defaultPrevented) return;
          if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
            e.preventDefault();
            await submitCurrentInput();
          }
        });
        sendButton.addEventListener("click", (event) => {
          if (isReaderChatBusy(item.id)) {
            // Send relabels itself to Stop at once. The tail of a
            // double-click must not cancel the request it just sent.
            if (
              shouldIgnoreStopActivation({
                now: Date.now(),
                lastSendAt: lastSendClickAt,
                clickDetail: event.detail,
              })
            ) {
              return;
            }
            void cancelCurrentRun();
          } else {
            lastSendClickAt = Date.now();
            void submitCurrentInput();
          }
        });

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
            addon.data.pendingDiscoveryConcerns?.delete(item.id);
            relatedSection.setExpanded(true);
            await requestRelatedDiscovery(() => {
              relatedConcern.value = pendingDiscovery.text;
              relatedConcernOrigin = pendingDiscovery.origin;
            });
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

          addon.data.pendingReaderActions?.delete(item.id);
          if (isReaderChatBusy(item.id)) {
            renderDraftCard(draftCard, item.id);
            return;
          }
          renderDraftCard(draftCard, item.id);
          input.focus();
          if (pending.autoSubmit) {
            const requestDraftContext = addon.data.readerActionDrafts?.get(
              item.id,
            );
            clearReaderActionDraft(item.id);
            const descriptor = getCurrentProviderDescriptor(item.id);
            await handleUserInput(
              input,
              chatMessages,
              descriptor.mode,
              item.id,
              String(item.getField("title") || ""),
              descriptor.placeholderResponse,
              streamingIndicator,
              {
                question: pending.question,
                requestDraftContext,
                preserveComposer: true,
              },
            );
          }
        };
        addon.data.applyReaderActionToPane?.set(
          item.id,
          applyReaderActionToPane,
        );
        const showPaneNotice = (text: string) =>
          showComposerNotice(input, text);
        addon.data.showReaderPaneNotice?.set(item.id, showPaneNotice);
        cleanupTasks.push(() => {
          if (
            addon.data.applyReaderActionToPane?.get(item.id) ===
            applyReaderActionToPane
          ) {
            addon.data.applyReaderActionToPane.delete(item.id);
          }
          if (
            addon.data.showReaderPaneNotice?.get(item.id) === showPaneNotice
          ) {
            addon.data.showReaderPaneNotice.delete(item.id);
          }
        });
        void addon.data.applyReaderActionToPane?.get(item.id)?.();
      }
    },
    onDestroy: ({ body }) => {
      paneCleanupByBody.get(body)?.();
      const itemID = paneItemByBody.get(body);
      if (itemID !== undefined) pruneReaderPaneItemState(itemID);
      activePaneBodies.delete(body);
      paneCleanupByBody.delete(body);
      paneTemplateByBody.delete(body);
      paneItemByBody.delete(body);
      paneLayoutByBody.delete(body);
    },
  });

  if (result) {
    addon.data.aiReaderPaneRegistered = true;
  }
}

function renderDraftCard(draftCard: HTMLElement, itemID: number) {
  const sessionID = sessionStore.get(itemID)?.sessionId;
  const context = sessionID
    ? getChatDraft(itemID, sessionID).context
    : undefined;
  const doc = draftCard.ownerDocument;
  draftCard.replaceChildren();
  draftCard.style.display = "flex";
  const paper = doc.createElement("span");
  paper.className = "pp-chat-source";
  const item = Zotero.Items.get(itemID);
  const attachmentTitle = getAttachmentTitle(context?.attachmentID);
  paper.textContent = formatDraftSourceLabel({
    paperTitle: String(item?.getField("title") || ""),
    attachmentTitle,
  });
  paper.title = paper.textContent;
  draftCard.append(paper);
  if (!context || (!context.text && !context.annotationIDs?.length)) return;
  const details = doc.createElement("details");
  const summary = doc.createElement("summary");
  summary.textContent = context.annotationIDs?.length
    ? `${context.annotationIDs.length} selected annotations`
    : "Selected passage";
  const content = doc.createElement("div");
  content.textContent =
    context.text || formatDraftAnnotationNotice(attachmentTitle);
  if (context.pageLabel || context.pageIndex !== undefined)
    content.append(
      doc.createTextNode(
        ` · Page ${context.pageLabel || Number(context.pageIndex) + 1}`,
      ),
    );
  const remove = doc.createElement("button");
  remove.type = "button";
  remove.className = "pp-btn pp-btn--ghost";
  remove.textContent = "Remove context";
  remove.addEventListener("click", () => {
    if (sessionID)
      updateChatDraft(itemID, sessionID, {
        context: { attachmentID: context.attachmentID, text: "" },
      });
    clearReaderActionDraft(itemID);
    renderDraftCard(draftCard, itemID);
  });
  details.append(summary, content, remove);
  draftCard.append(details);
}

/** The attachment's own title, such as "Full Text PDF", when available. */
function getAttachmentTitle(attachmentID?: number): string | undefined {
  if (!attachmentID) return undefined;
  try {
    const attachment = Zotero.Items.get(attachmentID);
    const title = attachment?.getField?.("title");
    return title ? String(title) : undefined;
  } catch {
    return undefined;
  }
}

function getCurrentProviderDescriptor(itemID?: number) {
  return getProviderDescriptorForItem(itemID);
}

function getModeShortLabel(mode?: EngineMode) {
  if (mode === "claude_code") {
    return "Claude";
  }
  return "Codex";
}

function getModeLabel(mode: EngineMode) {
  if (mode === "claude_code") return "Claude Code";
  return "Codex CLI";
}

interface PaneElements {
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
  modelRow: HTMLElement;
  modelInput: HTMLSelectElement;
  effortInput: HTMLSelectElement;
  codexOptionsRow: HTMLElement;
  codexWebSearchToggle: HTMLInputElement;
  modelHistory: HTMLElement;
  chatMessages: HTMLElement;
  draftCard: HTMLElement;
  streamingIndicator: HTMLElement;
  setSectionSummary: (summary: string) => void;
}

async function renderPaneState(options: {
  itemID: number;
  itemTitle: string;
  elements: PaneElements;
  isCurrent?: () => boolean;
  renderTranscript?: boolean;
}) {
  const params = { ...options, ...options.elements };
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

  renderRunStateCard(
    params.runStateCard,
    descriptor.mode,
    params.itemID,
    params.itemTitle,
    "not_checked",
  );
  renderCodexActions(params.codexActions, descriptor.mode);
  renderModelRow(params.modelRow, params.modelInput, descriptor.mode);
  renderCodexOptionsRow(
    params.codexOptionsRow,
    params.codexWebSearchToggle,
    descriptor.mode,
  );
  renderModelHistory(params.modelHistory, params.modelInput, descriptor.mode);
  renderEffortInput(params.effortInput, params.modelInput, descriptor.mode);
  renderEngineSelection(params.modeChip, {
    mode,
    defaultMode,
    hasOverride: hasModeOverrideForItem(params.itemID),
  });
  renderModeHeader(
    params.modeChip,
    params.modeStatus,
    descriptor.label,
    descriptor.status,
  );
  if (params.renderTranscript !== false) {
    renderMessageHistory(
      params.chatMessages,
      session.sessionId,
      descriptor.placeholderResponse,
    );
  }
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

function isAutoHighlightCancelling(itemID: number) {
  return Boolean(autoHighlightAbortControllers.get(itemID)?.signal.aborted);
}

function renderAutoHighlightState(
  button: HTMLButtonElement,
  status: HTMLElement,
  itemID: number,
) {
  const state = getAutoHighlightState(itemID);
  const block = getWorkbenchBlockForItem(itemID);
  const presentation = getAutoHighlightButtonPresentation({
    running: state.running,
    cancelling: isAutoHighlightCancelling(itemID),
    busyReason: block.blocked
      ? (block.reason ?? "Wait for the Workbench request to finish.")
      : undefined,
  });
  button.disabled = presentation.disabled;
  button.textContent = presentation.label;
  button.title = presentation.title ?? "";
  status.textContent = state.status;
}

/**
 * Refreshes only the prior-work button and its note. Busy changes call this
 * instead of rebuilding the results list, which would close open insights.
 */
const REVIEW_INSIGHT_BUSY_REASON =
  "Wait for the current review analysis to finish.";

function renderDiscoveryEntryButton(button: HTMLButtonElement, itemID: number) {
  const state = getRelatedRecommendationState(itemID);
  const discovery = getDiscoveryAvailability(getModeForItem(itemID));
  const block = getWorkbenchBlockForItem(itemID);
  const presentation = getDiscoveryButtonPresentation({
    reviewInsightRunning: Boolean(state.reviewInsightRunningCandidateID),
    running: state.running,
    hasResults: state.groups.length > 0,
    unavailableReason: discovery.available ? undefined : discovery.reason,
    busyReason: block.blocked
      ? (block.reason ?? "Wait for the Workbench request to finish.")
      : undefined,
  });
  button.disabled = presentation.disabled;
  button.textContent = presentation.label;
  button.title = presentation.note;
  const availabilityNote = button
    .closest("#paper-pilot-container")
    ?.querySelector("#chat-related-availability") as HTMLElement | null;
  if (availabilityNote) {
    availabilityNote.textContent = presentation.note;
    availabilityNote.style.display = presentation.note ? "block" : "none";
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
  const workbenchBlock = getWorkbenchBlockForItem(itemID);
  if (!recommendationState.running && state.enabled && workbenchBlock.blocked) {
    // Compare shares the engine slot with chat and the other Workbench cards.
    const reason =
      workbenchBlock.reason ??
      "Wait for the current Workbench request to finish.";
    compareButton.disabled = true;
    compareButton.textContent = state.label;
    compareButton.title = reason;
    compareButton.setAttribute("aria-label", `Compare unavailable: ${reason}`);
    return;
  }
  compareButton.disabled = recommendationState.running || !state.enabled;
  compareButton.textContent = state.label;
  compareButton.title = recommendationState.running
    ? "Compare unlocks when the prior-work search finishes."
    : state.title;
  compareButton.setAttribute(
    "aria-label",
    recommendationState.running
      ? "Compare is unavailable while the prior-work search runs"
      : state.ariaLabel,
  );
}

function renderCompareHelperState(
  compareHelper: HTMLElement,
  itemID: number,
  currentPaperTitle = getCurrentPaperTitle(itemID),
) {
  const discovery = getDiscoveryAvailability(getModeForItem(itemID));
  const workflowState = getPaperCompareWorkflowState({
    currentPaperTitle,
    groups: getRelatedRecommendationState(itemID).groups,
    recommendationsRunning: getRelatedRecommendationState(itemID).running,
    discoveryUnavailableReason: discovery.available
      ? undefined
      : discovery.reason,
  });
  compareHelper.textContent = workflowState.helperText;
  compareHelper.className =
    workflowState.tone === "ready"
      ? "pp-compare-helper pp-compare-helper--ready"
      : "pp-compare-helper pp-compare-helper--default";
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
  renderDiscoveryEntryButton(button, itemID);
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
          state.reviewInsightRunningCandidateID ===
          (paper.candidateID || paper.title),
        reviewInsightBlockedReason: state.reviewInsightRunningCandidateID
          ? REVIEW_INSIGHT_BUSY_REASON
          : undefined,
        actions: {
          onSaveCandidate: async (target) => {
            const home = await loadResearchWorkspaceHome();
            if (!home.projects.length) {
              showResearchWorkspaceRequiredPanel({
                mount: groupsContainer,
                title: "Save candidate to project inbox",
                body: "Create a Research Workspace project before saving a candidate.",
                items: [Zotero.Items.get(itemID)].filter(Boolean),
              });
              return;
            }
            const select = doc.createElement("select");
            select.setAttribute("aria-label", "Candidate destination project");
            for (const project of home.projects) {
              const option = doc.createElement("option");
              option.value = project.projectID;
              option.textContent = project.name;
              select.append(option);
            }
            const candidatePanel = showChatReviewPanel({
              mount: groupsContainer,
              title: "Save candidate to project inbox",
              body: `${target.title}\n${target.reason || ""}\nPDF linking and screening remain separate steps.`,
              fields: [select],
              confirmLabel: "Save candidate",
              onConfirm: async () => {
                await addResearchWorkspaceCandidate({
                  projectID: select.value,
                  metadata: {
                    title: target.title,
                    doi: target.doi,
                    year: target.year,
                    url: target.url,
                    authors: target.authors,
                  },
                  provenance: {
                    kind: "discovery",
                    url: target.url,
                    sessionID: sessionStore.get(itemID)?.sessionId,
                    note: target.searchConcern || target.reason,
                  },
                  userNote: target.reason,
                });
                appendOpenResearchWorkspaceAction(candidatePanel);
                return "Candidate saved. Open the project inbox in the Research Workspace to link an exact PDF.";
              },
            });
          },
          onOpen: (target) =>
            openRecommendedPaper(target, {
              includeReviewURL: canViewPublicReviewInsights(
                addon.data.criticalReadStates?.get(itemID),
              ),
            }),
          onOpenURL: (url) => Zotero.launchURL(url),
          onError: setFailure,
          // The row already shows the error; keep it in the stored status
          // without a rebuild, which would remove the row's message.
          onRowError: (error) => {
            const message =
              error instanceof Error
                ? error.message
                : "The discovery action could not be completed.";
            addon.data.relatedRecommendationStates?.set(itemID, {
              ...getRelatedRecommendationState(itemID),
              status: message,
            });
            status.style.display = "block";
            status.textContent = message;
          },
          onAdd: async (target) => {
            let result: Awaited<
              ReturnType<typeof addRecommendationToCollection>
            >;
            try {
              result = await addRecommendationToCollection({
                sourceItemID: itemID,
                paper: target,
                includeReviewURL: canViewPublicReviewInsights(
                  addon.data.criticalReadStates?.get(itemID),
                ),
              });
            } catch (error) {
              // Dismissing the collection picker is a choice, not a failure.
              if (isCollectionChoiceCancelled(error)) return;
              throw error;
            }
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
            // Only the running paper's button cancels. Another paper's click
            // must not stop a run it does not own.
            if (
              runningController &&
              getRelatedRecommendationState(itemID)
                .reviewInsightRunningCandidateID !==
                (target.candidateID || target.title)
            ) {
              throw new Error(REVIEW_INSIGHT_BUSY_REASON);
            }
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
              const requestContext = await captureRequestContext({
                itemID,
                reader: await ztoolkit.Reader.getReader().catch(
                  () => undefined,
                ),
                selectedText: "",
              });
              const insight = await generatePublicReviewInsight({
                itemID,
                itemTitle: currentPaperTitle,
                requestContext,
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
    renderCodexActionsForLoginState(chip, loginState);
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
  } catch (error) {
    logReaderPaneError("Codex status probe failed", error);
    if (!isCurrent() || getActiveReaderRunMode(itemID)) return;
    renderModeHeader(chip, status, "Codex CLI", "error");
    renderCodexActionsForLoginState(chip, "error");
    const detail =
      addon.data.codexLastProbeError ||
      (error instanceof Error ? error.message : String(error));
    if (detail) status.textContent = `${status.textContent} · ${detail}`;
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
    ?.render(getVisibleRunProgressState(itemID));
}

function renderCodexActions(codexActions: HTMLElement, mode: EngineMode) {
  renderCodexAuthActions(codexActions, mode, lastCodexLoginState);
}

/** Records the probed login state and shows auth controls only when needed. */
function renderCodexActionsForLoginState(
  anchor: HTMLElement,
  loginState: string,
) {
  lastCodexLoginState = loginState;
  const codexActions = anchor
    .closest(".pp-pane-header")
    ?.querySelector<HTMLElement>("#paper-pilot-codex-actions");
  if (codexActions) {
    renderCodexAuthActions(codexActions, "codex_cli", loginState);
  }
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

const renderedTranscriptCounts = new WeakMap<
  HTMLElement,
  { sessionId: string; count: number }
>();

function renderMessageHistory(
  chatMessages: HTMLElement,
  sessionId: string,
  placeholderResponse: string,
) {
  const sourceChecks = new Map<string, Promise<void>>();
  const getMessages = () =>
    messageStore
      .list(sessionId)
      .filter((message) => !isLikelySilentToolMessage(message));
  const messages = getMessages();
  const previous = renderedTranscriptCounts.get(chatMessages);
  renderedTranscriptCounts.set(chatMessages, {
    sessionId,
    count: messages.length,
  });
  // The rebuilt window clears the prompt, so remember whether it was unread.
  const hadNewResponse = hasChatNewResponse(chatMessages);

  if (!messages.length) {
    disposeChatTranscriptWindow(chatMessages);
    clearChatNewResponse(chatMessages);
    chatMessages.replaceChildren();
    renderHelpState(chatMessages, placeholderResponse);
    return;
  }

  const position = isChatFollowingLatest(chatMessages)
    ? undefined
    : captureChatPosition(chatMessages);
  const window = renderChatTranscriptWindow({
    container: chatMessages,
    getItems: getMessages,
    getKey: (message) => message.id,
    renderItem: (message) => {
      const snapshot =
        message.requestContext ?? message.request?.requestContext;
      let sourceCheck: Promise<void> | undefined;
      if (
        snapshot &&
        message.citations?.some((citation) => citation.status === "verified")
      ) {
        const key = `${snapshot.sourceID}:${snapshot.contentFingerprint}`;
        sourceCheck = sourceChecks.get(key);
        if (!sourceCheck) {
          sourceCheck = assertRequestContextCurrent(snapshot);
          sourceChecks.set(key, sourceCheck);
        }
      }
      const messageElement = addMessage(
        chatMessages,
        message.status === "error" ? `Error: ${message.text}` : message.text,
        message.role === "assistant" ? "ai" : "user",
        { ...chatMessageOptions.get(chatMessages)?.(message), sourceCheck },
      );
      return messageElement?.parentElement || null;
    },
  });
  if (!position) return;
  window.showMessage(position.key, position.offset, { focus: false });
  if (
    previous?.sessionId === sessionId &&
    (messages.length > previous.count || hadNewResponse)
  )
    notifyChatTranscriptUpdate(chatMessages, false);
}

function renderStreamingIndicator(
  streamingIndicator: HTMLElement,
  visible: boolean,
) {
  const progressCard = streamingIndicator
    .closest("#paper-pilot-container")
    ?.querySelector<HTMLElement>("#paper-pilot-run-state");
  streamingIndicator.style.display =
    visible && progressCard?.style.display !== "block" ? "flex" : "none";
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
  await handleUserInput(
    params.input,
    params.chatMessages,
    getCurrentProviderDescriptor(params.item.id).mode,
    params.item.id,
    params.item.getField("title"),
    getCurrentProviderDescriptor(params.item.id).placeholderResponse,
    params.streamingIndicator,
    {
      question: prompt,
      preserveComposer: true,
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
      status: `Running “${request.label}”…`,
      activeKind: params.kind,
      cards: existing.cards,
    });

    renderWorkbenchArtifactState(params.elements, params.item.id);
  };

  await handleUserInput(
    params.input,
    params.chatMessages,
    getCurrentProviderDescriptor(params.item.id).mode,
    params.item.id,
    params.item.getField("title"),
    getCurrentProviderDescriptor(params.item.id).placeholderResponse,
    params.streamingIndicator,
    {
      question: request.prompt,
      preserveComposer: true,
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
            logReaderPaneError("paper artifact response parsing failed", error);
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
    logReaderPaneError("paper comparison preparation failed", error);
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

  await handleUserInput(
    params.input,
    params.chatMessages,
    getCurrentProviderDescriptor(params.item.id).mode,
    params.item.id,
    params.item.getField("title"),
    getCurrentProviderDescriptor(params.item.id).placeholderResponse,
    params.streamingIndicator,
    {
      question: request.prompt,
      preserveComposer: true,
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
            logReaderPaneError(
              "paper comparison response parsing failed",
              error,
            );
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
    question?: string;
    requestDraftContext?: import("./ui/chatDraft").ChatDraftContext;
    requestContext?: import("./context/requestContext").RequestContextSnapshot;
    preserveComposer?: boolean;
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
  const question = (options?.question ?? input.value).trim();
  if (!question) return;
  const activeRunMessage = getActiveRunMessage(mode, itemID);
  const continuingParent = Boolean(
    options?.continuationToken &&
      isReaderRunTokenActive(itemID, options.continuationToken),
  );
  if (activeRunMessage && !continuingParent) {
    if (!options?.suppressChatMessages)
      showComposerNotice(input, activeRunMessage);
    return;
  }
  const admittedAt = Date.now();
  const admissionToken = claimChatEngineRequest(itemID);
  if (!admissionToken) return;
  let sourceCapturedAt: number | undefined;
  let userTurnPersistedAt: number | undefined;
  const current = sessionStore.getOrCreate(itemID, mode, itemTitle);
  const activeSessionID = current.sessionId;
  const admittedDraft = getChatDraft(itemID, activeSessionID);
  const actionDraft = addon.data.readerActionDrafts?.get(itemID);
  const context =
    options?.requestDraftContext ??
    admittedDraft.context ??
    (actionDraft?.sessionId === activeSessionID ? actionDraft : undefined);
  const preserveComposer =
    options?.preserveComposer || options?.silentUserMessage;
  let submission: ChatDraftSubmission | undefined =
    !preserveComposer && admittedDraft.submission?.request.question === question
      ? admittedDraft.submission
      : undefined;
  mode = submission?.request.executionSettings?.mode ?? mode;
  let consumed = false;
  let submitted = false;
  let turnId: string | undefined;
  let attemptId: string | undefined;
  let requestContextStatus: ChatContextStatus | undefined;
  const complete = async (result: ReaderRunCompletionResult) => {
    result.timings ??= { preparingAt: admittedAt };
    if (result.timings) {
      const t = result.timings;
      t.admittedAt = admittedAt;
      t.sourceCapturedAt = sourceCapturedAt;
      t.userTurnPersistedAt = userTurnPersistedAt;
      const seconds = (end?: number, start?: number) =>
        end && start ? `${((end - start) / 1000).toFixed(1)}s` : "unavailable";
      const status = input
        .closest("#paper-pilot-container")
        ?.querySelector(".pp-chat-context-status");
      if (status) {
        t.displayedAt = Date.now();
        renderChatContextStatus(
          status,
          withChatContextTiming(
            requestContextStatus,
            `Preparation ${seconds(t.contextReadyAt, t.admittedAt)} · First answer ${seconds(t.firstAssistantAt, t.spawnedAt)} · Final display ${seconds(t.displayedAt, t.spawnedAt)} · Total ${seconds(t.displayedAt, t.admittedAt)}`,
          ),
        );
      }
    }
    await options?.onComplete?.(result);
  };
  try {
    const profile = options?.profile || "chat";
    if (!continuingParent)
      startRunProgress(itemID, mode, admissionToken, activeSessionID, {
        quiet: options?.suppressChatMessages,
      });
    renderChatComposerForItem(input, itemID);
    options?.onAdmitted?.();
    if (!preserveComposer) {
      consumed = consumeChatDraft(
        itemID,
        activeSessionID,
        admittedDraft.revision,
      );
      if (consumed) {
        input.value = "";
        resizeChatComposer(input);
        clearReaderActionDraft(itemID);
      }
    }
    renderStreamingIndicator(streamingIndicator, true);
    // Capture one reader before any preparation; the capture validates its parent.
    // The pane records the open PDF when it renders, usually before anything
    // is selected. A typed question with only that record (or none) reads the
    // live selection and page now; captureRequestContext ignores a selection
    // in another PDF. Removed contexts and hidden workflow runs never do.
    const readLiveSelection = shouldReadLiveSelection({
      context,
      visibleChat:
        !options?.suppressChatMessages && !options?.silentUserMessage,
    });
    const reader =
      context?.attachmentID && !readLiveSelection
        ? undefined
        : await ztoolkit.Reader.getReader().catch(() => undefined);
    const executionSettings =
      submission?.request.executionSettings ?? captureExecutionSettings(mode);
    const requestContext =
      submission?.request.requestContext ??
      options?.requestContext ??
      (await captureRequestContext({
        itemID,
        reader,
        attachmentID: context?.attachmentID,
        selectedText: readLiveSelection ? undefined : (context?.text ?? ""),
        annotationIDs: context?.annotationIDs,
        pageIndex: readLiveSelection ? undefined : context?.pageIndex,
        pageLabel: readLiveSelection ? undefined : context?.pageLabel,
      }));
    sourceCapturedAt = Date.now();
    if (isChatPreparationCancelled(itemID)) return;
    if (!options?.silentUserMessage)
      submission ??= createChatDraftSubmission({
        question,
        requestContext,
        executionSettings,
        responseLength: admittedDraft.responseLength,
      });
    const session = options?.silentUserMessage
      ? sessionStore.touch(itemID, mode, itemTitle)
      : await persistChatDraftSubmission({
          itemID,
          mode,
          paperTitle: itemTitle,
          submission: submission!,
        });
    userTurnPersistedAt = Date.now();
    submitted = !options?.silentUserMessage;
    turnId = submitted ? session.lastTurnId : undefined;
    attemptId = submitted ? session.lastAttemptId : undefined;
    if (submitted) {
      chatMessages.querySelector('[data-pp-chat-help="true"]')?.remove();
      addMessage(chatMessages, options?.displayQuestion || question, "user");
    }
    const continuity = sessionHistoryService.getContinuityContext({
      itemID,
      sourceFingerprint: requestContext.contentFingerprint,
    });
    const resumeSessionId =
      profile === "chat"
        ? getVerifiedProviderResume(
            session,
            mode,
            requestContext.sourceID,
            requestContext.contentFingerprint,
          )
        : undefined;
    const continuityMode = resumeSessionId
      ? "Native conversation resume"
      : continuity.text
        ? "Fresh provider conversation with saved context"
        : "Fresh provider conversation; prior context unavailable";
    const status = input
      .closest("#paper-pilot-container")
      ?.querySelector(".pp-chat-context-status");
    requestContextStatus = buildChatContextStatus({
      continuityMode,
      paperTitle: requestContext.paperTitle,
      attachmentKey: requestContext.source.attachmentKey,
      includedTurns: continuity.includedTurns,
      includedPins: continuity.includedPins,
      usedSummary: continuity.usedSummary,
      omitted: continuity.omitted,
      warnings: requestContext.warnings,
    });
    if (status) renderChatContextStatus(status, requestContextStatus);
    if (isChatPreparationCancelled(itemID)) return;
    const common = {
      itemID,
      sessionId: session.sessionId,
      sessionTitle: session.threadTitle,
      paperTitle: itemTitle,
      question,
      selectedText: requestContext.selectedText,
      annotationIDs: context?.annotationIDs,
      requestContext,
      executionSettings,
      responseLength: admittedDraft.responseLength,
      turnId,
      attemptId,
      profile,
      outputSchema: options?.outputSchema,
      chatMessages,
      streamingIndicator,
      suppressChatMessages: options?.suppressChatMessages,
      continuationToken: options?.continuationToken,
      onComplete: complete,
    };
    if (mode === "codex_cli")
      await handleCodexQuestion({
        ...common,
        useResume: Boolean(resumeSessionId),
        resumeSessionId,
      });
    else
      await handleClaudeQuestion({
        ...common,
        resumeSessionId,
      });
  } catch (error) {
    logReaderPaneError("Chat request failed", error);
    if (isChatPreparationCancelled(itemID)) return;
    if (
      consumed &&
      !submitted &&
      restoreChatDraft(itemID, activeSessionID, admittedDraft, submission) &&
      sessionStore.get(itemID)?.sessionId === activeSessionID
    ) {
      input.value = getChatDraft(itemID, activeSessionID).text;
      resizeChatComposer(input);
    }
    const state = failRunProgress({
      itemID,
      engine: mode,
      token: admissionToken,
      source: "request",
      rawError: error instanceof Error ? error.message : String(error),
      canRetry: false,
    });
    const assistantText =
      state?.failure?.userMessage ||
      "The request could not start. Your question is available to edit or send again.";
    if (submitted && turnId && attemptId)
      await sessionHistoryService.updateAttempt({
        itemID,
        paperTitle: itemTitle,
        turnId,
        attemptId,
        state: "failed",
        errorCategory: "preparation",
      });
    if (!options?.suppressChatMessages)
      showComposerNotice(input, assistantText, { sticky: true });
    await complete({ success: false, assistantText });
  } finally {
    try {
      if (isChatPreparationCancelled(itemID)) {
        if (
          consumed &&
          !submitted &&
          restoreChatDraft(
            itemID,
            activeSessionID,
            admittedDraft,
            submission,
          ) &&
          sessionStore.get(itemID)?.sessionId === activeSessionID
        ) {
          input.value = getChatDraft(itemID, activeSessionID).text;
          resizeChatComposer(input);
        }
        if (submitted && turnId && attemptId)
          await sessionHistoryService.updateAttempt({
            itemID,
            paperTitle: itemTitle,
            turnId,
            attemptId,
            state: "cancelled",
          });
        advanceRunProgress(itemID, admissionToken, {
          type: "cancelled",
          canRetry: false,
        });
        await complete({
          success: false,
          assistantText: "Request cancelled before model execution.",
        });
      }
    } finally {
      releaseChatEngineRequest(itemID, admissionToken);
      renderStreamingIndicator(
        streamingIndicator,
        Boolean(getActiveReaderRunMode(itemID)),
      );
      renderChatComposerForItem(input, itemID);
      if (!isReaderChatBusy(itemID)) input.focus();
    }
  }
}

// A finished run's card belongs to the session that ran it.
function getVisibleRunProgressState(itemID: number) {
  const state = getRunProgressState(itemID);
  return isRunProgressVisibleInSession(
    state,
    sessionStore.get(itemID)?.sessionId,
  )
    ? state
    : undefined;
}

function getComposerRunFlags(itemID: number) {
  const pending = getPendingEngineCompletion(itemID);
  return {
    busy: isReaderChatBusy(itemID),
    stopping:
      isChatPreparationCancelled(itemID) || pending?.terminalClaim === "cancel",
    canStop: pending
      ? !pending.terminalClaim
      : isChatEngineRequestPending(itemID),
  };
}

function renderChatComposerForItem(
  input: HTMLTextAreaElement,
  itemID: number,
): void {
  const button = input
    .closest("#paper-pilot-container")
    ?.querySelector<HTMLButtonElement>("#chat-send");
  if (!button) return;
  renderChatComposer({ input, button, ...getComposerRunFlags(itemID) });
}
