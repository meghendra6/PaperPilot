import { addMessage, setMessageContent } from "../components/ChatMessage";
import {
  markReaderRunFinished,
  markReaderRunStarted,
  notifyReaderPaneStateChanged,
} from "../ai/runPresentation";
import { sanitizeAssistantText } from "../message/assistantOutput";
import { sessionHistoryService } from "../session/sessionHistoryService";
import { cleanupWorkspaceIfEnabled } from "../workspace/cleanup";
import { clearGeminiPollerForItem } from "./poller";
import {
  clearGeminiRunStateForItem,
  isGeminiRunActiveForItem,
  setGeminiRunStateForItem,
} from "./runState";
import { startGeminiRunForQuestion, readGeminiRunProgress } from "./runner";
import { stopGeminiRunSilently } from "./stopRun";

declare const addon: any;

export { stopGeminiRunSilently } from "./stopRun";

export async function handleGeminiQuestion(params: {
  itemID: number;
  sessionId: string;
  sessionTitle: string;
  paperTitle?: string;
  question: string;
  selectedText?: string;
  annotationIDs?: string[];
  resumeSessionId?: string;
  chatMessages: HTMLElement;
  streamingIndicator: HTMLElement;
  suppressChatMessages?: boolean;
  onComplete?: (result: { success: boolean; assistantText: string }) => void;
}) {
  if (isGeminiRunActiveForItem(params.itemID)) {
    const assistantText =
      "A Gemini CLI run is already active for this paper. Wait for it to finish before starting another request.";
    if (!params.suppressChatMessages) {
      addMessage(params.chatMessages, assistantText, "ai");
    }
    params.streamingIndicator.style.display = "none";
    params.onComplete?.({
      success: false,
      assistantText,
    });
    return;
  }

  const result = await startGeminiRunForQuestion({
    itemID: params.itemID,
    title: params.sessionTitle,
    sessionId: params.sessionId,
    question: params.question,
    selectedText: params.selectedText,
    annotationIDs: params.annotationIDs,
    resumeSessionId: params.resumeSessionId,
  }).catch((error) => {
    notifyReaderPaneStateChanged(params.itemID);
    throw error;
  });

  if (!result.ok) {
    try {
      if (!params.suppressChatMessages) {
        addMessage(
          params.chatMessages,
          `Gemini CLI error: ${result.error}`,
          "ai",
        );
      }
      await sessionHistoryService.persistAssistantTurn({
        itemID: params.itemID,
        sessionId: params.sessionId,
        mode: "gemini_cli",
        paperTitle: params.paperTitle || params.sessionTitle,
        assistantText: result.error,
        success: false,
        suppressMessage: params.suppressChatMessages,
      });
      params.streamingIndicator.style.display = "none";
      params.onComplete?.({
        success: false,
        assistantText: result.error,
      });
    } finally {
      try {
        await cleanupWorkspaceIfEnabled(result.workspacePath);
      } finally {
        notifyReaderPaneStateChanged(params.itemID);
      }
    }
    return;
  }

  const runToken = markReaderRunStarted(params.itemID, "gemini_cli");
  const assistantMessage = params.suppressChatMessages
    ? undefined
    : addMessage(params.chatMessages, "Starting Gemini CLI run…", "ai");
  clearGeminiPollerForItem(params.itemID);
  setGeminiRunStateForItem(params.itemID, {
    processId: result.processId,
  });

  const poller = setInterval(async () => {
    const progress = await readGeminiRunProgress({
      outputPath: result.outputPath,
      exitCodePath: result.exitCodePath,
    });

    if (assistantMessage) {
      setMessageContent(
        assistantMessage,
        sanitizeAssistantText(progress.parsedOutput || "Running Gemini CLI…"),
        "ai",
      );
    }

    if (!progress.completed) {
      return;
    }

    clearGeminiPollerForItem(params.itemID);

    const assistantText = sanitizeAssistantText(
      progress.parsedOutput ||
        "Gemini CLI ran successfully, but returned no assistant message.",
    );

    if (assistantMessage) {
      setMessageContent(assistantMessage, assistantText, "ai");
    }

    const success = progress.exitCode === "0";
    try {
      await sessionHistoryService.persistAssistantTurn({
        itemID: params.itemID,
        sessionId: params.sessionId,
        mode: "gemini_cli",
        paperTitle: params.paperTitle || params.sessionTitle,
        assistantText,
        success,
        rawEvent: progress.rawOutput,
        resumeSessionId: params.resumeSessionId,
        suppressMessage: params.suppressChatMessages,
      });
      clearGeminiRunStateForItem(params.itemID);
      params.streamingIndicator.style.display = "none";
      params.onComplete?.({
        success,
        assistantText,
      });
    } finally {
      clearGeminiRunStateForItem(params.itemID);
      try {
        await cleanupWorkspaceIfEnabled(result.workspacePath);
      } finally {
        markReaderRunFinished(params.itemID, runToken);
      }
    }
  }, 800);

  addon.data.geminiRunPollers?.set(params.itemID, poller);
}
