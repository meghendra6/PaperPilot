import { addMessage, setMessageContent } from "../components/ChatMessage";
import {
  getActiveReaderRunMode,
  isReaderRunTokenActive,
  markReaderRunFinished,
  markReaderRunStarted,
} from "../ai/runPresentation";
import {
  finishRunAfterCleanup,
  stopDetachedRunProcess,
} from "../ai/runCompletion";
import { sanitizeAssistantText } from "../message/assistantOutput";
import { sessionHistoryService } from "../session/sessionHistoryService";
import { cleanupWorkspaceIfEnabled } from "../workspace/cleanup";
import { clearClaudePollerForItem } from "./poller";
import {
  clearClaudeRunStateForItem,
  isClaudeRunActiveForItem,
  setClaudeRunStateForItem,
} from "./runState";
import { startClaudeRunForQuestion, readClaudeRunProgress } from "./runner";
import { stopClaudeRunSilently } from "./stopRun";

declare const addon: any;

export { stopClaudeRunSilently } from "./stopRun";

export async function handleClaudeQuestion(params: {
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
  onComplete?: (result: {
    success: boolean;
    assistantText: string;
  }) => void | Promise<void>;
}) {
  if (
    isClaudeRunActiveForItem(params.itemID) ||
    getActiveReaderRunMode(params.itemID)
  ) {
    const assistantText =
      "A Claude Code run is already active for this paper. Wait for it to finish before starting another request.";
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

  const runToken = markReaderRunStarted(params.itemID, "claude_code");

  const result = await startClaudeRunForQuestion({
    itemID: params.itemID,
    title: params.sessionTitle,
    sessionId: params.sessionId,
    question: params.question,
    selectedText: params.selectedText,
    annotationIDs: params.annotationIDs,
    resumeSessionId: params.resumeSessionId,
  }).catch(async (error) => {
    const detail = error instanceof Error ? error.message : String(error);
    const assistantText = `Claude Code could not start: ${detail}`;
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
              `Claude Code error: ${result.error}`,
              "ai",
            );
          }
          await sessionHistoryService.persistAssistantTurn({
            itemID: params.itemID,
            sessionId: params.sessionId,
            mode: "claude_code",
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
          }),
        incomplete: () =>
          params.onComplete?.({
            success: false,
            assistantText: "Claude Code could not finalize this run.",
          }),
        finalize: () => markReaderRunFinished(params.itemID, runToken),
      });
    } catch {
      if (!params.suppressChatMessages) {
        addMessage(
          params.chatMessages,
          "Claude Code could not finalize this run.",
          "ai",
        );
      }
    }
    return;
  }

  const assistantMessage = params.suppressChatMessages
    ? undefined
    : addMessage(params.chatMessages, "Starting Claude Code run…", "ai");
  clearClaudePollerForItem(params.itemID);
  setClaudeRunStateForItem(params.itemID, {
    processId: result.processId,
  });

  const poller = setInterval(async () => {
    const progress = await readClaudeRunProgress({
      outputPath: result.outputPath,
      exitCodePath: result.exitCodePath,
    });

    if (assistantMessage) {
      setMessageContent(
        assistantMessage,
        sanitizeAssistantText(progress.parsedOutput || "Running Claude Code…"),
        "ai",
      );
    }

    if (!progress.completed) {
      return;
    }

    clearClaudePollerForItem(params.itemID);

    const assistantText = sanitizeAssistantText(
      progress.parsedOutput ||
        "Claude Code ran successfully, but returned no assistant message.",
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
            mode: "claude_code",
            paperTitle: params.paperTitle || params.sessionTitle,
            assistantText,
            success,
            rawEvent: progress.rawOutput,
            resumeSessionId: params.resumeSessionId,
            suppressMessage: params.suppressChatMessages,
          });
          clearClaudeRunStateForItem(params.itemID);
          params.streamingIndicator.style.display = "none";
        },
        cleanup: () => cleanupWorkspaceIfEnabled(result.workspacePath),
        shouldComplete: () => isReaderRunTokenActive(params.itemID, runToken),
        complete: () => params.onComplete?.({ success, assistantText }),
        incomplete: () =>
          params.onComplete?.({
            success: false,
            assistantText: "Claude Code could not finalize this run.",
          }),
        finalize: () => {
          clearClaudeRunStateForItem(params.itemID);
          markReaderRunFinished(params.itemID, runToken);
        },
      });
    } catch {
      if (!params.suppressChatMessages) {
        addMessage(
          params.chatMessages,
          "Claude Code could not finalize this run.",
          "ai",
        );
      }
    }
  }, 800);

  addon.data.claudeRunPollers?.set(params.itemID, poller);
}
