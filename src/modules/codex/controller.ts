import { addMessage, setMessageContent } from "../components/ChatMessage";
import { sanitizeAssistantText } from "../message/assistantOutput";
import { sessionHistoryService } from "../session/sessionHistoryService";
import { clearCodexPollerForItem } from "./poller";
import { buildCodexRunState, setCodexRunStateForItem } from "./runState";
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
  onComplete?: (result: { success: boolean; assistantText: string }) => void;
}) {
  addon.data.lastCodexRequests?.set(params.itemID, {
    sessionId: params.sessionId,
    sessionTitle: params.sessionTitle,
    paperTitle: params.paperTitle,
    question: params.question,
    selectedText: params.selectedText,
    annotationIDs: params.annotationIDs,
    useResume: params.useResume,
    resumeSessionId: params.resumeSessionId,
  });

  const result = await startCodexRunForQuestion({
    itemID: params.itemID,
    title: params.sessionTitle,
    sessionId: params.sessionId,
    question: params.question,
    selectedText: params.selectedText,
    annotationIDs: params.annotationIDs,
    useResume: params.useResume,
    resumeSessionId: params.resumeSessionId,
  });

  if (!result.ok) {
    const loginState = classifyCodexLoginFailure(result.error);
    if (!params.suppressChatMessages) {
      addMessage(params.chatMessages, `Codex CLI error: ${result.error}`, "ai");
    }
    await sessionHistoryService.persistAssistantTurn({
      itemID: params.itemID,
      sessionId: params.sessionId,
      mode: "codex_cli",
      paperTitle: params.paperTitle || params.sessionTitle,
      assistantText: result.error,
      success: false,
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
    params.onComplete?.({
      success: false,
      assistantText: result.error,
    });
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

    await sessionHistoryService.persistAssistantTurn({
      itemID: params.itemID,
      sessionId: params.sessionId,
      mode: "codex_cli",
      paperTitle: params.paperTitle || params.sessionTitle,
      assistantText,
      success,
      rawEvent: progress.rawOutput,
      resumeSessionId: resumedThreadId,
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
    params.onComplete?.({
      success,
      assistantText,
    });
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
    chatMessages: params.chatMessages,
    streamingIndicator: params.streamingIndicator,
  });
}

export async function cancelCodexRun(params: {
  itemID: number;
  chatMessages: HTMLElement;
}) {
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
