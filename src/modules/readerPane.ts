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
import {
  buildCodexRunState,
  clearCodexRunStateForItem,
  getCodexRunStateForItem,
  setCodexRunStateForItem,
} from "./codex/runState";
import { clearCodexPollerForItem } from "./codex/poller";
import { probeWorkspaceWritable } from "./workspace/status";
import { redactPath } from "./workspace/redaction";
import {
  getRecentCodexModels,
  rememberRecentCodexModel,
} from "./codex/modelHistory";
import {
  getGeminiBuiltInModels,
  loadCodexCachedModelCatalog,
  loadCodexCachedModels,
  mergeModelOptions,
  parseAllowedModels,
} from "./codex/modelOptions";
import { getCurrentReaderContext } from "./context/readerContext";
import { messageStore } from "./message/messageStore";
import { sessionStore } from "./session/sessionStore";
import { probeCodexLoginState } from "./codex/status";
import { buildCodexAuthenticateMessage } from "./codex/authAction";
import {
  cancelCodexRun,
  handleCodexQuestion,
  retryLastCodexQuestion,
} from "./codex/controller";
import { handleGeminiQuestion } from "./gemini/controller";
import { shouldEnableAutoHighlight } from "./autoHighlight/status";
import { runAutoHighlightWorkflow } from "./autoHighlight/workflow";
import {
  addRecommendationToCollection,
  buildRecommendationMetadataLine,
  generateRelatedPaperGroups,
  openRecommendedPaper,
  type RecommendationGroup,
  type RecommendedPaper,
} from "./relatedRecommendations";
import { getRelatedRecommendationLayout } from "./relatedRecommendationLayout";
import {
  buildPaperCompareCard,
  getPaperCompareButtonState,
  buildPaperCompareRequestFromRecommendations,
  getPaperCompareWorkflowState,
  parsePaperCompareResponse,
} from "./paperCompare";
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
} from "./comprehensionCheck/prompt";
import {
  getMasteryState,
  setMasteryState,
  clearMasteryState,
  buildInitialMasteryState,
} from "./comprehensionCheck/status";

const CHAT_INPUT_MIN_HEIGHT = 72;
const CHAT_INPUT_MAX_HEIGHT = 180;
const CHAT_RESIZE_MIN_HEIGHT = 280;
const CHAT_RESIZE_MAX_HEIGHT = 1400;
const CHAT_RESIZE_CONTAINER_BUFFER = 340;

function clampChatHeight(value: number) {
  return Math.max(
    CHAT_RESIZE_MIN_HEIGHT,
    Math.min(Math.round(value), CHAT_RESIZE_MAX_HEIGHT),
  );
}

export function setReaderActionDraft(
  draft: typeof addon.data.readerActionDraft,
) {
  addon.data.readerActionDraft = draft;
}

export function clearReaderActionDraft() {
  addon.data.readerActionDraft = undefined;
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
        <div id="paper-pilot-mode">
          <span id="paper-pilot-mode-chip" class="pp-mode-chip"></span>
          <span id="paper-pilot-mode-status" class="pp-mode-status"></span>
          <html:button id="chat-mode-gemini" class="pp-btn pp-btn--ghost">Gemini CLI</html:button>
          <html:button id="chat-mode-codex" class="pp-btn pp-btn--ghost">Codex CLI</html:button>
          <html:button id="chat-mode-reset" class="pp-btn pp-btn--ghost">Use Default</html:button>
        </div>
        <div id="paper-pilot-run-state" class="pp-run-state" style="display: none;"></div>
        <div id="paper-pilot-session-bar">
          <span id="chat-current-document" class="pp-session-doc"></span>
          <span id="chat-auto-highlight-status" class="pp-session-status"></span>
          <html:button id="chat-auto-highlight" class="pp-btn pp-btn--secondary">Highlight key passages</html:button>
          <html:button id="chat-new-session" class="pp-btn pp-btn--secondary">New session</html:button>
          <html:button id="chat-related-recommend" class="pp-btn pp-btn--secondary">Recommend related papers</html:button>
          <html:button id="chat-paper-mastery" class="pp-btn pp-btn--secondary">Paper Mastery</html:button>
        </div>
        <div class="pp-section" id="paper-pilot-workbench-section">
          <div class="pp-section__header" id="paper-pilot-workbench-toggle">
            <span class="pp-section__toggle">▼</span>
            <span>Paper workbench</span>
          </div>
          <div class="pp-section__body">
            <div id="chat-paper-workbench">
              <html:button id="chat-research-brief" class="pp-btn pp-btn--secondary">Research brief</html:button>
              <html:button id="chat-tool-compare" class="pp-btn pp-btn--secondary">Compare</html:button>
              <html:button id="chat-tool-contributions" class="pp-btn pp-btn--secondary">Contributions</html:button>
              <html:button id="chat-tool-limitations" class="pp-btn pp-btn--secondary">Limitations</html:button>
              <html:button id="chat-tool-followups" class="pp-btn pp-btn--secondary">Follow-ups</html:button>
              <html:button id="chat-tool-save-note" class="pp-btn pp-btn--ghost">Save latest to note</html:button>
              <html:button id="chat-tool-save-collection" class="pp-btn pp-btn--ghost">Save for collection</html:button>
              <html:button id="chat-tool-clear" class="pp-btn pp-btn--ghost">Clear cards</html:button>
            </div>
          </div>
        </div>
        <div id="chat-compare-helper" class="pp-compare-helper pp-compare-helper--default"></div>
        <div id="chat-paper-tool-status" class="pp-status-text" style="display: none;"></div>
        <div id="chat-paper-tool-cards" class="pp-tool-cards" style="display: none;"></div>
        <div id="chat-related-status" class="pp-status-text" style="display: none;"></div>
        <div id="chat-related-groups" style="display: none;"></div>
        <div class="pp-section" id="paper-pilot-engine-section" style="display: none;">
          <div class="pp-section__header" id="paper-pilot-engine-toggle">
            <span class="pp-section__toggle">▼</span>
            <span>Engine settings</span>
          </div>
          <div class="pp-section__body">
            <div id="paper-pilot-codex-actions" class="pp-codex-actions" style="display: none;">
              <html:button id="chat-codex-auth" class="pp-btn pp-btn--secondary">Authenticate Codex</html:button>
              <html:button id="chat-codex-device-auth" class="pp-btn pp-btn--secondary">Use device auth</html:button>
              <html:button id="chat-codex-recheck" class="pp-btn pp-btn--secondary">Re-check status</html:button>
              <html:button id="chat-codex-retry" class="pp-btn pp-btn--secondary">Retry Last</html:button>
              <html:button id="chat-codex-cancel" class="pp-btn pp-btn--secondary">Cancel Run</html:button>
            </div>
            <div id="paper-pilot-policy-warning" class="pp-status-card pp-status-card--warning" style="display: none;"></div>
            <div id="paper-pilot-gemini-fallback" class="pp-status-card pp-status-card--success" style="display: none;"></div>
            <div id="paper-pilot-gemini-embed" class="pp-status-card pp-status-card--embed" style="display: none;"></div>
            <div id="paper-pilot-model-row" class="pp-model-row" style="display: none;">
              <html:label for="chat-codex-model">Model</html:label>
              <html:select id="chat-codex-model"></html:select>
              <html:button id="chat-codex-model-save" class="pp-btn pp-btn--primary">Save Model</html:button>
            </div>
            <div id="paper-pilot-codex-options" class="pp-codex-options" style="display: none;">
              <html:label for="chat-codex-web-search">
                <html:input type="checkbox" id="chat-codex-web-search" />
                <span>Allow web search when needed</span>
              </html:label>
            </div>
            <div id="paper-pilot-model-history" class="pp-model-history" style="display: none;"></div>
          </div>
        </div>
        <div id="paper-pilot-draft" class="pp-status-card pp-status-card--draft" style="display: none;"></div>
        <div class="pp-section" id="paper-pilot-mastery-section" style="display: none;">
          <div class="pp-section__header" id="paper-pilot-mastery-toggle">
            <span class="pp-section__toggle">▼</span>
            <span>Paper Mastery</span>
          </div>
          <div class="pp-section__body">
            <div class="pp-mastery-topic-card">
              <div id="paper-mastery-status" class="pp-mastery-status"></div>
              <div id="paper-mastery-progress" class="pp-mastery-progress"></div>
            </div>
            <div id="paper-mastery-question" class="pp-mastery-question" style="display: none;"></div>
            <div id="paper-mastery-feedback" class="pp-mastery-feedback" style="display: none;"></div>
            <div id="paper-mastery-report" class="pp-mastery-report" style="display: none;"></div>
            <html:textarea id="paper-mastery-answer" class="pp-mastery-answer" placeholder="Type your answer here..." style="display: none;" />
            <div id="paper-mastery-actions" class="pp-mastery-actions" style="display: none;">
              <html:button id="paper-mastery-submit" class="pp-btn pp-btn--primary">Submit Answer</html:button>
              <html:button id="paper-mastery-end" class="pp-btn pp-btn--ghost">End Session</html:button>
            </div>
          </div>
        </div>
        <div id="chat-streaming-indicator" class="pp-streaming" style="display: none;">
          <span class="pp-streaming-dot"></span>
          <span class="pp-streaming-dot"></span>
          <span class="pp-streaming-dot"></span>
          <span class="pp-streaming-text">Thinking…</span>
        </div>
        <div id="chat-messages"></div>
        <div id="chat-resize-handle" title="Drag to resize chat">
          <div class="pp-resize-grip"></div>
        </div>
        <div id="chat-input-shell">
          <html:textarea id="chat-input" placeholder="Ask a question about this paper or the current selection."/>
        </div>
      </div>
    `,
    onRender: async ({ body, item, setSectionSummary }) => {
      const chatContainer = body.querySelector(
        "#paper-pilot-container",
      ) as HTMLElement;
      const input = body.querySelector("#chat-input") as HTMLTextAreaElement;
      const chatMessages = body.querySelector("#chat-messages") as HTMLElement;
      const chatResizeHandle = body.querySelector(
        "#chat-resize-handle",
      ) as HTMLElement;
      const draftCard = body.querySelector("#paper-pilot-draft") as HTMLElement;
      const streamingIndicator = body.querySelector(
        "#chat-streaming-indicator",
      ) as HTMLElement;
      const modeChip = body.querySelector(
        "#paper-pilot-mode-chip",
      ) as HTMLElement;
      const modeStatus = body.querySelector(
        "#paper-pilot-mode-status",
      ) as HTMLElement;
      const modeGeminiButton = body.querySelector(
        "#chat-mode-gemini",
      ) as HTMLButtonElement;
      const modeCodexButton = body.querySelector(
        "#chat-mode-codex",
      ) as HTMLButtonElement;
      const modeResetButton = body.querySelector(
        "#chat-mode-reset",
      ) as HTMLButtonElement;
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
      const newSessionButton = body.querySelector(
        "#chat-new-session",
      ) as HTMLButtonElement;
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
      const codexActions = body.querySelector(
        "#paper-pilot-codex-actions",
      ) as HTMLElement;
      const codexAuthButton = body.querySelector(
        "#chat-codex-auth",
      ) as HTMLButtonElement;
      const codexDeviceAuthButton = body.querySelector(
        "#chat-codex-device-auth",
      ) as HTMLButtonElement;
      const codexRecheckButton = body.querySelector(
        "#chat-codex-recheck",
      ) as HTMLButtonElement;
      const codexRetryButton = body.querySelector(
        "#chat-codex-retry",
      ) as HTMLButtonElement;
      const codexCancelButton = body.querySelector(
        "#chat-codex-cancel",
      ) as HTMLButtonElement;
      const policyWarning = body.querySelector(
        "#paper-pilot-policy-warning",
      ) as HTMLElement;
      const geminiFallbackCard = body.querySelector(
        "#paper-pilot-gemini-fallback",
      ) as HTMLElement;
      const geminiEmbedCard = body.querySelector(
        "#paper-pilot-gemini-embed",
      ) as HTMLElement;
      const modelRow = body.querySelector(
        "#paper-pilot-model-row",
      ) as HTMLElement;
      const modelInput = body.querySelector(
        "#chat-codex-model",
      ) as HTMLSelectElement;
      const modelSaveButton = body.querySelector(
        "#chat-codex-model-save",
      ) as HTMLButtonElement;
      const codexOptionsRow = body.querySelector(
        "#paper-pilot-codex-options",
      ) as HTMLElement;
      const codexWebSearchToggle = body.querySelector(
        "#chat-codex-web-search",
      ) as HTMLInputElement;
      const modelHistory = body.querySelector(
        "#paper-pilot-model-history",
      ) as HTMLElement;

      const masterySection = body.querySelector(
        "#paper-pilot-mastery-section",
      ) as HTMLElement | null;
      const masteryToggle = body.querySelector(
        "#paper-pilot-mastery-toggle",
      ) as HTMLElement | null;
      const masteryStatus = body.querySelector(
        "#paper-mastery-status",
      ) as HTMLElement | null;
      const masteryProgress = body.querySelector(
        "#paper-mastery-progress",
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

      if (
        chatContainer &&
        input &&
        chatMessages &&
        draftCard &&
        streamingIndicator &&
        modeChip &&
        modeStatus &&
        modeGeminiButton &&
        modeCodexButton &&
        modeResetButton &&
        runStateCard &&
        currentDocumentLabel &&
        autoHighlightStatus &&
        autoHighlightButton &&
        newSessionButton &&
        relatedRecommendButton &&
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
        const cleanup = adjustContainerHeight(
          chatContainer,
          input,
          chatResizeHandle,
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
        renderRelatedRecommendationState(
          relatedRecommendButton,
          relatedStatus,
          relatedGroups,
          compareButton,
          compareHelper,
          item.id,
          String(item.getField("title") || ""),
        );

        const workbenchToggle = body.querySelector(
          "#paper-pilot-workbench-toggle",
        ) as HTMLElement;
        const workbenchSection = body.querySelector(
          "#paper-pilot-workbench-section",
        ) as HTMLElement;
        if (workbenchToggle && workbenchSection) {
          workbenchToggle.addEventListener("click", () => {
            workbenchSection.classList.toggle("pp-section--collapsed");
          });
        }

        const engineToggle = body.querySelector(
          "#paper-pilot-engine-toggle",
        ) as HTMLElement;
        const engineSection = body.querySelector(
          "#paper-pilot-engine-section",
        ) as HTMLElement;
        if (engineToggle && engineSection) {
          engineToggle.addEventListener("click", () => {
            engineSection.classList.toggle("pp-section--collapsed");
          });
        }

        modeGeminiButton.addEventListener("click", async () => {
          clearCodexPollerForItem(item.id);
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

        modeCodexButton.addEventListener("click", async () => {
          clearCodexPollerForItem(item.id);
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
          clearCodexPollerForItem(item.id);
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
        });

        relatedRecommendButton.addEventListener("click", async () => {
          addon.data.relatedRecommendationStates?.set(item.id, {
            running: true,
            status: "Finding related papers…",
            groups: getRelatedRecommendationState(item.id).groups,
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
          try {
            const result = await generateRelatedPaperGroups({
              itemID: item.id,
              itemTitle: item.getField("title"),
              onStatus: (status) => {
                const state = getRelatedRecommendationState(item.id);
                addon.data.relatedRecommendationStates?.set(item.id, {
                  ...state,
                  running: true,
                  status,
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
              },
            });
            addon.data.relatedRecommendationStates?.set(item.id, {
              running: false,
              status: `Found ${result.groups.reduce((count, group) => count + group.papers.length, 0)} recommendations`,
              groups: result.groups,
            });
          } catch (error) {
            addon.data.relatedRecommendationStates?.set(item.id, {
              running: false,
              status:
                error instanceof Error
                  ? error.message
                  : "Related paper recommendation failed.",
              groups: [],
            });
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
        });

        // --- Paper Mastery handlers ---
        const masteryActionsDiv = body.querySelector(
          "#paper-mastery-actions",
        ) as HTMLElement | null;

        let selectedHistoryDot: number = -1;

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
          const topicLabel = state.topics[roundIndex]?.topic ?? "general";
          let content = `📋 **Viewing Round ${roundIndex + 1}** — ${topicLabel}\n\n`;
          content += `**Q:** ${r.question}\n\n`;
          content += `**Your answer:** ${r.userAnswer}\n\n`;
          content += `---\n\n`;
          content += `**Feedback:** ${r.evaluation}`;
          if (!r.understood && r.explanation) {
            content += `\n\n📚 ${r.explanation}`;
          }
          masteryFeedback.className =
            "pp-mastery-feedback pp-mastery-feedback--history";
          masteryFeedback.replaceChildren(
            renderMarkdownFragment(content, masteryFeedback.ownerDocument!),
          );
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
            const current = body.ownerDocument.createElement("span");
            current.className =
              "pp-mastery-progress-dot pp-mastery-progress-dot--current";
            current.title = "Current round";
            masteryProgress.appendChild(current);
          }
        }

        function showMasteryQuestion(question: string) {
          clearHistoryDotSelection();
          if (masteryQuestion) {
            masteryQuestion.replaceChildren(
              renderMarkdownFragment(question, masteryQuestion.ownerDocument!),
            );
            masteryQuestion.style.display = "";
          }
          if (masteryAnswer) {
            masteryAnswer.style.display = "";
            masteryAnswer.value = "";
            masteryAnswer.focus();
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
          let content = evaluation;
          if (!understood && explanation) {
            content += `\n\n📚 ${explanation}`;
          }
          masteryFeedback.replaceChildren(
            renderMarkdownFragment(content, masteryFeedback.ownerDocument!),
          );
          masteryFeedback.style.display = "";
        }

        function showMasteryCompletion(
          state: import("./comprehensionCheck/types").ComprehensionCheckState,
        ) {
          const understood = state.rounds.filter((r) => r.understood).length;
          const total = state.rounds.length;
          const score =
            total > 0 ? Math.round((understood / total) * 100) : 0;
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
          if (masteryActionsDiv) {
            masteryActionsDiv.style.display = "none";
          }
          if (masteryStatus) {
            masteryStatus.textContent = "Complete";
          }
          if (masteryReport) {
            masteryReport.textContent = "Generating final report...";
            masteryReport.style.display = "";
            sendMasteryPrompt(
              buildFinalReportPrompt(state.rounds, state.topics),
              (assistantText) => {
                const s = getMasteryState(item.id);
                if (s) {
                  s.running = false;
                  setMasteryState(item.id, s);
                }
                masteryReport.replaceChildren(
                  renderMarkdownFragment(
                    assistantText,
                    masteryReport.ownerDocument!,
                  ),
                );
              },
              () => {
                const s = getMasteryState(item.id);
                if (s) {
                  s.running = false;
                  setMasteryState(item.id, s);
                }
                masteryReport.textContent =
                  "Could not generate final report.";
              },
            );
          }
        }

        async function sendMasteryPrompt(
          prompt: string,
          onSuccess: (assistantText: string) => void,
          onFailure?: () => void,
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
                onComplete: (result) => {
                  if (result.success) {
                    onSuccess(result.assistantText);
                  } else {
                    onFailure?.();
                  }
                },
              },
            );
          } catch {
            onFailure?.();
          } finally {
            input.value = savedInput;
            input.disabled = false;
          }
        }

        paperMasteryBtn?.addEventListener("click", async () => {
          if (!masterySection) {
            return;
          }
          if (getMasteryState(item.id)?.running) {
            return;
          }
          masterySection.style.display = "";
          const state = buildInitialMasteryState();
          state.phase = "generating-question";
          state.running = true;
          state.status = "Generating first question...";
          setMasteryState(item.id, state);
          if (masteryStatus) {
            masteryStatus.textContent = state.status;
          }
          updateMasteryProgressDots(state);

          const resetOnFail = () => {
            const fs = getMasteryState(item.id);
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
              const s =
                getMasteryState(item.id) ?? buildInitialMasteryState();
              s.phase = "awaiting-answer";
              s.currentQuestion = parsed.question;
              s.status = `Topic: ${parsed.topic} (${parsed.difficulty})`;
              s.topics.push({
                topic: parsed.topic,
                understood: false,
                confidence: 0,
              });
              setMasteryState(item.id, s);
              if (masteryStatus) {
                masteryStatus.textContent = s.status;
              }
              showMasteryQuestion(parsed.question);
              updateMasteryProgressDots(s);
            },
            resetOnFail,
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

          state.phase = "evaluating";
          state.running = true;
          state.status = "Evaluating your answer...";
          setMasteryState(item.id, state);
          if (masteryStatus) {
            masteryStatus.textContent = state.status;
          }
          if (masterySubmit) {
            masterySubmit.disabled = true;
          }

          const question = state.currentQuestion;
          const resetSubmitOnFail = () => {
            const fs = getMasteryState(item.id);
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
            async (assistantText) => {
              const evalResult =
                parseMasteryEvaluationResponse(assistantText);
              if (!evalResult) {
                resetSubmitOnFail();
                return;
              }

              const s = getMasteryState(item.id) ?? state;
              s.rounds.push({
                question,
                userAnswer: answer,
                evaluation: evalResult.evaluation,
                understood: evalResult.understood,
                explanation: evalResult.explanation,
              });
              if (s.topics.length > 0) {
                const last = s.topics[s.topics.length - 1];
                last.understood = evalResult.understood;
                last.confidence = evalResult.confidence;
              }
              showMasteryFeedback(
                evalResult.evaluation,
                evalResult.understood,
                evalResult.understood ? undefined : evalResult.explanation,
              );
              updateMasteryProgressDots(s);

              const MIN_ROUNDS = 3;
              const MAX_ROUNDS = 30;
              if (
                (!evalResult.nextTopic && s.rounds.length >= MIN_ROUNDS) ||
                s.rounds.length >= MAX_ROUNDS
              ) {
                s.phase = "complete";
                setMasteryState(item.id, s);
                showMasteryCompletion(s);
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
                (nextText) => {
                  const parsed = parseMasteryQuestionResponse(nextText);
                  if (!parsed) {
                    const fst = getMasteryState(item.id);
                    if (fst) {
                      fst.phase = "complete";
                      setMasteryState(item.id, fst);
                    }
                    showMasteryCompletion(fst ?? s);
                    return;
                  }
                  const st = getMasteryState(item.id) ?? s;
                  st.phase = "awaiting-answer";
                  st.currentQuestion = parsed.question;
                  st.status = `Topic: ${parsed.topic} (${parsed.difficulty})`;
                  st.topics.push({
                    topic: parsed.topic,
                    understood: false,
                    confidence: 0,
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
                  const fst = getMasteryState(item.id);
                  if (fst) {
                    fst.phase = "complete";
                    setMasteryState(item.id, fst);
                  }
                  showMasteryCompletion(fst ?? s);
                },
              );
            },
            resetSubmitOnFail,
          );
        });

        masteryEnd?.addEventListener("click", () => {
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
            state.phase = "complete";
            setMasteryState(item.id, state);
            showMasteryCompletion(state);
          } else {
            if (masterySection) {
              masterySection.style.display = "none";
            }
            clearMasteryState(item.id);
          }
        });

        masteryToggle?.addEventListener("click", () => {
          masterySection?.classList.toggle("pp-section--collapsed");
        });

        newSessionButton.addEventListener("click", async () => {
          const mode = getModeForItem(item.id);
          const currentSession = sessionStore.getOrCreate(
            item.id,
            mode,
            item.getField("title"),
          );
          messageStore.clear(currentSession.sessionId);
          clearCodexPollerForItem(item.id);
          sessionStore.reset(item.id, mode);
          clearCodexRunStateForItem(item.id);
          clearReaderActionDraft();
          setPaperArtifactState(item.id, {
            running: false,
            status: "",
            cards: [],
          });
          input.value = "";
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

        codexRetryButton.addEventListener("click", async () => {
          await retryLastCodexQuestion({
            itemID: item.id,
            chatMessages,
            streamingIndicator,
          });
        });

        codexCancelButton.addEventListener("click", async () => {
          await cancelCodexRun({
            itemID: item.id,
            chatMessages,
          });
          renderStreamingIndicator(streamingIndicator, false);
        });

        modelSaveButton.addEventListener("click", async () => {
          if (!modelInput.value.trim()) {
            return;
          }
          const [savedModel, savedReasoningEffort] =
            modelInput.value.split("|");
          if (getCurrentProviderDescriptor(item.id).mode === "gemini_cli") {
            setPref("geminiDefaultModel", savedModel);
          } else {
            setPref("codexDefaultModel", savedModel);
            setPref("codexReasoningEffort", savedReasoningEffort || "medium");
          }
          rememberRecentCodexModel(savedModel);
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

        input.addEventListener("keydown", async (e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
            e.preventDefault();
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
            renderDraftCard(draftCard);
          }
        });

        addon.data.applyReaderActionToPane = async () => {
          const pending = addon.data.pendingReaderAction;
          if (!pending) {
            return;
          }

          input.value = pending.question;
          renderDraftCard(draftCard);
          input.focus();

          if (pending.autoSubmit) {
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
            renderDraftCard(draftCard);
          }

          addon.data.pendingReaderAction = undefined;
        };
        void addon.data.applyReaderActionToPane();

        return () => {
          if (addon.data.applyReaderActionToPane) {
            addon.data.applyReaderActionToPane = undefined;
          }
          cleanup();
        };
      }
    },
  });

  if (result) {
    addon.data.aiReaderPaneRegistered = true;
  }
}

function renderDraftCard(draftCard: HTMLElement) {
  const draft = addon.data.readerActionDraft;
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
  renderModeHeader(
    params.modeChip,
    params.modeStatus,
    descriptor.label,
    descriptor.status,
  );
  renderRunStateCard(
    params.runStateCard,
    descriptor.mode,
    params.itemID,
    params.itemTitle,
    "not_checked",
  );
  renderCodexActions(params.codexActions, descriptor.mode);
  const engineSection = params.codexActions.closest(
    "#paper-pilot-engine-section",
  ) as HTMLElement | null;
  if (engineSection) {
    engineSection.style.display =
      descriptor.mode === "codex_cli" || descriptor.mode === "gemini_cli"
        ? ""
        : "none";
  }
  renderPolicyWarning(params.policyWarning, descriptor.mode);
  renderGeminiFallbackCard(params.geminiFallbackCard, descriptor.mode);
  renderGeminiEmbedCard(params.geminiEmbedCard, descriptor.mode);
  renderModelRow(params.modelRow, params.modelInput, descriptor.mode);
  renderCodexOptionsRow(
    params.codexOptionsRow,
    params.codexWebSearchToggle,
    descriptor.mode,
  );
  await renderModelHistory(
    params.modelHistory,
    params.modelInput,
    descriptor.mode,
  );
  renderMessageHistory(
    params.chatMessages,
    session.sessionId,
    descriptor.placeholderResponse,
  );
  renderDraftCard(params.draftCard);
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
    );
  }
}

function renderModeHeader(
  chip: HTMLElement,
  status: HTMLElement,
  label: string,
  providerStatus: string,
) {
  chip.textContent = label;
  status.textContent = `Status: ${getStatusLabel(providerStatus)}`;
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
    cardsElement.appendChild(buildPaperArtifactCardElement(doc, card));
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

function buildPaperArtifactCardElement(doc: Document, card: PaperArtifactCard) {
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
      bullet.textContent = item;
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
  return (
    addon.data.relatedRecommendationStates?.get(itemID) || {
      running: false,
      status: "",
      groups: [],
    }
  );
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
  button.disabled = state.running;
  button.textContent = state.running
    ? "Recommending…"
    : state.groups.length
      ? "Refresh related papers"
      : "Recommend related papers";

  status.style.display = state.status ? "block" : "none";
  status.textContent = state.status;

  groupsContainer.replaceChildren();
  if (!state.groups.length) {
    groupsContainer.style.display = "none";
    renderCompareButtonState(compareButton, itemID, currentPaperTitle);
    renderCompareHelperState(compareHelper, itemID, currentPaperTitle);
    return;
  }

  const doc = groupsContainer.ownerDocument;
  groupsContainer.style.display = "block";
  renderCompareButtonState(compareButton, itemID, currentPaperTitle);
  renderCompareHelperState(compareHelper, itemID, currentPaperTitle);

  for (const group of state.groups) {
    const section = doc.createElement("div");
    section.style.borderTop = "1px solid var(--pp-border-recommendation)";

    const header = doc.createElement("div");
    header.textContent = group.category;
    header.className = "pp-recommendation-group__header";
    section.appendChild(header);

    for (const paper of group.papers) {
      section.appendChild(buildRecommendationRow(doc, itemID, paper));
    }

    groupsContainer.appendChild(section);
  }
}

function buildRecommendationRow(
  doc: Document,
  sourceItemID: number,
  paper: RecommendedPaper,
) {
  const row = doc.createElement("div");
  row.setAttribute("role", "group");
  row.className = "pp-recommendation-row";

  const info = doc.createElement("div");
  info.className = "pp-recommendation-row__info";

  const title = doc.createElement("button");
  title.type = "button";
  title.textContent = paper.title;
  title.className = "pp-recommendation-row__title";
  title.addEventListener("click", () => {
    void openRecommendedPaper(paper).catch((error) => {
      const message =
        error instanceof Error
          ? error.message
          : "Could not open recommendation.";
      const state = getRelatedRecommendationState(sourceItemID);
      addon.data.relatedRecommendationStates?.set(sourceItemID, {
        ...state,
        status: message,
      });
      renderRelatedRecommendationState(
        row.ownerDocument.querySelector(
          "#chat-related-recommend",
        ) as HTMLButtonElement,
        row.ownerDocument.querySelector("#chat-related-status") as HTMLElement,
        row.ownerDocument.querySelector("#chat-related-groups") as HTMLElement,
        row.ownerDocument.querySelector(
          "#chat-tool-compare",
        ) as HTMLButtonElement,
        row.ownerDocument.querySelector("#chat-compare-helper") as HTMLElement,
        sourceItemID,
      );
    });
  });
  info.appendChild(title);

  const meta = doc.createElement("div");
  meta.textContent = buildRecommendationMetadataLine(paper);
  meta.className = "pp-recommendation-row__meta";
  info.appendChild(meta);

  if (paper.reason) {
    const reason = doc.createElement("div");
    reason.textContent = paper.reason;
    reason.className = "pp-recommendation-row__reason";
    info.appendChild(reason);
  }

  const actions = doc.createElement("div");
  actions.className = "pp-recommendation-row__actions";

  if (paper.existingItemID) {
    const chip = doc.createElement("span");
    chip.textContent = "In library";
    chip.className = "pp-chip pp-chip--library";
    actions.appendChild(chip);
  }

  const openButton = doc.createElement("button");
  openButton.className = "pp-btn pp-btn--ghost";
  openButton.textContent = "Open";
  openButton.addEventListener("click", () => void openRecommendedPaper(paper));
  actions.appendChild(openButton);

  const addButton = doc.createElement("button");
  addButton.className = "pp-btn pp-btn--secondary";
  addButton.textContent = "Add to collection";
  addButton.addEventListener("click", async () => {
    addButton.disabled = true;
    try {
      const result = await addRecommendationToCollection({
        sourceItemID,
        paper,
      });
      const state = getRelatedRecommendationState(sourceItemID);
      const groups = state.groups.map((group: RecommendationGroup) => ({
        ...group,
        papers: group.papers.map((entry) =>
          entry.title === paper.title && entry.doi === paper.doi
            ? { ...entry, existingItemID: result.itemID }
            : entry,
        ),
      }));
      addon.data.relatedRecommendationStates?.set(sourceItemID, {
        running: false,
        status: "Added to collection",
        groups,
      });
    } catch (error) {
      const state = getRelatedRecommendationState(sourceItemID);
      addon.data.relatedRecommendationStates?.set(sourceItemID, {
        ...state,
        status:
          error instanceof Error ? error.message : "Add to collection failed.",
      });
    } finally {
      renderRelatedRecommendationState(
        row.ownerDocument.querySelector(
          "#chat-related-recommend",
        ) as HTMLButtonElement,
        row.ownerDocument.querySelector("#chat-related-status") as HTMLElement,
        row.ownerDocument.querySelector("#chat-related-groups") as HTMLElement,
        row.ownerDocument.querySelector(
          "#chat-tool-compare",
        ) as HTMLButtonElement,
        row.ownerDocument.querySelector("#chat-compare-helper") as HTMLElement,
        sourceItemID,
      );
      addButton.disabled = false;
    }
  });
  actions.appendChild(addButton);

  row.append(info, actions);
  return row;
}

async function refreshCodexStatus(
  chip: HTMLElement,
  status: HTMLElement,
  setSectionSummary: (summary: string) => void,
  runStateCard: HTMLElement,
  itemID: number,
  itemTitle: string,
) {
  try {
    status.textContent = "Status: checking";
    const loginState = await probeCodexLoginState();
    const workspaceRoot = String(
      getPref("codexWorkspaceRoot") || "/tmp/zotero-paper-ai",
    );
    const workspaceWritable = await probeWorkspaceWritable(workspaceRoot);
    chip.textContent = "Codex CLI";
    status.textContent = `Status: ${getStatusLabel(loginState)}${workspaceWritable ? "" : " · workspace not writable"}`;
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
    chip.textContent = "Codex CLI";
    status.textContent = "Status: Error";
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
  if (mode !== "codex_cli") {
    runStateCard.style.display = "none";
    runStateCard.textContent = "";
    return;
  }

  const state = buildCodexRunState({
    itemID,
    title: itemTitle,
    loginState,
    workspaceWritable,
  });
  const persistedState = getCodexRunStateForItem(itemID);
  if (persistedState?.latestEventType) {
    state.latestEventType = persistedState.latestEventType;
  }

  runStateCard.style.display = "block";
  const workspaceDisplay = getPref("privacyRedactLocalFilePaths")
    ? redactPath(state.workspacePath)
    : state.workspacePath;
  runStateCard.textContent = [
    "Codex Run State",
    `Model: ${state.model}`,
    `Reasoning: ${state.reasoningEffort || "default"}`,
    `Workspace: ${workspaceDisplay}`,
    `Writable: ${state.workspaceWritable ?? "unknown"}`,
    `Web search: ${getPref("codexEnableWebSearch") ? "enabled" : "disabled"}`,
    `Sandbox: ${String(getPref("codexSandboxMode") || "read-only")}`,
    `Approval: ${String(getPref("codexApprovalMode") || "never")}`,
    `Login: ${state.loginState}`,
    `Run status: ${state.runStatus}`,
    `Latest event: ${state.latestEventType}`,
  ].join("\n");
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

function renderModelRow(
  modelRow: HTMLElement,
  modelInput: HTMLSelectElement,
  mode: EngineMode,
) {
  if (mode !== "codex_cli" && mode !== "gemini_cli") {
    modelRow.style.display = "none";
    modelInput.value = "";
    return;
  }

  modelRow.style.display = "flex";
}

function renderCodexOptionsRow(
  codexOptionsRow: HTMLElement,
  codexWebSearchToggle: HTMLInputElement,
  mode: EngineMode,
) {
  if (mode !== "codex_cli") {
    codexOptionsRow.style.display = "none";
    codexWebSearchToggle.checked = false;
    return;
  }

  codexOptionsRow.style.display = "flex";
  codexWebSearchToggle.checked = Boolean(getPref("codexEnableWebSearch"));
}

async function renderModelHistory(
  modelHistory: HTMLElement,
  modelInput: HTMLSelectElement,
  mode: EngineMode,
) {
  if (mode !== "codex_cli" && mode !== "gemini_cli") {
    modelHistory.style.display = "none";
    modelHistory.replaceChildren();
    return;
  }

  const recentModels = getRecentCodexModels();
  const allowedModels = parseAllowedModels(
    String(
      getPref(
        mode === "gemini_cli" ? "geminiAllowedModels" : "codexAllowedModels",
      ) || "",
    ),
  );
  const cachedModels =
    mode === "gemini_cli"
      ? getGeminiBuiltInModels()
      : await loadCodexCachedModels();
  const options = mergeModelOptions(
    recentModels,
    mergeModelOptions(allowedModels, cachedModels),
  );
  if (!options.length) {
    modelHistory.style.display = "none";
    modelHistory.replaceChildren();
    return;
  }

  const currentValue = String(
    getPref(
      mode === "gemini_cli" ? "geminiDefaultModel" : "codexDefaultModel",
    ) || (mode === "gemini_cli" ? "gemini-3.1-pro" : "gpt-5-codex"),
  );
  const currentReasoningEffort = String(
    mode === "gemini_cli" ? "" : getPref("codexReasoningEffort") || "medium",
  );
  const catalog = await loadCodexCachedModelCatalog();
  const optionMap = new Map<string, string>();
  const doc = modelInput.ownerDocument || globalThis.document;

  if (!doc) {
    modelHistory.style.display = "none";
    modelHistory.replaceChildren();
    return;
  }

  for (const model of options) {
    optionMap.set(`${model}|`, model);
  }

  for (const model of mode === "gemini_cli" ? [] : catalog) {
    const efforts = model.reasoningEfforts.length
      ? model.reasoningEfforts
      : [model.defaultReasoningEffort || "medium"];
    for (const effort of efforts) {
      optionMap.set(
        `${model.slug}|${effort}`,
        `${model.displayName} (${effort})`,
      );
    }
  }

  modelInput.replaceChildren(
    ...[...optionMap.entries()].map(([value, label]) => {
      const option = doc.createElement("option");
      option.value = value;
      option.textContent = label;
      const currentKey =
        mode === "gemini_cli"
          ? `${currentValue}|`
          : `${currentValue}|${currentReasoningEffort}`;
      if (value === currentKey) {
        option.selected = true;
      }
      return option;
    }),
  );

  const fallbackKey =
    mode === "gemini_cli"
      ? `${currentValue}|`
      : `${currentValue}|${currentReasoningEffort}`;
  if (!optionMap.has(fallbackKey)) {
    const fallback = doc.createElement("option");
    fallback.value = fallbackKey;
    fallback.textContent =
      mode === "gemini_cli"
        ? currentValue
        : currentReasoningEffort
          ? `${currentValue} (${currentReasoningEffort})`
          : currentValue;
    fallback.selected = true;
    modelInput.appendChild(fallback);
  }

  modelHistory.style.display = "none";
  modelHistory.replaceChildren();
}

function renderHelpState(chatMessages: HTMLElement, response: string) {
  if (chatMessages.childElementCount > 0) {
    return;
  }

  addMessage(chatMessages, response, "ai");
}

function renderMessageHistory(
  chatMessages: HTMLElement,
  sessionId: string,
  placeholderResponse: string,
) {
  const messages = messageStore.list(sessionId);
  if (!messages.length) {
    renderHelpState(chatMessages, placeholderResponse);
    return;
  }

  for (const message of messages) {
    addMessage(
      chatMessages,
      message.status === "error" ? `Error: ${message.text}` : message.text,
      message.role === "assistant" ? "ai" : "user",
    );
  }
}

function renderStreamingIndicator(
  streamingIndicator: HTMLElement,
  visible: boolean,
) {
  streamingIndicator.style.display = visible ? "flex" : "none";
}

function adjustContainerHeight(
  chatContainer: HTMLElement,
  input: HTMLTextAreaElement,
  resizeHandle: HTMLElement,
) {
  const chatMessages = chatContainer.querySelector(
    "#chat-messages",
  ) as HTMLElement;
  const relatedGroups = chatContainer.querySelector(
    "#chat-related-groups",
  ) as HTMLElement | null;
  const hostBody = chatContainer.parentElement as HTMLElement | null;
  const view = chatContainer.ownerDocument.defaultView;
  let manualChatHeight: number | undefined;

  const adjustMessagesHeight = () => {
    if (!chatMessages || !relatedGroups) {
      return;
    }

    const layout = getRelatedRecommendationLayout({
      hasRecommendations:
        relatedGroups.style.display !== "none" &&
        relatedGroups.childElementCount > 0,
      recommendationContentHeight: relatedGroups.scrollHeight,
    });
    const chatHeight = manualChatHeight
      ? clampChatHeight(manualChatHeight)
      : layout.chatMinHeight;
    const containerMinHeight = Math.max(
      layout.containerMinHeight,
      chatHeight + CHAT_RESIZE_CONTAINER_BUFFER,
    );
    chatContainer.style.height = "";
    chatContainer.style.minHeight = `${containerMinHeight}px`;
    chatContainer.style.overflowY = layout.containerOverflow;
    if (hostBody) {
      hostBody.style.minHeight = `${containerMinHeight}px`;
    }
    chatMessages.style.height = "";
    chatMessages.style.minHeight = `${chatHeight}px`;
    chatMessages.style.flex = manualChatHeight
      ? `0 0 ${chatHeight}px`
      : layout.chatFlex;
    relatedGroups.style.maxHeight = layout.groupsMaxHeight;
    relatedGroups.style.overflowY = layout.groupsOverflowY;
    relatedGroups.style.overflowX = "hidden";
  };

  const adjustInputHeight = () => {
    input.style.height = `${CHAT_INPUT_MIN_HEIGHT}px`;
    input.style.height = `${Math.max(
      CHAT_INPUT_MIN_HEIGHT,
      Math.min(input.scrollHeight, CHAT_INPUT_MAX_HEIGHT),
    )}px`;
    input.scrollTop = 0;
    adjustMessagesHeight();
  };

  adjustMessagesHeight();
  adjustInputHeight();

  let dragState:
    | {
        startY: number;
        startHeight: number;
      }
    | undefined;

  const handleMouseMove = (event: MouseEvent) => {
    if (!dragState) {
      return;
    }

    manualChatHeight = clampChatHeight(
      dragState.startHeight + (event.clientY - dragState.startY),
    );
    adjustMessagesHeight();
  };

  const stopDragging = () => {
    dragState = undefined;
  };

  const handleMouseDown = (event: MouseEvent) => {
    event.preventDefault();
    dragState = {
      startY: event.clientY,
      startHeight: clampChatHeight(chatMessages.getBoundingClientRect().height),
    };
  };

  const resizeObserver =
    typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(() => adjustMessagesHeight())
      : undefined;
  resizeObserver?.observe(chatContainer);
  if (relatedGroups) {
    resizeObserver?.observe(relatedGroups);
  }

  const mutationObserver =
    relatedGroups && typeof MutationObserver !== "undefined"
      ? new MutationObserver(() => adjustMessagesHeight())
      : undefined;
  if (mutationObserver && relatedGroups) {
    mutationObserver.observe(relatedGroups, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["style"],
    });
  }

  view?.addEventListener("resize", adjustMessagesHeight);
  view?.addEventListener("mousemove", handleMouseMove);
  view?.addEventListener("mouseup", stopDragging);
  input.addEventListener("input", adjustInputHeight);
  resizeHandle.addEventListener("mousedown", handleMouseDown);

  return () => {
    resizeObserver?.disconnect();
    mutationObserver?.disconnect();
    view?.removeEventListener("resize", adjustMessagesHeight);
    view?.removeEventListener("mousemove", handleMouseMove);
    view?.removeEventListener("mouseup", stopDragging);
    input.removeEventListener("input", adjustInputHeight);
    resizeHandle.removeEventListener("mousedown", handleMouseDown);
  };
}

async function runPaperArtifactRequest(params: {
  item: Zotero.Item;
  kind: PaperArtifactKind;
  input: HTMLTextAreaElement;
  chatMessages: HTMLElement;
  streamingIndicator: HTMLElement;
  statusElement: HTMLElement;
  cardsElement: HTMLElement;
}) {
  const request = buildPaperArtifactRequest(params.item, params.kind);
  const existing = getPaperArtifactState(params.item.id);
  setPaperArtifactState(params.item.id, {
    running: true,
    status: `Generating ${request.label.toLowerCase()}…`,
    activeKind: params.kind,
    cards: existing.cards,
  });

  renderPaperArtifactState(
    params.statusElement.ownerDocument.querySelector(
      "#chat-research-brief",
    ) as HTMLButtonElement,
    params.statusElement.ownerDocument.querySelector(
      "#chat-tool-contributions",
    ) as HTMLButtonElement,
    params.statusElement.ownerDocument.querySelector(
      "#chat-tool-limitations",
    ) as HTMLButtonElement,
    params.statusElement.ownerDocument.querySelector(
      "#chat-tool-followups",
    ) as HTMLButtonElement,
    params.statusElement.ownerDocument.querySelector(
      "#chat-tool-save-note",
    ) as HTMLButtonElement,
    params.statusElement.ownerDocument.querySelector(
      "#chat-tool-save-collection",
    ) as HTMLButtonElement,
    params.statusElement.ownerDocument.querySelector(
      "#chat-tool-clear",
    ) as HTMLButtonElement,
    params.statusElement,
    params.cardsElement,
    params.item.id,
  );

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
      onComplete: ({ success, assistantText }) => {
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

        renderPaperArtifactState(
          params.statusElement.ownerDocument.querySelector(
            "#chat-research-brief",
          ) as HTMLButtonElement,
          params.statusElement.ownerDocument.querySelector(
            "#chat-tool-contributions",
          ) as HTMLButtonElement,
          params.statusElement.ownerDocument.querySelector(
            "#chat-tool-limitations",
          ) as HTMLButtonElement,
          params.statusElement.ownerDocument.querySelector(
            "#chat-tool-followups",
          ) as HTMLButtonElement,
          params.statusElement.ownerDocument.querySelector(
            "#chat-tool-save-note",
          ) as HTMLButtonElement,
          params.statusElement.ownerDocument.querySelector(
            "#chat-tool-save-collection",
          ) as HTMLButtonElement,
          params.statusElement.ownerDocument.querySelector(
            "#chat-tool-clear",
          ) as HTMLButtonElement,
          params.statusElement,
          params.cardsElement,
          params.item.id,
        );
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
    renderPaperArtifactState(
      params.statusElement.ownerDocument.querySelector(
        "#chat-research-brief",
      ) as HTMLButtonElement,
      params.statusElement.ownerDocument.querySelector(
        "#chat-tool-contributions",
      ) as HTMLButtonElement,
      params.statusElement.ownerDocument.querySelector(
        "#chat-tool-limitations",
      ) as HTMLButtonElement,
      params.statusElement.ownerDocument.querySelector(
        "#chat-tool-followups",
      ) as HTMLButtonElement,
      params.statusElement.ownerDocument.querySelector(
        "#chat-tool-save-note",
      ) as HTMLButtonElement,
      params.statusElement.ownerDocument.querySelector(
        "#chat-tool-save-collection",
      ) as HTMLButtonElement,
      params.statusElement.ownerDocument.querySelector(
        "#chat-tool-clear",
      ) as HTMLButtonElement,
      params.statusElement,
      params.cardsElement,
      params.item.id,
    );
    return;
  }

  const existing = getPaperArtifactState(params.item.id);
  params.compareButton.disabled = true;
  setPaperArtifactState(params.item.id, {
    running: true,
    status: "Generating paper comparison…",
    activeKind: "paper-compare",
    cards: existing.cards,
  });
  renderCompareButtonState(params.compareButton, params.item.id, currentTitle);
  renderPaperArtifactState(
    params.statusElement.ownerDocument.querySelector(
      "#chat-research-brief",
    ) as HTMLButtonElement,
    params.statusElement.ownerDocument.querySelector(
      "#chat-tool-contributions",
    ) as HTMLButtonElement,
    params.statusElement.ownerDocument.querySelector(
      "#chat-tool-limitations",
    ) as HTMLButtonElement,
    params.statusElement.ownerDocument.querySelector(
      "#chat-tool-followups",
    ) as HTMLButtonElement,
    params.statusElement.ownerDocument.querySelector(
      "#chat-tool-save-note",
    ) as HTMLButtonElement,
    params.statusElement.ownerDocument.querySelector(
      "#chat-tool-save-collection",
    ) as HTMLButtonElement,
    params.statusElement.ownerDocument.querySelector(
      "#chat-tool-clear",
    ) as HTMLButtonElement,
    params.statusElement,
    params.cardsElement,
    params.item.id,
  );

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
      onComplete: ({ success, assistantText }) => {
        if (!success) {
          setPaperArtifactState(params.item.id, {
            running: false,
            status: `Compare failed: ${assistantText}`,
            cards: getPaperArtifactState(params.item.id).cards,
          });
        } else {
          try {
            const card = buildPaperCompareCard(
              parsePaperCompareResponse(assistantText),
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
        renderPaperArtifactState(
          params.statusElement.ownerDocument.querySelector(
            "#chat-research-brief",
          ) as HTMLButtonElement,
          params.statusElement.ownerDocument.querySelector(
            "#chat-tool-contributions",
          ) as HTMLButtonElement,
          params.statusElement.ownerDocument.querySelector(
            "#chat-tool-limitations",
          ) as HTMLButtonElement,
          params.statusElement.ownerDocument.querySelector(
            "#chat-tool-followups",
          ) as HTMLButtonElement,
          params.statusElement.ownerDocument.querySelector(
            "#chat-tool-save-note",
          ) as HTMLButtonElement,
          params.statusElement.ownerDocument.querySelector(
            "#chat-tool-save-collection",
          ) as HTMLButtonElement,
          params.statusElement.ownerDocument.querySelector(
            "#chat-tool-clear",
          ) as HTMLButtonElement,
          params.statusElement,
          params.cardsElement,
          params.item.id,
        );
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
    suppressChatMessages?: boolean;
    onComplete?: (result: { success: boolean; assistantText: string }) => void;
  },
) {
  const question = input.value.trim();
  if (!question) {
    return;
  }

  ztoolkit.log("Placeholder question:", question);
  if (!options?.silentUserMessage) {
    addMessage(chatMessages, options?.displayQuestion || question, "user");
  }
  input.value = "";
  input.style.height = `${CHAT_INPUT_MIN_HEIGHT}px`;
  input.scrollTop = 0;
  input.disabled = true;
  renderStreamingIndicator(streamingIndicator, true);

  try {
    const draft = addon.data.readerActionDraft;
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
    const session = sessionStore.touch(itemID, mode, itemTitle);
    if (!options?.silentUserMessage) {
      messageStore.append(session.sessionId, {
        role: "user",
        text: question,
        sourceMode: mode,
        status: "done",
      });
    }
    if (mode === "codex_cli") {
      if (draft) {
        if (!options?.suppressChatMessages) {
          addMessage(
            chatMessages,
            `Attached draft from ${draft.source}: ${draft.action}`,
            "ai",
          );
        }
        clearReaderActionDraft();
      }

      await handleCodexQuestion({
        itemID,
        sessionId: session.sessionId,
        sessionTitle: session.threadTitle,
        question,
        selectedText,
        annotationIDs: draft?.annotationIDs,
        useResume: Boolean(session.lastCodexSessionID),
        resumeSessionId: session.lastCodexSessionID,
        chatMessages,
        streamingIndicator,
        suppressChatMessages: options?.suppressChatMessages,
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
        clearReaderActionDraft();
      }

      await handleGeminiQuestion({
        itemID,
        sessionId: session.sessionId,
        sessionTitle: session.threadTitle,
        question,
        selectedText,
        annotationIDs: draft?.annotationIDs,
        resumeSessionId: session.lastGeminiSessionID,
        chatMessages,
        streamingIndicator,
        suppressChatMessages: options?.suppressChatMessages,
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
      clearReaderActionDraft();
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
    options?.onComplete?.({
      success: true,
      assistantText,
    });
  } finally {
    if (mode !== "codex_cli" && mode !== "gemini_cli") {
      renderStreamingIndicator(streamingIndicator, false);
    }
    input.disabled = false;
    input.focus();
  }
}
