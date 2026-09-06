import { handleClaudeQuestion } from "../claude/controller";
import { handleCodexQuestion } from "../codex/controller";
import { addMessage } from "../components/ChatMessage";
import { handleGeminiQuestion } from "../gemini/controller";
import { sessionHistoryService } from "../session/sessionHistoryService";
import { sessionStore } from "../session/sessionStore";
import { assertRequestContextCurrent } from "../context/requestContext";
import { getActiveReaderRunMode } from "./runPresentation";
import {
  claimRetryEngineRequest,
  getLastEngineRequest,
  getPendingEngineCompletion,
  isReaderLifecycleClaimActive,
  releaseRetryEngineRequest,
} from "./runLifecycle";

export async function retryLastEngineQuestion(params: {
  itemID: number;
  itemTitle: string;
  chatMessages: HTMLElement;
  streamingIndicator: HTMLElement;
}) {
  if (
    isReaderLifecycleClaimActive(params.itemID) ||
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
  const retryToken = claimRetryEngineRequest(params.itemID);
  if (!retryToken) return;

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

    const original = sessionHistoryService.getCurrentTurn({
      itemID: params.itemID,
      turnId: last.turnId,
    });
    const context = original?.request?.requestContext ?? last.requestContext;
    if (context) await assertRequestContextCurrent(context);
    const retry = await sessionHistoryService.startRetry({
      itemID: params.itemID,
      paperTitle: last.paperTitle || params.itemTitle,
      turnId: last.turnId,
    });
    params.streamingIndicator.style.display = "flex";
    if (sessionStore.get(params.itemID)?.sessionId !== last.sessionId) {
      addMessage(
        params.chatMessages,
        "The active session changed before Retry could start. Return to the original session and try again.",
        "ai",
      );
      params.streamingIndicator.style.display = "none";
      return;
    }
    const common = {
      itemID: params.itemID,
      sessionId: last.sessionId,
      sessionTitle: last.sessionTitle,
      paperTitle: last.paperTitle || params.itemTitle,
      question: retry.request.question,
      selectedText: context?.selectedText ?? last.selectedText,
      annotationIDs:
        context?.annotations.map((annotation) => annotation.key) ??
        last.annotationIDs,
      requestContext: context,
      executionSettings:
        retry.request.executionSettings ?? last.executionSettings,
      responseLength: retry.request.responseLength,
      turnId: retry.turn.turnId,
      attemptId: retry.attempt.id,
      chatMessages: params.chatMessages,
      streamingIndicator: params.streamingIndicator,
    };

    if (last.mode === "claude_code") {
      await handleClaudeQuestion({
        ...common,
        resumeSessionId: undefined,
      });
      return;
    }
    if (last.mode === "gemini_cli") {
      await handleGeminiQuestion({
        ...common,
        resumeSessionId: undefined,
      });
      return;
    }
    await handleCodexQuestion({
      ...common,
      useResume: false,
      resumeSessionId: undefined,
    });
  } catch (error) {
    params.streamingIndicator.style.display = "none";
    addMessage(
      params.chatMessages,
      error instanceof Error
        ? error.message
        : "Retry could not start. Edit the original question and try again.",
      "ai",
    );
  } finally {
    releaseRetryEngineRequest(params.itemID, retryToken);
  }
}
