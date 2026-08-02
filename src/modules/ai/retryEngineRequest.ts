import { handleClaudeQuestion } from "../claude/controller";
import { handleCodexQuestion } from "../codex/controller";
import { addMessage } from "../components/ChatMessage";
import { handleGeminiQuestion } from "../gemini/controller";
import { sessionHistoryService } from "../session/sessionHistoryService";
import { sessionStore } from "../session/sessionStore";
import { getActiveReaderRunMode } from "./runPresentation";
import {
  getLastEngineRequest,
  getPendingEngineCompletion,
} from "./runLifecycle";

const retryClaims = new Set<number>();

export async function retryLastEngineQuestion(params: {
  itemID: number;
  itemTitle: string;
  chatMessages: HTMLElement;
  streamingIndicator: HTMLElement;
}) {
  if (
    retryClaims.has(params.itemID) ||
    getPendingEngineCompletion(params.itemID) ||
    getActiveReaderRunMode(params.itemID)
  ) {
    addMessage(
      params.chatMessages,
      "A run is already starting or active for this paper.",
      "ai",
    );
    return;
  }
  retryClaims.add(params.itemID);

  try {
    const last = getLastEngineRequest(params.itemID);
    if (!last) {
      addMessage(
        params.chatMessages,
        "No previous engine request to retry.",
        "ai",
      );
      return;
    }
    if (sessionStore.get(params.itemID)?.sessionId !== last.sessionId) {
      addMessage(
        params.chatMessages,
        "Return to the session where this request failed before retrying it.",
        "ai",
      );
      return;
    }

    addMessage(params.chatMessages, last.question, "user");
    params.streamingIndicator.style.display = "flex";
    await sessionHistoryService.persistUserMessage({
      itemID: params.itemID,
      mode: last.mode,
      paperTitle: last.paperTitle || params.itemTitle,
      text: last.question,
    });
    const common = {
      itemID: params.itemID,
      sessionId: last.sessionId,
      sessionTitle: last.sessionTitle,
      paperTitle: last.paperTitle || params.itemTitle,
      question: last.question,
      selectedText: last.selectedText,
      annotationIDs: last.annotationIDs,
      chatMessages: params.chatMessages,
      streamingIndicator: params.streamingIndicator,
    };

    if (last.mode === "claude_code") {
      await handleClaudeQuestion({
        ...common,
        resumeSessionId: last.resumeSessionId,
      });
      return;
    }
    if (last.mode === "gemini_cli") {
      await handleGeminiQuestion({
        ...common,
        resumeSessionId: last.resumeSessionId,
      });
      return;
    }
    await handleCodexQuestion({
      ...common,
      useResume: Boolean(last.useResume),
      resumeSessionId: last.resumeSessionId,
    });
  } finally {
    retryClaims.delete(params.itemID);
  }
}
