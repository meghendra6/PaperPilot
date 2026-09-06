import type { EngineMode } from "../ai/types";
import { isTerminalAttempt } from "../message/chatTypes";
import {
  sessionHistoryService,
  type SessionHistoryService,
} from "../session/sessionHistoryService";
import { sessionStore } from "../session/sessionStore";
import type { ChatDraftSubmission } from "./chatDraft";

/** Persist the admitted identity before execution, including storage-failure retries. */
export async function persistChatDraftSubmission(
  params: {
    itemID: number;
    paperTitle: string;
    mode: EngineMode;
    submission: ChatDraftSubmission;
  },
  service: SessionHistoryService = sessionHistoryService,
) {
  const { submission, itemID, paperTitle } = params;
  try {
    const existing = service.getCurrentTurn({
      itemID,
      turnId: submission.turnId,
    });
    const last = existing?.attempts?.at(-1);
    if (last && isTerminalAttempt(last.state)) {
      if (last.state === "completed")
        throw new Error(
          "This question already completed. Edit it before sending another request.",
        );
      await service.startRetry({
        itemID,
        paperTitle,
        turnId: submission.turnId,
      });
    } else {
      await service.persistUserMessage({
        itemID,
        paperTitle,
        mode: params.mode,
        text: submission.request.question,
        turnId: submission.turnId,
        request: submission.request,
      });
    }
    return sessionStore.get(itemID)!;
  } catch (error) {
    const turn = service.getCurrentTurn({ itemID, turnId: submission.turnId });
    const attempt = turn?.attempts?.at(-1);
    if (attempt && !isTerminalAttempt(attempt.state)) {
      await service
        .updateAttempt({
          itemID,
          paperTitle,
          turnId: submission.turnId,
          attemptId: attempt.id,
          state: "failed",
          errorCategory: "persistence",
        })
        .catch(() => undefined);
    }
    throw error;
  }
}
