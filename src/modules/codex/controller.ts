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
import { clearCodexPollerForItem } from "./poller";
import {
  buildCodexRunState,
  getCodexRunStateForItem,
  isCodexRunActiveForItem,
  setCodexRunStateForItem,
} from "./runState";
import { readCodexRunProgress, startCodexRunForQuestion } from "./runner";
import { stopCodexRunSilently } from "./stopRun";
import { classifyCodexLoginFailure } from "./statusClassification";

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
  onComplete?: (result: {
    success: boolean;
    assistantText: string;
  }) => void | Promise<void>;
}) {
  if (
    isCodexRunActiveForItem(params.itemID) ||
    getActiveReaderRunMode(params.itemID)
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

  addon.data.lastCodexRequests?.set(params.itemID, {
    sessionId: params.sessionId,
    sessionTitle: params.sessionTitle,
    paperTitle: params.paperTitle,
    question: params.question,
    selectedText: params.selectedText,
    annotationIDs: params.annotationIDs,
    useResume: params.useResume,
    resumeSessionId: params.resumeSessionId,
    suppressChatMessages: params.suppressChatMessages,
  });

  const runToken = markReaderRunStarted(params.itemID, "codex_cli");

  const result = await startCodexRunForQuestion({
    itemID: params.itemID,
    title: params.sessionTitle,
    sessionId: params.sessionId,
    question: params.question,
    selectedText: params.selectedText,
    annotationIDs: params.annotationIDs,
    useResume: params.useResume,
    resumeSessionId: params.resumeSessionId,
  }).catch(async (error) => {
    const detail = error instanceof Error ? error.message : String(error);
    const assistantText = `Codex CLI could not start: ${detail}`;
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
          const loginState = classifyCodexLoginFailure(result.error);
          if (!params.suppressChatMessages) {
            addMessage(
              params.chatMessages,
              `Codex CLI error: ${result.error}`,
              "ai",
            );
          }
          await sessionHistoryService.persistAssistantTurn({
            itemID: params.itemID,
            sessionId: params.sessionId,
            mode: "codex_cli",
            paperTitle: params.paperTitle || params.sessionTitle,
            assistantText: result.error,
            success: false,
            suppressMessage: params.suppressChatMessages,
          });
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
            assistantText: result.error,
          }),
        incomplete: () =>
          params.onComplete?.({
            success: false,
            assistantText: "Codex CLI could not finalize this run.",
          }),
        finalize: () => markReaderRunFinished(params.itemID, runToken),
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

  const assistantMessage = params.suppressChatMessages
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

  const poller = setInterval(async () => {
    const progress = await readCodexRunProgress({
      outputPath: result.outputPath,
      exitCodePath: result.exitCodePath,
    });

    if (assistantMessage) {
      const displayText = sanitizeAssistantText(
        progress.parsedOutput ||
          (progress.structuredOutput
            ? "Running Codex CLI…"
            : progress.rawOutput || "Running Codex CLI…"),
      );
      setMessageContent(assistantMessage, displayText, "ai");
    }

    if (!progress.completed) {
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

    clearCodexPollerForItem(params.itemID);

    const assistantTextRaw =
      progress.parsedOutput ||
      (!progress.structuredOutput ? progress.rawOutput : "") ||
      "Codex CLI ran successfully, but returned no assistant message.";
    const assistantText = sanitizeAssistantText(assistantTextRaw);

    if (assistantMessage) {
      setMessageContent(assistantMessage, assistantText, "ai");
    }

    const success = progress.exitCode === "0";
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

    try {
      await finishRunAfterCleanup({
        prepare: async () => {
          await sessionHistoryService.persistAssistantTurn({
            itemID: params.itemID,
            sessionId: params.sessionId,
            mode: "codex_cli",
            paperTitle: params.paperTitle || params.sessionTitle,
            assistantText,
            success,
            rawEvent: progress.rawOutput,
            resumeSessionId: resumedThreadId,
            suppressMessage: params.suppressChatMessages,
          });
          setCodexRunStateForItem(params.itemID, {
            ...buildCodexRunState({
              itemID: params.itemID,
              title: params.sessionTitle,
              loginState: success
                ? "ready"
                : classifyCodexLoginFailure(assistantText),
            }),
            processId: result.processId,
            runStatus: success ? "completed" : "error",
            latestEventType: progress.latestEventType,
          });
          params.streamingIndicator.style.display = "none";
        },
        cleanup: () => cleanupWorkspaceIfEnabled(result.workspacePath),
        shouldComplete: () => isReaderRunTokenActive(params.itemID, runToken),
        complete: () => params.onComplete?.({ success, assistantText }),
        incomplete: () =>
          params.onComplete?.({
            success: false,
            assistantText: "Codex CLI could not finalize this run.",
          }),
        finalize: () => markReaderRunFinished(params.itemID, runToken),
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
  const last = addon.data.lastCodexRequests?.get(params.itemID);
  if (!last) {
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
    useResume: last.useResume,
    suppressChatMessages: last.suppressChatMessages,
    chatMessages: params.chatMessages,
    streamingIndicator: params.streamingIndicator,
  });
}

export async function cancelCodexRun(params: {
  itemID: number;
  chatMessages: HTMLElement;
}) {
  const currentState = getCodexRunStateForItem(params.itemID);
  const hasActivePoller = addon.data.codexRunPollers?.has(params.itemID);
  if (currentState?.runStatus !== "running" || !hasActivePoller) {
    addMessage(
      params.chatMessages,
      "This Codex run is preparing or finishing and can no longer be cancelled safely.",
      "ai",
    );
    return;
  }
  const runState = await stopCodexRunSilently({
    itemID: params.itemID,
    clearRunState: false,
  });
  if (runState) {
    setCodexRunStateForItem(params.itemID, {
      ...runState,
      runStatus: "error",
      latestEventType: "cancelled",
    });
  }
  addMessage(params.chatMessages, "Codex run cancelled.", "ai");
}
