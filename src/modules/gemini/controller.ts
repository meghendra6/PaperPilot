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
import {
  advanceRunProgress,
  clearPendingEngineCompletion,
  failRunProgress,
  persistRunFailure,
  registerPendingEngineCompletion,
  rememberLastEngineRequest,
  startRunProgress,
} from "../ai/runLifecycle";
import { classifyRunFailure } from "../ai/runFailure";
import { getRunProgressState } from "../ai/runProgress";
import { armRunTimeout, completeTimedOutRun } from "../ai/runTimeout";
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

  if (!params.suppressChatMessages) {
    rememberLastEngineRequest(params.itemID, {
      mode: "gemini_cli",
      sessionId: params.sessionId,
      sessionTitle: params.sessionTitle,
      paperTitle: params.paperTitle,
      question: params.question,
      selectedText: params.selectedText,
      annotationIDs: params.annotationIDs,
      resumeSessionId: params.resumeSessionId,
    });
  }

  const runToken = markReaderRunStarted(params.itemID, "gemini_cli");
  startRunProgress(params.itemID, "gemini_cli");
  let assistantMessage: HTMLElement | null | undefined = null;
  const pendingCompletion = {
    mode: "gemini_cli" as const,
    token: runToken,
    retryable: !params.suppressChatMessages,
    onComplete: params.onComplete,
    workspacePath: undefined as string | undefined,
    cancelTimeout: undefined as (() => void) | undefined,
  };
  registerPendingEngineCompletion(params.itemID, pendingCompletion);
  const cancelTimeout = armRunTimeout({
    itemID: params.itemID,
    shouldTimeout: () => isReaderRunTokenActive(params.itemID, runToken),
    onTimeout: async () => {
      await completeTimedOutRun({
        itemID: params.itemID,
        sessionId: params.sessionId,
        sessionTitle: params.sessionTitle,
        paperTitle: params.paperTitle,
        engine: "gemini_cli",
        engineLabel: "Gemini CLI",
        token: runToken,
        workspacePath: pendingCompletion.workspacePath,
        suppressMessage: params.suppressChatMessages,
        stop: () => stopGeminiRunSilently({ itemID: params.itemID }),
        onMessage: (message) => {
          if (assistantMessage) {
            setMessageContent(assistantMessage, message, "ai");
          }
          params.streamingIndicator.style.display = "none";
        },
        onComplete: params.onComplete,
      });
    },
  });
  pendingCompletion.cancelTimeout = cancelTimeout;

  const result = await startGeminiRunForQuestion({
    itemID: params.itemID,
    title: params.sessionTitle,
    sessionId: params.sessionId,
    question: params.question,
    selectedText: params.selectedText,
    annotationIDs: params.annotationIDs,
    resumeSessionId: params.resumeSessionId,
  }).catch(async (error) => {
    cancelTimeout();
    clearPendingEngineCompletion(params.itemID, runToken);
    if (!isReaderRunTokenActive(params.itemID, runToken)) return undefined;
    const detail = error instanceof Error ? error.message : String(error);
    const assistantText = failRunProgress({
      itemID: params.itemID,
      engine: "gemini_cli",
      rawError: detail,
      source: "workspace",
      canRetry: !params.suppressChatMessages,
    }).failure!.userMessage;
    try {
      await sessionHistoryService
        .persistAssistantTurn({
          itemID: params.itemID,
          sessionId: params.sessionId,
          mode: "gemini_cli",
          paperTitle: params.paperTitle || params.sessionTitle,
          assistantText,
          success: false,
          rawEvent: detail,
          suppressMessage: params.suppressChatMessages,
        })
        .catch(() => undefined);
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

  pendingCompletion.workspacePath = result.workspacePath;

  if (!isReaderRunTokenActive(params.itemID, runToken)) {
    cancelTimeout();
    clearPendingEngineCompletion(params.itemID, runToken);
    if (result.ok) await stopDetachedRunProcess(result.processId);
    await cleanupWorkspaceIfEnabled(result.workspacePath);
    params.streamingIndicator.style.display = "none";
    return;
  }

  if (!result.ok) {
    cancelTimeout();
    let failureMessage = "Gemini CLI could not start this run.";
    try {
      await finishRunAfterCleanup({
        prepare: async () => {
          const failure = await persistRunFailure({
            itemID: params.itemID,
            sessionId: params.sessionId,
            sessionTitle: params.sessionTitle,
            paperTitle: params.paperTitle,
            engine: "gemini_cli",
            rawError: result.error,
            source: "spawn",
            suppressMessage: params.suppressChatMessages,
          });
          failureMessage = failure.userMessage;
          if (!params.suppressChatMessages) {
            addMessage(params.chatMessages, failureMessage, "ai");
          }
          params.streamingIndicator.style.display = "none";
        },
        cleanup: () => cleanupWorkspaceIfEnabled(result.workspacePath),
        shouldComplete: () => isReaderRunTokenActive(params.itemID, runToken),
        complete: () =>
          params.onComplete?.({
            success: false,
            assistantText: failureMessage,
            continuationToken: runToken,
          }),
        incomplete: () =>
          params.onComplete?.({
            success: false,
            assistantText: "Gemini CLI could not finalize this run.",
          }),
        finalize: () => {
          clearPendingEngineCompletion(params.itemID, runToken);
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
    return;
  }

  assistantMessage = params.suppressChatMessages
    ? undefined
    : addMessage(params.chatMessages, "Starting Gemini CLI run…", "ai");
  clearGeminiPollerForItem(params.itemID);
  setGeminiRunStateForItem(params.itemID, {
    processId: result.processId,
  });
  advanceRunProgress(params.itemID, {
    type: "spawned",
    processId: result.processId,
  });
  const poller = setInterval(async () => {
    const progress = await readGeminiRunProgress({
      outputPath: result.outputPath,
      exitCodePath: result.exitCodePath,
    });

    if (!isReaderRunTokenActive(params.itemID, runToken)) return;

    if (assistantMessage) {
      setMessageContent(assistantMessage, "Running Gemini CLI…", "ai");
    }

    if (!progress.completed) {
      return;
    }

    clearGeminiPollerForItem(params.itemID);
    advanceRunProgress(params.itemID, { type: "finishing" });

    const rawAssistantText =
      progress.parsedOutput ||
      "Gemini CLI ran successfully, but returned no assistant message.";
    const success = progress.exitCode === "0";
    const terminalFailure = success
      ? undefined
      : classifyRunFailure({
          engine: "gemini_cli",
          rawError: progress.rawOutput || rawAssistantText,
          source: "process_exit",
        });
    let assistantText = success
      ? sanitizeAssistantText(rawAssistantText)
      : terminalFailure!.userMessage;

    if (assistantMessage) {
      setMessageContent(assistantMessage, assistantText, "ai");
    }

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
        incomplete: (error) => {
          assistantText = failRunProgress({
            itemID: params.itemID,
            engine: "gemini_cli",
            rawError:
              error instanceof Error ? error.message : String(error || ""),
            source: "process_exit",
            canRetry: !params.suppressChatMessages,
          }).failure!.userMessage;
          return params.onComplete?.({
            success: false,
            assistantText,
          });
        },
        finalize: () => {
          cancelTimeout();
          if (success) {
            if (getRunProgressState(params.itemID)?.phase !== "failed") {
              advanceRunProgress(params.itemID, { type: "completed" });
            }
          } else {
            failRunProgress({
              itemID: params.itemID,
              engine: "gemini_cli",
              rawError: terminalFailure!.rawError,
              source: "process_exit",
              canRetry: !params.suppressChatMessages,
            });
          }
          clearPendingEngineCompletion(params.itemID, runToken);
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
