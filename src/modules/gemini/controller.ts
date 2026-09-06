import {
  assertRequestContextCurrent,
  type RequestContextSnapshot,
} from "../context/requestContext";
import { parseChatAnswer } from "../message/chatAnswer";
import type { ExecutionSettings } from "../ai/executionSettings";
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
import { cleanupWorkspaceIfEnabled } from "../workspace/cleanup";
import { clearGeminiPollerForItem } from "./poller";
import {
  clearGeminiRunStateForItem,
  isGeminiRunActiveForItem,
  setGeminiRunStateForItem,
} from "./runState";
import { startGeminiRunForQuestion, readGeminiRunProgress } from "./runner";
import { stopGeminiRunSilently } from "./stopRun";
import { isWorkspaceRunReservedForItem } from "../ai/workspaceRun";
import type { RunProfile } from "../ai/runProfile";
import type { StructuredOutputSchema } from "../ai/structuredOutput";

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
  profile?: RunProfile;
  outputSchema?: StructuredOutputSchema;
  requestContext?: RequestContextSnapshot;
  executionSettings?: ExecutionSettings;
  turnId?: string;
  attemptId?: string;
  responseLength?: "short" | "default" | "detailed";
  onComplete?: (result: ReaderRunCompletionResult) => void | Promise<void>;
}) {
  const profile = params.profile || "chat";
  const continuingParent = Boolean(
    params.continuationToken &&
      isReaderRunTokenActive(params.itemID, params.continuationToken),
  );
  if (params.continuationToken && !continuingParent) {
    const assistantText =
      "The previous Gemini CLI run is no longer active, so this follow-up was not started.";
    if (!params.suppressChatMessages) {
      addMessage(params.chatMessages, assistantText, "ai");
    }
    params.streamingIndicator.style.display = "none";
    await params.onComplete?.({ success: false, assistantText });
    return;
  }
  if (
    isGeminiRunActiveForItem(params.itemID) ||
    ((getActiveReaderRunMode(params.itemID) ||
      getPendingEngineCompletion(params.itemID)) &&
      !continuingParent) ||
    (isWorkspaceRunReservedForItem(params.itemID) && !continuingParent) ||
    (isReaderSessionTransitionActive(params.itemID) && !continuingParent)
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
      requestContext: params.requestContext,
      executionSettings: params.executionSettings,
      turnId: params.turnId,
      attemptId: params.attemptId,
      responseLength: params.responseLength,
      selectedText: params.selectedText,
      annotationIDs: params.annotationIDs,
      resumeSessionId: params.resumeSessionId,
    });
  }

  const runToken = markReaderRunStarted(params.itemID, "gemini_cli");
  startRunProgress(params.itemID, "gemini_cli", runToken);
  let assistantMessage: HTMLElement | null | undefined = null;
  const pendingCompletion = {
    sessionId: params.sessionId,
    paperTitle: params.paperTitle,
    turnId: params.turnId,
    attemptId: params.attemptId,
    mode: "gemini_cli" as const,
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
          engine: "gemini_cli",
          engineLabel: "Gemini CLI",
          token: runToken,
          workspacePath: pendingCompletion.workspacePath,
          suppressMessage: params.suppressChatMessages,
          stop: () =>
            stopGeminiRunSilently({
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

  let preparingWorkspacePath: string | undefined;
  const prepare = async () => {
    if (params.turnId && params.attemptId)
      await sessionHistoryService.updateAttempt({
        itemID: params.itemID,
        paperTitle: params.paperTitle || params.sessionTitle,
        turnId: params.turnId,
        attemptId: params.attemptId,
        state: "running",
      });
    return startGeminiRunForQuestion({
      itemID: params.itemID,
      title: params.paperTitle || params.sessionTitle,
      paperTitle: params.paperTitle,
      requestContext: params.requestContext,
      executionSettings: params.executionSettings,
      responseLength: params.responseLength,
      shouldContinue: () =>
        isReaderRunTokenActive(params.itemID, runToken) &&
        !getPendingEngineCompletion(params.itemID)?.terminalClaim,
      onWorkspaceAllocated: (path) => {
        preparingWorkspacePath = path;
      },
      sessionId: params.sessionId,
      question: params.question,
      selectedText: params.selectedText,
      annotationIDs: params.annotationIDs,
      resumeSessionId: params.resumeSessionId,
      profile,
      outputSchema: params.outputSchema,
    });
  };
  const result = await prepare().catch(async (error) => {
    cancelTimeout();
    if (preparingWorkspacePath)
      await cleanupWorkspaceIfEnabled(preparingWorkspacePath);
    if (!isReaderRunTokenActive(params.itemID, runToken)) {
      markPendingEnginePreparationSettled(params.itemID, runToken);
      return undefined;
    }
    if (!claimPendingEngineCompletion(params.itemID, runToken, "controller")) {
      return undefined;
    }
    markPendingEnginePreparationSettled(params.itemID, runToken);
    const detail = error instanceof Error ? error.message : String(error);
    const failedProgress = failRunProgress({
      itemID: params.itemID,
      engine: "gemini_cli",
      token: runToken,
      rawError: detail,
      source: "workspace",
      canRetry: !params.suppressChatMessages,
    });
    const assistantText =
      failedProgress?.failure?.userMessage ?? "Gemini CLI run failed.";
    try {
      await sessionHistoryService
        .persistAssistantTurn({
          turnId: params.turnId,
          attemptId: params.attemptId,
          requestContext: params.requestContext,
          executionSettings: params.executionSettings,
          responseLength: params.responseLength,
          itemID: params.itemID,
          sessionId: params.sessionId,
          mode: "gemini_cli",
          paperTitle: params.paperTitle || params.sessionTitle,
          assistantText,
          success: false,
          rawEvent: detail,
          suppressMessage: params.suppressChatMessages,
          updateResumeMetadata: profile === "chat",
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
  if (result.ok) params.requestContext ??= result.requestContext;

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
          setGeminiRunStateForItem(params.itemID, {
            processId: result.processId,
          });
        }
        recoverLatePreparedRunStopFailure({
          itemID: params.itemID,
          engine: "gemini_cli",
          token: runToken,
          processId: result.ok ? result.processId : undefined,
          rawError: `Paper Pilot could not confirm late Gemini process termination: ${error instanceof Error ? error.message : String(error)}`,
        });
        addon.data.ztoolkit?.log(
          "Paper Pilot Gemini late-run termination failed:",
          error,
        );
      },
      onCleanupFailure: (error) =>
        addon.data.ztoolkit?.log(
          "Paper Pilot Gemini late-run cleanup failed:",
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
  advanceRunProgress(params.itemID, runToken, {
    type: "spawned",
    processId: result.processId,
  });
  const poller = setInterval(async () => {
    const progress = await readGeminiRunProgress({
      outputPath: result.outputPath,
      stderrPath: result.stderrPath,
      exitCodePath: result.exitCodePath,
    });

    if (!isReaderRunTokenActive(params.itemID, runToken)) return;

    if (!progress.completed) {
      if (assistantMessage) {
        const partial =
          progress.structuredOutput && progress.parsedOutput
            ? profile === "chat"
              ? parseChatAnswer(progress.parsedOutput, { partial: true })
                  .answerMarkdown
              : progress.parsedOutput
            : "";
        if (partial && result.timings && !result.timings.firstAssistantAt)
          result.timings.firstAssistantAt = Date.now();
        setMessageContent(
          assistantMessage,
          partial || "Running Gemini CLI…",
          "ai",
        );
      }
      return;
    }

    if (!claimPendingEngineCompletion(params.itemID, runToken, "controller")) {
      return;
    }

    setGeminiRunStateForItem(params.itemID, {});
    clearGeminiPollerForItem(params.itemID);
    advanceRunProgress(params.itemID, runToken, { type: "finishing" });

    const rawAssistantText =
      progress.parsedOutput ||
      "Gemini CLI ran successfully, but returned no assistant message.";
    let success =
      progress.exitCode === "0" &&
      !progress.providerFailed &&
      Boolean(progress.parsedOutput?.trim());
    const parsedAnswer =
      profile === "chat"
        ? parseChatAnswer(rawAssistantText, {
            allowedSourceIDs: new Set(
              result.requestContext ? [result.requestContext.sourceID] : [],
            ),
          })
        : { answerMarkdown: rawAssistantText, citationCandidates: [] };
    let sourceChanged = false;
    if (success && result.requestContext) {
      try {
        await assertRequestContextCurrent(result.requestContext);
      } catch {
        sourceChanged = true;
        success = false;
      }
    }
    if (result.timings) {
      result.timings.finishedAt = Date.now();
      if (progress.parsedOutput && !result.timings.firstAssistantAt)
        result.timings.firstAssistantAt = result.timings.finishedAt;
    }
    const terminalFailure = success
      ? undefined
      : classifyRunFailure({
          engine: "gemini_cli",
          rawError: progress.diagnosticOutput || rawAssistantText,
          source: "process_exit",
        });
    let assistantText = success
      ? sanitizeAssistantText(parsedAnswer.answerMarkdown)
      : (terminalFailure?.userMessage ?? "Gemini CLI run failed.");

    if (sourceChanged)
      assistantText = `${sanitizeAssistantText(parsedAnswer.answerMarkdown)}\n\nThe PDF changed while this answer was generated. Its evidence needs review.`;
    if (assistantMessage) {
      setMessageContent(assistantMessage, assistantText, "ai");
    }

    try {
      await finishRunAfterCleanup({
        prepare: async () => {
          if (params.turnId && params.attemptId)
            await sessionHistoryService.updateAttempt({
              itemID: params.itemID,
              paperTitle: params.paperTitle || params.sessionTitle,
              turnId: params.turnId,
              attemptId: params.attemptId,
              state: "finishing",
            });
          await sessionHistoryService.persistAssistantTurn({
            turnId: params.turnId,
            attemptId: params.attemptId,
            requestContext: params.requestContext,
            executionSettings: params.executionSettings,
            responseLength: params.responseLength,
            itemID: params.itemID,
            sessionId: params.sessionId,
            mode: "gemini_cli",
            paperTitle: params.paperTitle || params.sessionTitle,
            assistantText,
            success,
            citationCandidates: parsedAnswer.citationCandidates,
            rawEvent: progress.rawOutput,
            resumeSessionId: progress.resumeSessionId,
            suppressMessage: params.suppressChatMessages,
            updateResumeMetadata: profile === "chat",
          });
          if (isPendingEngineCompletionCurrent(params.itemID, runToken)) {
            clearGeminiRunStateForItem(params.itemID);
          }
          params.streamingIndicator.style.display = "none";
          if (result.timings) result.timings.persistedAt = Date.now();
        },
        cleanup: () => cleanupWorkspaceIfEnabled(result.workspacePath),
        shouldComplete: () =>
          isReaderRunTokenActive(params.itemID, runToken) &&
          isPendingEngineCompletionCurrent(params.itemID, runToken),
        complete: () =>
          params.onComplete?.({
            success,
            assistantText,
            timings: result.timings,
            requestContext: result.requestContext,
            continuationToken: runToken,
          }),
        incomplete: (error) => {
          const failedProgress = failRunProgress({
            itemID: params.itemID,
            engine: "gemini_cli",
            token: runToken,
            rawError:
              error instanceof Error ? error.message : String(error || ""),
            source: "process_exit",
            canRetry: !params.suppressChatMessages,
          });
          assistantText =
            failedProgress?.failure?.userMessage ?? "Gemini CLI run failed.";
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
                engine: "gemini_cli",
                token: runToken,
                rawError:
                  terminalFailure?.rawError ||
                  progress.diagnosticOutput ||
                  rawAssistantText,
                source: "process_exit",
                canRetry: !params.suppressChatMessages,
              });
            }
            clearPendingEngineCompletion(params.itemID, runToken);
            clearGeminiRunStateForItem(params.itemID);
          }
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
