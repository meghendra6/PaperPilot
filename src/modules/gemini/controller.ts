import { addMessage, setMessageContent } from "../components/ChatMessage";
import {
  getActiveReaderRunMode,
  isReaderRunTokenActive,
  markReaderRunFinished,
  markReaderRunStarted,
  type ReaderRunCompletionResult,
  type ReaderRunToken,
} from "../ai/runPresentation";
import {
  finishRunAfterCleanup,
  stopDetachedRunProcess,
} from "../ai/runCompletion";
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
  continuationToken?: ReaderRunToken;
  onComplete?: (result: ReaderRunCompletionResult) => void | Promise<void>;
}) {
  const continuingParent = Boolean(
    params.continuationToken &&
      isReaderRunTokenActive(params.itemID, params.continuationToken),
  );
  if (
    isGeminiRunActiveForItem(params.itemID) ||
    (getActiveReaderRunMode(params.itemID) && !continuingParent)
  ) {
    const assistantText =
      "A Gemini CLI run is already active for this paper. Wait for it to finish before starting another request.";
    if (!params.suppressChatMessages) {
      addMessage(params.chatMessages, assistantText, "ai");
    }
    params.streamingIndicator.style.display = "none";
    await params.onComplete?.({
      success: false,
      assistantText,
    });
    return;
  }

  const runToken = markReaderRunStarted(params.itemID, "gemini_cli");

  const result = await startGeminiRunForQuestion({
    itemID: params.itemID,
    title: params.sessionTitle,
    sessionId: params.sessionId,
    question: params.question,
    selectedText: params.selectedText,
    annotationIDs: params.annotationIDs,
    resumeSessionId: params.resumeSessionId,
  }).catch(async (error) => {
    const detail = error instanceof Error ? error.message : String(error);
    const assistantText = `Gemini CLI could not start: ${detail}`;
    try {
      if (!params.suppressChatMessages) {
        addMessage(params.chatMessages, assistantText, "ai");
      }
      await params.onComplete?.({ success: false, assistantText });
    } finally {
      params.streamingIndicator.style.display = "none";
      markReaderRunFinished(params.itemID, runToken);
    }
    return undefined;
  });

  if (!result) return;

  if (!isReaderRunTokenActive(params.itemID, runToken)) {
    if (result.ok) await stopDetachedRunProcess(result.processId);
    await cleanupWorkspaceIfEnabled(result.workspacePath);
    params.streamingIndicator.style.display = "none";
    return;
  }

  if (!result.ok) {
    try {
      await finishRunAfterCleanup({
        prepare: async () => {
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
        },
        cleanup: () => cleanupWorkspaceIfEnabled(result.workspacePath),
        shouldComplete: () => isReaderRunTokenActive(params.itemID, runToken),
        complete: () =>
          params.onComplete?.({
            success: false,
            assistantText: result.error,
            continuationToken: runToken,
          }),
        incomplete: () =>
          params.onComplete?.({
            success: false,
            assistantText: "Gemini CLI could not finalize this run.",
          }),
        finalize: () => markReaderRunFinished(params.itemID, runToken),
      });
    } catch {
      if (!params.suppressChatMessages) {
        addMessage(
          params.chatMessages,
          "Gemini CLI could not finalize this run.",
          "ai",
        );
      }
    }
    return;
  }

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

    if (!isReaderRunTokenActive(params.itemID, runToken)) return;

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
      await finishRunAfterCleanup({
        prepare: async () => {
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
        },
        cleanup: () => cleanupWorkspaceIfEnabled(result.workspacePath),
        shouldComplete: () => isReaderRunTokenActive(params.itemID, runToken),
        complete: () =>
          params.onComplete?.({
            success,
            assistantText,
            continuationToken: runToken,
          }),
        incomplete: () =>
          params.onComplete?.({
            success: false,
            assistantText: "Gemini CLI could not finalize this run.",
          }),
        finalize: () => {
          clearGeminiRunStateForItem(params.itemID);
          markReaderRunFinished(params.itemID, runToken);
        },
      });
    } catch {
      if (!params.suppressChatMessages) {
        addMessage(
          params.chatMessages,
          "Gemini CLI could not finalize this run.",
          "ai",
        );
      }
    }
  }, 800);

  addon.data.geminiRunPollers?.set(params.itemID, poller);
}
