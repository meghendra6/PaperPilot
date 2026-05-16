import { addMessage, setMessageContent } from "../components/ChatMessage";
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
  onComplete?: (result: { success: boolean; assistantText: string }) => void;
}) {
  if (isClaudeRunActiveForItem(params.itemID)) {
    const assistantText =
      "A Claude Code run is already active for this paper. Wait for it to finish before starting another request.";
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

  const result = await startClaudeRunForQuestion({
    itemID: params.itemID,
    title: params.sessionTitle,
    sessionId: params.sessionId,
    question: params.question,
    selectedText: params.selectedText,
    annotationIDs: params.annotationIDs,
    resumeSessionId: params.resumeSessionId,
  });

  if (!result.ok) {
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
    params.onComplete?.({
      success: false,
      assistantText: result.error,
    });
    await cleanupWorkspaceIfEnabled(result.workspacePath);
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
    params.streamingIndicator.style.display = "none";
    params.onComplete?.({
      success,
      assistantText,
    });
    clearClaudeRunStateForItem(params.itemID);
    await cleanupWorkspaceIfEnabled(result.workspacePath);
  }, 800);

  addon.data.claudeRunPollers?.set(params.itemID, poller);
}
