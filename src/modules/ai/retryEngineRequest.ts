import { handleClaudeQuestion } from "../claude/controller";
import { handleCodexQuestion } from "../codex/controller";
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
  /**
   * Shows a status notice in the composer hint. Notices must stay out of the
   * transcript: the claim release rebuilds it from saved messages, which
   * would erase them, and they are not answers.
   */
  onNotice: (text: string) => void;
}) {
  if (
    isReaderLifecycleClaimActive(params.itemID) ||
    getPendingEngineCompletion(params.itemID) ||
    getActiveReaderRunMode(params.itemID)
  ) {
    params.onNotice("A run is already starting or active for this paper.");
    return;
  }
  const retryToken = claimRetryEngineRequest(params.itemID);
  if (!retryToken) return;

  try {
    const last = getLastEngineRequest(params.itemID);
    if (!last) {
      params.onNotice("No previous engine request to retry.");
      return;
    }
    if (sessionStore.get(params.itemID)?.sessionId !== last.sessionId) {
      params.onNotice(
        "Return to the session where this request failed before retrying it.",
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
      params.onNotice(
        "The active session changed before Retry could start. Return to the original session and try again.",
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
    await handleCodexQuestion({
      ...common,
      useResume: false,
      resumeSessionId: undefined,
    });
  } catch (error) {
    params.streamingIndicator.style.display = "none";
    params.onNotice(
      error instanceof Error
        ? error.message
        : "Retry could not start. Edit the original question and try again.",
    );
  } finally {
    releaseRetryEngineRequest(params.itemID, retryToken);
  }
}
