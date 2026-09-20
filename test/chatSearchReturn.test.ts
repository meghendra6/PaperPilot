import * as assert from "node:assert/strict";
import { test } from "node:test";
import { messageStore } from "../src/modules/message/messageStore";
import { sessionStore } from "../src/modules/session/sessionStore";
import type { PaperSession } from "../src/modules/session/types";
import { getChatDraft, updateChatDraft } from "../src/modules/ui/chatDraft";
import { captureChatSearchReturn } from "../src/modules/ui/chatSearchReturn";

function session(itemID: number, sessionId: string): PaperSession {
  return {
    itemID,
    sessionId,
    mode: "codex_cli",
    threadTitle: "Paper",
    createdAt: "2026-09-21T00:00:00Z",
    updatedAt: "2026-09-21T00:00:00Z",
  };
}

test("search return restores a draft-only session and its selected PDF context without saved history", () => {
  const origin = session(1001, "draft-origin");
  const destination = session(1001, "saved-result");
  sessionStore.set(origin);
  const draft = updateChatDraft(origin.itemID, origin.sessionId, {
    text: "My unsent question",
    responseLength: "detailed",
    context: {
      attachmentID: 71,
      pageIndex: 2,
      text: "The selected passage",
    },
  });
  assert.deepEqual(messageStore.listRaw(origin.sessionId), []);
  const data: Parameters<typeof captureChatSearchReturn>[1] = {
    currentSessionId: origin.sessionId,
  };
  const restore = captureChatSearchReturn(origin, data);
  sessionStore.set(destination);
  data.currentSessionId = destination.sessionId;
  data.paperArtifactStates = new Map([[origin.itemID, { cards: ["result"] }]]);
  updateChatDraft(destination.itemID, destination.sessionId, {
    text: "A different draft",
  });

  restore();

  assert.equal(sessionStore.get(origin.itemID)?.sessionId, origin.sessionId);
  assert.equal(data.currentSessionId, origin.sessionId);
  assert.equal(data.paperArtifactStates.has(origin.itemID), false);
  assert.deepEqual(getChatDraft(origin.itemID, origin.sessionId), draft);
  assert.equal(
    getChatDraft(destination.itemID, destination.sessionId).text,
    "A different draft",
  );
});

test("search return preserves live messages and item state without replacing another paper", () => {
  const origin = session(1002, "live-origin");
  sessionStore.set(origin);
  const otherPaper = session(1003, "other-paper");
  sessionStore.set(otherPaper);
  messageStore.append(origin.sessionId, {
    role: "assistant",
    text: "An answer retained in memory",
    status: "done",
    sourceMode: "codex_cli",
  });
  const originalCards = { cards: ["original"] };
  const data = {
    currentSessionId: origin.sessionId,
    paperArtifactStates: new Map<number, unknown>([
      [origin.itemID, originalCards],
      [otherPaper.itemID, { cards: ["other"] }],
    ]),
    criticalReadStates: new Map<number, unknown>(),
    modeOverrides: new Map<number, unknown>(),
  };
  const restore = captureChatSearchReturn(origin, data);
  originalCards.cards.push("mutated after capture");
  data.paperArtifactStates.set(origin.itemID, { cards: ["result"] });
  data.criticalReadStates.set(origin.itemID, { phase: "active" });
  data.modeOverrides.set(origin.itemID, "claude_code");
  messageStore.replace(origin.sessionId, []);
  sessionStore.set(session(origin.itemID, "saved-result-2"));

  restore();

  assert.equal(
    messageStore.listRaw(origin.sessionId)[0].text,
    "An answer retained in memory",
  );
  assert.deepEqual(data.paperArtifactStates.get(origin.itemID), {
    cards: ["original"],
  });
  assert.equal(data.criticalReadStates.has(origin.itemID), false);
  assert.equal(data.modeOverrides.has(origin.itemID), false);
  assert.deepEqual(data.paperArtifactStates.get(otherPaper.itemID), {
    cards: ["other"],
  });
  assert.equal(sessionStore.get(otherPaper.itemID), otherPaper);
});
