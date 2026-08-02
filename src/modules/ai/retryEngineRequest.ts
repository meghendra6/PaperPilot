import { handleClaudeQuestion } from "../claude/controller";
import { handleCodexQuestion } from "../codex/controller";
import { addMessage } from "../components/ChatMessage";
import { handleGeminiQuestion } from "../gemini/controller";
import { sessionHistoryService } from "../session/sessionHistoryService";
import { getLastEngineRequest } from "./runLifecycle";

export async function retryLastEngineQuestion(params: {
  itemID: number;
  itemTitle: string;
  chatMessages: HTMLElement;
  streamingIndicator: HTMLElement;
}) {
  const last = getLastEngineRequest(params.itemID);
  if (!last) {
    addMessage(
      params.chatMessages,
      "No previous engine request to retry.",
      "ai",
    );
    return;
  }

  addMessage(params.chatMessages, last.question, "user");
  params.streamingIndicator.style.display = "flex";
  const session = await sessionHistoryService.persistUserMessage({
    itemID: params.itemID,
    mode: last.mode,
    paperTitle: params.itemTitle,
    text: last.question,
  });
  const common = {
    itemID: params.itemID,
    sessionId: session.sessionId,
    sessionTitle: session.threadTitle,
    paperTitle: params.itemTitle,
    question: last.question,
    selectedText: last.selectedText,
    annotationIDs: last.annotationIDs,
    chatMessages: params.chatMessages,
    streamingIndicator: params.streamingIndicator,
  };

  if (last.mode === "claude_code") {
    await handleClaudeQuestion({
      ...common,
      resumeSessionId: session.lastClaudeSessionID,
    });
    return;
  }
  if (last.mode === "gemini_cli") {
    await handleGeminiQuestion({
      ...common,
      resumeSessionId: session.lastGeminiSessionID,
    });
    return;
  }
  await handleCodexQuestion({
    ...common,
    useResume: Boolean(session.lastCodexSessionID),
    resumeSessionId: session.lastCodexSessionID,
  });
}
