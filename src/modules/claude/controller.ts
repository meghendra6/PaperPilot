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
  settleLatePreparedRun,
  stopDetachedRunProcess,
} from "../ai/runCompletion";
import {
  advanceRunProgress,
  claimPendingEngineCompletion,
  clearPendingEngineCompletion,
  failRunProgress,
  getPendingEngineCompletion,
  isPendingEngineCompletionCurrent,
  isReaderSessionTransitionActive,
  markPendingEnginePreparationSettled,
  persistRunFailure,
  registerPendingEngineCompletion,
  rememberLastEngineRequest,
  recoverLatePreparedRunStopFailure,
  startRunProgress,
} from "../ai/runLifecycle";
import { classifyRunFailure } from "../ai/runFailure";
import { getRunProgressState } from "../ai/runProgress";
import { armRunTimeout, completeTimedOutRun } from "../ai/runTimeout";
import { sanitizeAssistantText } from "../message/assistantOutput";
import { sessionHistoryService } from "../session/sessionHistoryService";
import {
  cleanupPaperWorkspaceForItemIfEnabled,
  cleanupWorkspaceIfEnabled,
} from "../workspace/cleanup";
import { clearClaudePollerForItem } from "./poller";
import {
  clearClaudeRunStateForItem,
  isClaudeRunActiveForItem,
  setClaudeRunStateForItem,
} from "./runState";
import { startClaudeRunForQuestion, readClaudeRunProgress } from "./runner";
import { stopClaudeRunSilently } from "./stopRun";
import { isWorkspaceRunReservedForItem } from "../ai/workspaceRun";
import type { RunProfile } from "../ai/runProfile";
import type { StructuredOutputSchema } from "../ai/structuredOutput";

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
  continuationToken?: ReaderRunToken;
  profile?: RunProfile;
  outputSchema?: StructuredOutputSchema;
  onComplete?: (result: ReaderRunCompletionResult) => void | Promise<void>;
}) {
  const profile = params.profile || "chat";
  const continuingParent = Boolean(
    params.continuationToken &&
      isReaderRunTokenActive(params.itemID, params.continuationToken),
  );
  if (params.continuationToken && !continuingParent) {
    const assistantText =
      "The previous Claude Code run is no longer active, so this follow-up was not started.";
    if (!params.suppressChatMessages) {
      addMessage(params.chatMessages, assistantText, "ai");
    }
    params.streamingIndicator.style.display = "none";
    await params.onComplete?.({ success: false, assistantText });
    return;
  }
  if (
    isClaudeRunActiveForItem(params.itemID) ||
    ((getActiveReaderRunMode(params.itemID) ||
      getPendingEngineCompletion(params.itemID)) &&
      !continuingParent) ||
    (isWorkspaceRunReservedForItem(params.itemID) && !continuingParent) ||
    (isReaderSessionTransitionActive(params.itemID) && !continuingParent)
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

  if (!params.suppressChatMessages) {
    rememberLastEngineRequest(params.itemID, {
      mode: "claude_code",
      sessionId: params.sessionId,
      sessionTitle: params.sessionTitle,
      paperTitle: params.paperTitle,
      question: params.question,
      selectedText: params.selectedText,
      annotationIDs: params.annotationIDs,
      resumeSessionId: params.resumeSessionId,
    });
  }

  const runToken = markReaderRunStarted(params.itemID, "claude_code");
  startRunProgress(params.itemID, "claude_code", runToken);
  let assistantMessage: HTMLElement | null | undefined = null;
  const pendingCompletion = {
    mode: "claude_code" as const,
    token: runToken,
    retryable: !params.suppressChatMessages,
    onComplete: params.onComplete,
    workspacePath: undefined as string | undefined,
    cancelTimeout: undefined as (() => void) | undefined,
    rearmTimeout: undefined as (() => void) | undefined,
    cleanupClaimed: false,
    terminalClaim: undefined as "controller" | "cancel" | "timeout" | undefined,
    preparationSettled: false,
    terminalSettled: false,
  };
  registerPendingEngineCompletion(params.itemID, pendingCompletion);
  const armTimeout = (minimumDelayMs = 0) =>
    armRunTimeout({
      itemID: params.itemID,
      minimumDelayMs,
      shouldTimeout: () => isReaderRunTokenActive(params.itemID, runToken),
      onTimeout: async () => {
        await completeTimedOutRun({
          itemID: params.itemID,
          sessionId: params.sessionId,
          sessionTitle: params.sessionTitle,
          paperTitle: params.paperTitle,
          engine: "claude_code",
          engineLabel: "Claude Code",
          token: runToken,
          workspacePath: pendingCompletion.workspacePath,
          suppressMessage: params.suppressChatMessages,
          stop: () =>
            stopClaudeRunSilently({
              itemID: params.itemID,
              finishPresentation: false,
            }),
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
  const cancelTimeout = armTimeout();
  pendingCompletion.cancelTimeout = cancelTimeout;
  pendingCompletion.rearmTimeout = () => {
    pendingCompletion.cancelTimeout = armTimeout(5_000);
  };

  const result = await startClaudeRunForQuestion({
    itemID: params.itemID,
    title: params.sessionTitle,
    sessionId: params.sessionId,
    question: params.question,
    selectedText: params.selectedText,
    annotationIDs: params.annotationIDs,
    resumeSessionId: params.resumeSessionId,
    profile,
    outputSchema: params.outputSchema,
  }).catch(async (error) => {
    cancelTimeout();
    await cleanupPaperWorkspaceForItemIfEnabled({
      itemID: params.itemID,
      title: params.sessionTitle,
      profile,
    });
    if (!isReaderRunTokenActive(params.itemID, runToken)) {
      markPendingEnginePreparationSettled(params.itemID, runToken);
      return undefined;
    }
    if (!claimPendingEngineCompletion(params.itemID, runToken, "controller")) {
      return undefined;
    }
    markPendingEnginePreparationSettled(params.itemID, runToken);
    const detail = error instanceof Error ? error.message : String(error);
    const assistantText = failRunProgress({
      itemID: params.itemID,
      engine: "claude_code",
      token: runToken,
      rawError: detail,
      source: "workspace",
      canRetry: !params.suppressChatMessages,
    })!.failure!.userMessage;
    try {
      await sessionHistoryService
        .persistAssistantTurn({
          itemID: params.itemID,
          sessionId: params.sessionId,
          mode: "claude_code",
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
      clearPendingEngineCompletion(params.itemID, runToken);
      markReaderRunFinished(params.itemID, runToken);
    }
    return undefined;
  });

  if (!result) return;

  pendingCompletion.workspacePath = result.workspacePath;

  if (!isReaderRunTokenActive(params.itemID, runToken)) {
    cancelTimeout();
    await settleLatePreparedRun({
      stop: () =>
        result.ok
          ? stopDetachedRunProcess(result.processId, { requireProcessId: true })
          : undefined,
      cleanup: () =>
        isPendingEngineCompletionCurrent(params.itemID, runToken) &&
        !pendingCompletion.cleanupClaimed
          ? cleanupWorkspaceIfEnabled(result.workspacePath)
          : undefined,
      settle: () => {
        params.streamingIndicator.style.display = "none";
        markPendingEnginePreparationSettled(params.itemID, runToken);
      },
      onStopFailure: (error) => {
        if (result.ok) {
          setClaudeRunStateForItem(params.itemID, {
            processId: result.processId,
          });
        }
        recoverLatePreparedRunStopFailure({
          itemID: params.itemID,
          engine: "claude_code",
          token: runToken,
          processId: result.ok ? result.processId : undefined,
          rawError: `Paper Pilot could not confirm late Claude process termination: ${error instanceof Error ? error.message : String(error)}`,
        });
        addon.data.ztoolkit?.log(
          "Paper Pilot Claude late-run termination failed:",
          error,
        );
      },
      onCleanupFailure: (error) =>
        addon.data.ztoolkit?.log(
          "Paper Pilot Claude late-run cleanup failed:",
          error,
        ),
    });
    return;
  }
  markPendingEnginePreparationSettled(params.itemID, runToken);

  if (!result.ok) {
    cancelTimeout();
    if (!claimPendingEngineCompletion(params.itemID, runToken, "controller")) {
      return;
    }
    let failureMessage = "Claude Code could not start this run.";
    try {
      await finishRunAfterCleanup({
        prepare: async () => {
          const failure = await persistRunFailure({
            itemID: params.itemID,
            sessionId: params.sessionId,
            sessionTitle: params.sessionTitle,
            paperTitle: params.paperTitle,
            engine: "claude_code",
            token: runToken,
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
            assistantText: "Claude Code could not finalize this run.",
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
          "Claude Code could not finalize this run.",
          "ai",
        );
      }
    }
    return;
  }

  assistantMessage = params.suppressChatMessages
    ? undefined
    : addMessage(params.chatMessages, "Starting Claude Code run…", "ai");
  clearClaudePollerForItem(params.itemID);
  setClaudeRunStateForItem(params.itemID, {
    processId: result.processId,
  });
  advanceRunProgress(params.itemID, runToken, {
    type: "spawned",
    processId: result.processId,
  });
  const poller = setInterval(async () => {
    const progress = await readClaudeRunProgress({
      outputPath: result.outputPath,
      stderrPath: result.stderrPath,
      exitCodePath: result.exitCodePath,
    });

    if (!isReaderRunTokenActive(params.itemID, runToken)) return;

    if (!progress.completed) {
      if (assistantMessage) {
        setMessageContent(assistantMessage, "Running Claude Code…", "ai");
      }
      return;
    }

    if (!claimPendingEngineCompletion(params.itemID, runToken, "controller")) {
      return;
    }

    setClaudeRunStateForItem(params.itemID, {});
    clearClaudePollerForItem(params.itemID);
    advanceRunProgress(params.itemID, runToken, { type: "finishing" });

    const rawAssistantText =
      progress.parsedOutput ||
      "Claude Code ran successfully, but returned no assistant message.";
    const success = progress.exitCode === "0";
    const terminalFailure = success
      ? undefined
      : classifyRunFailure({
          engine: "claude_code",
          rawError: progress.diagnosticOutput || rawAssistantText,
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
            mode: "claude_code",
            paperTitle: params.paperTitle || params.sessionTitle,
            assistantText,
            success,
            rawEvent: progress.rawOutput,
            resumeSessionId: params.resumeSessionId,
            suppressMessage: params.suppressChatMessages,
            updateResumeMetadata: profile === "chat",
          });
          if (isPendingEngineCompletionCurrent(params.itemID, runToken)) {
            clearClaudeRunStateForItem(params.itemID);
          }
          params.streamingIndicator.style.display = "none";
        },
        cleanup: () => cleanupWorkspaceIfEnabled(result.workspacePath),
        shouldComplete: () =>
          isReaderRunTokenActive(params.itemID, runToken) &&
          isPendingEngineCompletionCurrent(params.itemID, runToken),
        complete: () =>
          params.onComplete?.({
            success,
            assistantText,
            continuationToken: runToken,
          }),
        incomplete: (error) => {
          assistantText = failRunProgress({
            itemID: params.itemID,
            engine: "claude_code",
            token: runToken,
            rawError:
              error instanceof Error ? error.message : String(error || ""),
            source: "process_exit",
            canRetry: !params.suppressChatMessages,
          })!.failure!.userMessage;
          return params.onComplete?.({
            success: false,
            assistantText,
          });
        },
        finalize: () => {
          cancelTimeout();
          if (isPendingEngineCompletionCurrent(params.itemID, runToken)) {
            if (success) {
              if (getRunProgressState(params.itemID)?.phase !== "failed") {
                advanceRunProgress(params.itemID, runToken, {
                  type: "completed",
                });
              }
            } else {
              failRunProgress({
                itemID: params.itemID,
                engine: "claude_code",
                token: runToken,
                rawError: terminalFailure!.rawError,
                source: "process_exit",
                canRetry: !params.suppressChatMessages,
              });
            }
            clearPendingEngineCompletion(params.itemID, runToken);
            clearClaudeRunStateForItem(params.itemID);
          }
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
