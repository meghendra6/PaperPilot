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
  advanceRunProgress,
  claimPendingEngineCompletion,
  clearPendingEngineCompletion,
  failRunProgress,
  getLastEngineRequest,
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
import { getRunProgressState } from "../ai/runProgress";
import { classifyRunFailure } from "../ai/runFailure";
import { cancelActiveEngineRun } from "../ai/runControl";
import { armRunTimeout, completeTimedOutRun } from "../ai/runTimeout";
import {
  finishRunAfterCleanup,
  settleLatePreparedRun,
  stopDetachedRunProcess,
} from "../ai/runCompletion";
import { sanitizeAssistantText } from "../message/assistantOutput";
import { sessionHistoryService } from "../session/sessionHistoryService";
import {
  cleanupPaperWorkspaceForItemIfEnabled,
  cleanupWorkspaceIfEnabled,
} from "../workspace/cleanup";
import { clearCodexPollerForItem } from "./poller";
import {
  buildCodexRunState,
  clearCodexRunStateForItem,
  isCodexRunActiveForItem,
  setCodexRunStateForItem,
} from "./runState";
import { readCodexRunProgress, startCodexRunForQuestion } from "./runner";
import { stopCodexRunSilently } from "./stopRun";
import { classifyCodexLoginFailure } from "./statusClassification";
import { isWorkspaceRunReservedForItem } from "../ai/workspaceRun";
import type { RunProfile } from "../ai/runProfile";
import type { StructuredOutputSchema } from "../ai/structuredOutput";

declare const addon: any;
export { stopCodexRunSilently } from "./stopRun";

export async function handleCodexQuestion(params: {
  itemID: number;
  sessionId: string;
  sessionTitle: string;
  paperTitle?: string;
  question: string;
  selectedText?: string;
  annotationIDs?: string[];
  useResume: boolean;
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
      "The previous Codex CLI run is no longer active, so this follow-up was not started.";
    if (!params.suppressChatMessages) {
      addMessage(params.chatMessages, assistantText, "ai");
    }
    params.streamingIndicator.style.display = "none";
    await params.onComplete?.({ success: false, assistantText });
    return;
  }
  if (
    isCodexRunActiveForItem(params.itemID) ||
    ((getActiveReaderRunMode(params.itemID) ||
      getPendingEngineCompletion(params.itemID)) &&
      !continuingParent) ||
    (isWorkspaceRunReservedForItem(params.itemID) && !continuingParent) ||
    (isReaderSessionTransitionActive(params.itemID) && !continuingParent)
  ) {
    const assistantText =
      "A Codex CLI run is already active for this paper. Cancel it or wait for it to finish before starting another request.";
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
      mode: "codex_cli",
      sessionId: params.sessionId,
      sessionTitle: params.sessionTitle,
      paperTitle: params.paperTitle,
      question: params.question,
      selectedText: params.selectedText,
      annotationIDs: params.annotationIDs,
      useResume: params.useResume,
      resumeSessionId: params.resumeSessionId,
    });
  }

  const runToken = markReaderRunStarted(params.itemID, "codex_cli");
  startRunProgress(params.itemID, "codex_cli", runToken);
  let assistantMessage: HTMLElement | null | undefined = null;
  const pendingCompletion = {
    mode: "codex_cli" as const,
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
          engine: "codex_cli",
          engineLabel: "Codex CLI",
          token: runToken,
          workspacePath: pendingCompletion.workspacePath,
          suppressMessage: params.suppressChatMessages,
          stop: () =>
            stopCodexRunSilently({
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

  const result = await startCodexRunForQuestion({
    itemID: params.itemID,
    title: params.sessionTitle,
    sessionId: params.sessionId,
    question: params.question,
    selectedText: params.selectedText,
    annotationIDs: params.annotationIDs,
    useResume: params.useResume,
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
    const state = failRunProgress({
      itemID: params.itemID,
      engine: "codex_cli",
      token: runToken,
      rawError: detail,
      source: "workspace",
      canRetry: !params.suppressChatMessages,
    });
    const assistantText = state!.failure!.userMessage;
    try {
      await sessionHistoryService
        .persistAssistantTurn({
          itemID: params.itemID,
          sessionId: params.sessionId,
          mode: "codex_cli",
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
          setCodexRunStateForItem(params.itemID, {
            ...buildCodexRunState({
              itemID: params.itemID,
              title: params.sessionTitle,
              loginState: "ready",
            }),
            processId: result.processId,
            runStatus: "running",
            latestEventType: "spawned",
          });
        }
        recoverLatePreparedRunStopFailure({
          itemID: params.itemID,
          engine: "codex_cli",
          token: runToken,
          processId: result.ok ? result.processId : undefined,
          rawError: `Paper Pilot could not confirm late Codex process termination: ${error instanceof Error ? error.message : String(error)}`,
        });
        addon.data.ztoolkit?.log(
          "Paper Pilot Codex late-run termination failed:",
          error,
        );
      },
      onCleanupFailure: (error) =>
        addon.data.ztoolkit?.log(
          "Paper Pilot Codex late-run cleanup failed:",
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
    let failureMessage = "Codex CLI could not start this run.";
    try {
      await finishRunAfterCleanup({
        prepare: async () => {
          const loginState = classifyCodexLoginFailure(result.error);
          const failure = await persistRunFailure({
            itemID: params.itemID,
            sessionId: params.sessionId,
            sessionTitle: params.sessionTitle,
            paperTitle: params.paperTitle,
            engine: "codex_cli",
            token: runToken,
            rawError: result.error,
            source: "spawn",
            suppressMessage: params.suppressChatMessages,
          });
          failureMessage = failure.userMessage;
          if (!params.suppressChatMessages) {
            addMessage(params.chatMessages, failureMessage, "ai");
          }
          setCodexRunStateForItem(params.itemID, {
            ...buildCodexRunState({
              itemID: params.itemID,
              title: params.sessionTitle,
              loginState,
            }),
            latestEventType: "error",
          });
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
            assistantText: "Codex CLI could not finalize this run.",
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
          "Codex CLI could not finalize this run.",
          "ai",
        );
      }
    }
    return;
  }

  assistantMessage = params.suppressChatMessages
    ? undefined
    : addMessage(params.chatMessages, "Starting Codex CLI run…", "ai");
  clearCodexPollerForItem(params.itemID);

  setCodexRunStateForItem(params.itemID, {
    ...buildCodexRunState({
      itemID: params.itemID,
      title: params.sessionTitle,
      loginState: "ready",
    }),
    processId: result.processId,
    runStatus: "running",
    latestEventType: "spawned",
  });
  advanceRunProgress(params.itemID, runToken, {
    type: "spawned",
    processId: result.processId,
  });
  const poller = setInterval(async () => {
    const progress = await readCodexRunProgress({
      outputPath: result.outputPath,
      stderrPath: result.stderrPath,
      exitCodePath: result.exitCodePath,
    });

    if (!isReaderRunTokenActive(params.itemID, runToken)) return;

    if (!progress.completed) {
      if (assistantMessage) {
        const displayText = sanitizeAssistantText(
          progress.structuredOutput && progress.parsedOutput
            ? progress.parsedOutput
            : "Running Codex CLI…",
        );
        setMessageContent(assistantMessage, displayText, "ai");
      }
      setCodexRunStateForItem(params.itemID, {
        ...buildCodexRunState({
          itemID: params.itemID,
          title: params.sessionTitle,
          loginState: "ready",
        }),
        processId: result.processId,
        runStatus: "running",
        latestEventType: progress.latestEventType,
      });
      return;
    }

    if (!claimPendingEngineCompletion(params.itemID, runToken, "controller")) {
      return;
    }

    clearCodexPollerForItem(params.itemID);
    clearCodexRunStateForItem(params.itemID);
    advanceRunProgress(params.itemID, runToken, { type: "finishing" });

    const rawAssistantText =
      progress.parsedOutput ||
      "Codex CLI ran successfully, but returned no assistant message.";
    const success = progress.exitCode === "0";
    let assistantText = sanitizeAssistantText(rawAssistantText);
    const terminalFailure = success
      ? undefined
      : classifyRunFailure({
          engine: "codex_cli",
          rawError: progress.diagnosticOutput || rawAssistantText,
          source: "process_exit",
        });
    if (terminalFailure) assistantText = terminalFailure.userMessage;

    if (assistantMessage) {
      setMessageContent(assistantMessage, assistantText, "ai");
    }
    const resumedThreadId = progress.rawOutput
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line) as Record<string, unknown>;
        } catch {
          return undefined;
        }
      })
      .find(
        (event) =>
          event?.type === "thread.started" &&
          typeof event.thread_id === "string",
      )?.thread_id as string | undefined;

    setCodexRunStateForItem(params.itemID, {
      ...buildCodexRunState({
        itemID: params.itemID,
        title: params.sessionTitle,
        loginState: success
          ? "ready"
          : classifyCodexLoginFailure(
              progress.diagnosticOutput || rawAssistantText,
            ),
      }),
      runStatus: success ? "completed" : "error",
      latestEventType: progress.latestEventType,
    });
    params.streamingIndicator.style.display = "none";

    try {
      await finishRunAfterCleanup({
        prepare: async () => {
          if (success) {
            await sessionHistoryService.persistAssistantTurn({
              itemID: params.itemID,
              sessionId: params.sessionId,
              mode: "codex_cli",
              paperTitle: params.paperTitle || params.sessionTitle,
              assistantText,
              success: true,
              rawEvent: progress.rawOutput,
              resumeSessionId: resumedThreadId,
              suppressMessage: params.suppressChatMessages,
              updateResumeMetadata: profile === "chat",
            });
          } else {
            await sessionHistoryService.persistAssistantTurn({
              itemID: params.itemID,
              sessionId: params.sessionId,
              mode: "codex_cli",
              paperTitle: params.paperTitle || params.sessionTitle,
              assistantText,
              success: false,
              rawEvent: terminalFailure!.rawError,
              suppressMessage: params.suppressChatMessages,
              updateResumeMetadata: profile === "chat",
            });
          }
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
          const message = failRunProgress({
            itemID: params.itemID,
            engine: "codex_cli",
            token: runToken,
            rawError:
              error instanceof Error ? error.message : String(error || ""),
            source: "process_exit",
            canRetry: !params.suppressChatMessages,
          })!.failure!.userMessage;
          return params.onComplete?.({
            success: false,
            assistantText: message,
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
                engine: "codex_cli",
                token: runToken,
                rawError: terminalFailure!.rawError,
                source: "process_exit",
                canRetry: !params.suppressChatMessages,
              });
            }
            clearPendingEngineCompletion(params.itemID, runToken);
          }
          markReaderRunFinished(params.itemID, runToken);
        },
      });
    } catch {
      if (!params.suppressChatMessages) {
        addMessage(
          params.chatMessages,
          "Codex CLI could not finalize this run.",
          "ai",
        );
      }
    }
  }, 800);

  addon.data.codexRunPollers?.set(params.itemID, poller);
}

export async function retryLastCodexQuestion(params: {
  itemID: number;
  chatMessages: HTMLElement;
  streamingIndicator: HTMLElement;
}) {
  const last = getLastEngineRequest(params.itemID);
  if (!last || last.mode !== "codex_cli") {
    addMessage(
      params.chatMessages,
      "No previous Codex request to retry.",
      "ai",
    );
    return;
  }

  await handleCodexQuestion({
    itemID: params.itemID,
    sessionId: last.sessionId,
    sessionTitle: last.sessionTitle,
    paperTitle: (last as typeof last & { paperTitle?: string }).paperTitle,
    question: last.question,
    resumeSessionId: last.resumeSessionId,
    selectedText: last.selectedText,
    annotationIDs: last.annotationIDs,
    useResume: Boolean(last.useResume),
    chatMessages: params.chatMessages,
    streamingIndicator: params.streamingIndicator,
  });
}

export async function cancelCodexRun(params: {
  itemID: number;
  chatMessages: HTMLElement;
}) {
  const cancelled = await cancelActiveEngineRun(params.itemID);
  const updatedState = getRunProgressState(params.itemID);
  addMessage(
    params.chatMessages,
    cancelled
      ? "Codex run cancelled."
      : updatedState?.failure?.userMessage ||
          "No cancellable Codex run is active.",
    "ai",
  );
}
