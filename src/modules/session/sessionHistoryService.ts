import {
  captureSessionSnapshot,
  applySessionSnapshot,
} from "./sessionSnapshot";
import {
  sessionHistoryRepository,
  SessionHistoryRepository,
} from "./sessionHistoryRepository";
import { sessionStore } from "./sessionStore";
import { messageStore } from "../message/messageStore";
import type { EngineMode } from "../ai/types";
import { buildSessionTitle } from "./sessionTitle";
import { sanitizeAssistantText } from "../message/assistantOutput";
import type { MessageRecord } from "../message/types";
import type { ExecutionSettings } from "../ai/executionSettings";
import type { RequestContextSnapshot } from "../context/requestContext";
import {
  parseChatAnswer,
  type ChatCitationCandidate,
} from "../message/chatAnswer";
import { verifyChatCitations } from "../message/chatCitations";
import {
  cloneChatValue,
  isTerminalAttempt,
  type ChatAttemptState,
  type ChatRequestSnapshot,
  type ChatResponseLength,
} from "../message/chatTypes";
import { buildSessionContinuity } from "./continuity";
import { isLikelySilentToolMessage } from "./silentTurnFilter";
import { resolveSessionHistoryPrefs } from "./historyPrefs";
import { getPref } from "../../utils/prefs";
import {
  redactAbsolutePaths,
  redactPersistenceFields,
} from "../workspace/redaction";

declare const addon: { data: { currentSessionId?: string } } | undefined;

export interface SessionHistoryServiceOptions {
  repository?: SessionHistoryRepository;
  now?: () => Date;
}

function getAddonData() {
  const bundledData = typeof addon !== "undefined" ? addon?.data : undefined;
  const globalData = (
    globalThis as typeof globalThis & {
      addon?: { data: { currentSessionId?: string } };
    }
  ).addon?.data;
  return bundledData || globalData;
}

function trimSessionTitle(title: string) {
  return title.trim();
}

function buildAssistantMessageRecord(params: {
  sessionId: string;
  createdAt: string;
  assistantText: string;
  mode: EngineMode;
  success: boolean;
  rawEvent?: string;
  index: number;
}): MessageRecord {
  return {
    id: `${params.sessionId}-${Date.parse(params.createdAt)}-${params.index}`,
    role: "assistant",
    text: sanitizeAssistantText(params.assistantText),
    createdAt: params.createdAt,
    sourceMode: params.mode,
    status: params.success ? "done" : "error",
    ...(params.rawEvent
      ? {
          rawEvent: getPref("privacyRedactLocalFilePaths")
            ? redactAbsolutePaths(params.rawEvent)
            : params.rawEvent,
        }
      : {}),
  };
}

function applyResumeMetadata<
  T extends {
    lastCodexSessionID?: string;
    lastClaudeSessionID?: string;
    lastGeminiSessionID?: string;
  },
>(
  target: T,
  params: {
    mode: EngineMode;
    success: boolean;
    resumeSessionId?: string;
  },
) {
  const realID =
    params.resumeSessionId &&
    !["last", "latest"].includes(params.resumeSessionId) &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]{3,255}$/.test(params.resumeSessionId)
      ? params.resumeSessionId
      : undefined;
  if (!params.success || !realID) {
    if (params.mode === "codex_cli") delete target.lastCodexSessionID;
    if (params.mode === "claude_code") delete target.lastClaudeSessionID;
    if (params.mode === "gemini_cli") delete target.lastGeminiSessionID;
    return;
  }
  if (params.mode === "codex_cli" && params.success) {
    target.lastCodexSessionID = realID;
  }
  if (params.mode === "claude_code" && params.success) {
    target.lastClaudeSessionID = realID;
  }
  if (params.mode === "gemini_cli" && params.success) {
    target.lastGeminiSessionID = realID;
  }
}

function shouldPreserveSessionTitle(
  sessionTitle: string | undefined,
  createdAt: string,
  paperTitle: string,
  persistedTitle?: string,
) {
  const trimmedSessionTitle = trimSessionTitle(sessionTitle || "");
  if (!trimmedSessionTitle) {
    return false;
  }

  if (trimmedSessionTitle === trimSessionTitle(persistedTitle || "")) {
    return true;
  }

  const trimmedPaperTitle = trimSessionTitle(paperTitle);
  if (trimmedSessionTitle === trimmedPaperTitle) {
    return false;
  }

  return trimmedSessionTitle !== buildSessionTitle("", new Date(createdAt));
}

export class SessionHistoryService {
  private readonly repository: SessionHistoryRepository;
  private readonly now: () => Date;

  constructor(options: SessionHistoryServiceOptions = {}) {
    this.repository = options.repository || sessionHistoryRepository;
    this.now = options.now || (() => new Date());
  }

  ensureDraftSession(params: {
    itemID: number;
    mode: EngineMode;
    title?: string;
  }) {
    const session = sessionStore.getOrCreate(
      params.itemID,
      params.mode,
      params.title,
    );
    const data = getAddonData();
    if (data) {
      data.currentSessionId = session.sessionId;
    }
    return session;
  }

  async listSavedSessions(params: { itemID: number }) {
    return this.repository.listSessions(params.itemID);
  }

  async persistActiveSession(params: { itemID: number; paperTitle: string }) {
    const session = sessionStore.get(params.itemID);
    if (!session) {
      return undefined;
    }

    const capturedSnapshot = captureSessionSnapshot({
      session,
      now: this.now(),
    });
    if (!capturedSnapshot) {
      return undefined;
    }

    const existingSnapshot = await this.repository.readSessionSnapshot(
      params.itemID,
      session.sessionId,
    );

    const snapshot = shouldPreserveSessionTitle(
      session.threadTitle,
      session.createdAt,
      params.paperTitle,
      existingSnapshot?.title,
    )
      ? {
          ...capturedSnapshot,
          title: trimSessionTitle(session.threadTitle),
        }
      : capturedSnapshot;

    sessionStore.set({
      ...session,
      mode: snapshot.lastMode || session.mode,
      updatedAt: snapshot.updatedAt,
      lastModel: snapshot.lastModel,
      threadTitle: snapshot.title,
    });

    await this.repository.saveSessionSnapshot({
      paperItemID: params.itemID,
      paperTitle: params.paperTitle,
      snapshot,
    });

    return snapshot;
  }

  async persistUserMessage(params: {
    itemID: number;
    mode: EngineMode;
    paperTitle: string;
    text: string;
    turnId?: string;
    request?: ChatRequestSnapshot;
    requestContext?: RequestContextSnapshot;
    executionSettings?: ExecutionSettings;
    responseLength?: ChatResponseLength;
  }) {
    const session = sessionStore.touch(params.itemID, params.mode);
    const existing = params.turnId
      ? messageStore.getTurn(session.sessionId, params.turnId)
      : undefined;
    const request = cloneChatValue(
      params.request ?? {
        question: params.text,
        responseLength: params.responseLength ?? "default",
        ...(params.requestContext
          ? { requestContext: params.requestContext }
          : {}),
        ...(params.executionSettings
          ? { executionSettings: params.executionSettings }
          : {}),
      },
    );
    if (
      existing &&
      (existing.text !== params.text ||
        JSON.stringify(existing.request) !== JSON.stringify(request))
    )
      throw new Error(
        "This submitted question has changed. Edit it in a new conversation.",
      );
    const message =
      existing ??
      messageStore.append(session.sessionId, {
        role: "user",
        text: params.text,
        sourceMode: params.mode,
        status: "done",
        ...(params.turnId ? { turnId: params.turnId } : {}),
        request,
      });
    const attempt =
      (existing && existing.attempts?.at(-1)) ||
      messageStore.beginAttempt(session.sessionId, message.turnId);
    session.lastTurnId = message.turnId;
    session.lastAttemptId = attempt.id;

    await this.persistActiveSession({
      itemID: params.itemID,
      paperTitle: params.paperTitle,
    });

    return sessionStore.get(params.itemID) || session;
  }

  async persistAssistantTurn(params: {
    itemID: number;
    sessionId: string;
    mode: EngineMode;
    paperTitle: string;
    assistantText: string;
    success: boolean;
    rawEvent?: string;
    resumeSessionId?: string;
    suppressMessage?: boolean;
    updateResumeMetadata?: boolean;
    turnId?: string;
    attemptId?: string;
    requestContext?: RequestContextSnapshot;
    executionSettings?: ExecutionSettings;
    citationCandidates?: ChatCitationCandidate[];
    attemptState?: "completed" | "failed" | "cancelled" | "interrupted";
    responseLength?: ChatResponseLength;
  }) {
    const createdAt = this.now().toISOString();
    const parsed = params.suppressMessage
      ? undefined
      : parseChatAnswer(params.assistantText, {
          allowedSourceIDs: params.requestContext
            ? new Set([params.requestContext.sourceID])
            : undefined,
        });
    const assistantText = parsed?.answerMarkdown ?? params.assistantText;
    const candidates =
      params.citationCandidates ?? parsed?.citationCandidates ?? [];
    const citations =
      params.requestContext && candidates.length
        ? await verifyChatCitations(candidates, params.requestContext)
        : [];
    const session = sessionStore.get(params.itemID);

    if (!session || session.sessionId !== params.sessionId) {
      const prefs = resolveSessionHistoryPrefs();
      if (!prefs.persistHistory) return undefined;
      const snapshot = await this.repository.readSessionSnapshot(
        params.itemID,
        params.sessionId,
      );
      if (!snapshot) {
        return undefined;
      }

      const messages = [...(snapshot.messages ?? [])];
      if (
        params.attemptId &&
        messages.some((message) => message.attemptId === params.attemptId)
      )
        return snapshot;
      if (prefs.persistAssistantMessages && !params.suppressMessage) {
        messages.push(
          buildAssistantMessageRecord({
            sessionId: params.sessionId,
            createdAt,
            assistantText,
            mode: params.mode,
            success: params.success,
            rawEvent: params.rawEvent,
            index: messages.length,
          }),
        );
      }
      const added = messages.at(-1);
      if (added?.role === "assistant" && params.attemptId)
        Object.assign(added, {
          turnId: params.turnId,
          attemptId: params.attemptId,
          requestContext: cloneChatValue(params.requestContext),
          executionSettings: cloneChatValue(params.executionSettings),
          citations,
        });
      const turn = messages.find(
        (message) =>
          message.role === "user" && message.turnId === params.turnId,
      );
      const attempt = turn?.attempts?.find(
        (entry) => entry.id === params.attemptId,
      );
      if (attempt && !isTerminalAttempt(attempt.state))
        Object.assign(attempt, {
          state:
            params.attemptState ?? (params.success ? "completed" : "failed"),
          finishedAt: createdAt,
          ...(prefs.persistAssistantMessages && added?.role === "assistant"
            ? { assistantMessageId: added.id }
            : {}),
        });
      const updatedSnapshot = {
        ...snapshot,
        updatedAt: createdAt,
        lastMode: params.mode,
        messages,
      };
      if (params.updateResumeMetadata !== false) {
        applyResumeMetadata(updatedSnapshot, params);
      }
      await this.repository.saveSessionSnapshot({
        paperItemID: params.itemID,
        paperTitle: params.paperTitle,
        snapshot: getPref("privacyRedactLocalFilePaths")
          ? redactPersistenceFields(updatedSnapshot)
          : updatedSnapshot,
      });
      return updatedSnapshot;
    }

    const turn = params.suppressMessage
      ? undefined
      : messageStore.getTurn(session.sessionId, params.turnId);
    const attempt =
      turn?.attempts?.find((entry) => entry.id === params.attemptId) ??
      turn?.attempts?.at(-1);
    if (params.attemptId && attempt && isTerminalAttempt(attempt.state))
      return this.persistActiveSession({
        itemID: params.itemID,
        paperTitle: params.paperTitle,
      });
    if (!params.suppressMessage) {
      const message = messageStore.append(session.sessionId, {
        role: "assistant",
        text: assistantText,
        sourceMode: params.mode,
        status: params.success ? "done" : "error",
        ...(params.rawEvent ? { rawEvent: params.rawEvent } : {}),
        turnId: turn?.turnId ?? params.turnId,
        attemptId: attempt?.id ?? params.attemptId,
        requestContext: cloneChatValue(
          params.requestContext ?? turn?.request?.requestContext,
        ),
        executionSettings: cloneChatValue(
          params.executionSettings ?? turn?.request?.executionSettings,
        ),
        ...(citations.length ? { citations } : {}),
      });
      if (turn?.turnId && attempt)
        messageStore.transitionAttempt(
          session.sessionId,
          turn.turnId,
          attempt.id,
          params.attemptState ?? (params.success ? "completed" : "failed"),
          { assistantMessageId: message.id },
        );
    }

    if (params.updateResumeMetadata !== false) {
      sessionStore.update(
        params.itemID,
        params.mode,
        session.threadTitle,
        (existing) => {
          applyResumeMetadata(existing, params);
          existing.providerBindings ||= {};
          const key =
            params.mode === "codex_cli"
              ? "lastCodexSessionID"
              : params.mode === "claude_code"
                ? "lastClaudeSessionID"
                : "lastGeminiSessionID";
          const id = existing[key];
          existing.providerBindings[params.mode] = {
            engine: params.mode,
            ...(id && !["last", "latest"].includes(id)
              ? { sessionId: id }
              : {}),
            status:
              id && !["last", "latest"].includes(id)
                ? "verified"
                : "unavailable",
            sourceID: params.requestContext?.sourceID,
            sourceFingerprint: params.requestContext?.contentFingerprint,
            paperpilotSessionId: existing.sessionId,
          };
        },
      );
    }

    return this.persistActiveSession({
      itemID: params.itemID,
      paperTitle: params.paperTitle,
    });
  }

  getCurrentTurn(params: { itemID: number; turnId?: string }) {
    const session = sessionStore.get(params.itemID);
    return session
      ? messageStore.getTurn(session.sessionId, params.turnId)
      : undefined;
  }

  async startRetry(params: {
    itemID: number;
    paperTitle: string;
    turnId?: string;
  }) {
    const session = sessionStore.get(params.itemID);
    const turn =
      session && messageStore.getTurn(session.sessionId, params.turnId);
    if (!session || !turn?.request || !turn.turnId)
      throw new Error(
        "The original request is unavailable. Edit the question before asking again.",
      );
    const attempt = messageStore.beginAttempt(session.sessionId, turn.turnId);
    session.lastTurnId = turn.turnId;
    session.lastAttemptId = attempt.id;
    await this.persistActiveSession({
      itemID: params.itemID,
      paperTitle: params.paperTitle,
    });
    return { session, turn, attempt, request: cloneChatValue(turn.request) };
  }

  async updateAttempt(params: {
    itemID: number;
    paperTitle: string;
    turnId: string;
    attemptId: string;
    state: ChatAttemptState;
    errorCategory?: string;
  }) {
    const session = sessionStore.get(params.itemID);
    if (!session) return false;
    const updated = messageStore.transitionAttempt(
      session.sessionId,
      params.turnId,
      params.attemptId,
      params.state,
      params.errorCategory
        ? { errorCategory: params.errorCategory.slice(0, 80) }
        : {},
    );
    if (
      updated &&
      ["failed", "cancelled", "interrupted"].includes(params.state)
    ) {
      const turn = messageStore.getTurn(session.sessionId, params.turnId);
      const engine = turn?.request?.executionSettings?.mode ?? turn?.sourceMode;
      if (engine) {
        applyResumeMetadata(session, { mode: engine, success: false });
        session.providerBindings ||= {};
        session.providerBindings[engine] = {
          engine,
          status: "unavailable",
          paperpilotSessionId: session.sessionId,
          sourceID: turn?.request?.requestContext?.sourceID,
        };
      }
    }
    if (updated)
      await this.persistActiveSession({
        itemID: params.itemID,
        paperTitle: params.paperTitle,
      });
    return updated;
  }

  async forkSession(params: {
    itemID: number;
    sessionId: string;
    messageId: string;
    kind: "answer" | "edit";
    paperTitle: string;
  }) {
    const active = sessionStore.get(params.itemID);
    const snapshot =
      active?.sessionId === params.sessionId
        ? undefined
        : await this.repository.readSessionSnapshot(
            params.itemID,
            params.sessionId,
          );
    const original =
      active?.sessionId === params.sessionId
        ? active
        : snapshot
          ? {
              sessionId: snapshot.sessionId,
              itemID: params.itemID,
              mode: snapshot.lastMode ?? ("codex_cli" as const),
              createdAt: snapshot.createdAt,
              updatedAt: snapshot.updatedAt,
              threadTitle: snapshot.title,
              pins: snapshot.pins,
            }
          : undefined;
    if (!original) throw new Error("The original conversation is unavailable.");
    const allMessages = cloneChatValue(
      snapshot?.messages ?? messageStore.listRaw(params.sessionId),
    );
    let index = allMessages.findIndex(
      (message) => message.id === params.messageId,
    );
    if (index < 0) throw new Error("The branch point is unavailable.");
    if (params.kind === "edit" && allMessages[index].role === "assistant") {
      const turnId = allMessages[index].turnId;
      index = allMessages.findIndex(
        (message) => message.role === "user" && message.turnId === turnId,
      );
    }
    if (
      index < 0 ||
      (params.kind === "answer" &&
        (allMessages[index].role !== "assistant" ||
          allMessages[index].status !== "done"))
    )
      throw new Error(
        "Branch from a completed answer or edit an existing question.",
      );
    await this.persistActiveSession({
      itemID: params.itemID,
      paperTitle: params.paperTitle,
    });
    const prefs = resolveSessionHistoryPrefs();
    const branchMessages = allMessages
      .slice(0, index + (params.kind === "answer" ? 1 : 0))
      .filter(
        (message) => message.role === "user" || prefs.mode !== "prompts-only",
      )
      .map((message) => ({
        ...message,
        provenance: message.provenance ?? {
          sessionId: params.sessionId,
          messageId: message.id,
        },
      }));
    sessionStore.reset(params.itemID);
    const branch = this.ensureDraftSession({
      itemID: params.itemID,
      mode: original.mode,
      title: `${original.threadTitle} (branch)`,
    });
    branch.branch = {
      parentSessionId: params.sessionId,
      branchPointMessageId: allMessages[index].id,
      kind: params.kind,
    };
    const ids = new Set(branchMessages.map((message) => message.id));
    branch.pins = cloneChatValue(
      (original.pins ?? []).filter(
        (pin) =>
          ids.has(pin.messageId) &&
          (pin.role === "user" || prefs.mode !== "prompts-only"),
      ),
    );
    messageStore.replace(branch.sessionId, branchMessages);
    await this.persistActiveSession({
      itemID: params.itemID,
      paperTitle: params.paperTitle,
    });
    return sessionStore.get(params.itemID) || branch;
  }

  async togglePin(params: {
    itemID: number;
    messageId: string;
    paperTitle?: string;
  }) {
    const session = sessionStore.get(params.itemID);
    const message =
      session && messageStore.get(session.sessionId, params.messageId);
    if (!session || !message || message.status !== "done")
      throw new Error("Only an available completed message can be pinned.");
    session.pins ||= [];
    const exists = session.pins.some((pin) => pin.messageId === message.id);
    session.pins = exists
      ? session.pins.filter((pin) => pin.messageId !== message.id)
      : [
          ...session.pins,
          {
            id: `pin:${message.id}`,
            messageId: message.id,
            role: message.role,
            text: message.text,
            createdAt: this.now().toISOString(),
          },
        ];
    await this.persistActiveSession({
      itemID: params.itemID,
      paperTitle: params.paperTitle ?? session.threadTitle,
    });
    return !exists;
  }

  async setSummary(params: {
    itemID: number;
    text: string;
    basedOnMessageId: string;
    sourceFingerprint: string;
    paperTitle?: string;
  }) {
    const session = sessionStore.get(params.itemID);
    if (
      !session ||
      !messageStore.get(session.sessionId, params.basedOnMessageId)
    )
      throw new Error(
        "The conversation changed before summarization completed.",
      );
    if (resolveSessionHistoryPrefs().mode === "prompts-only")
      throw new Error(
        "Conversation summaries are unavailable in prompts-only mode.",
      );
    session.summary = {
      text: params.text.slice(0, 12_000),
      basedOnMessageId: params.basedOnMessageId,
      sourceFingerprint: params.sourceFingerprint,
      createdAt: this.now().toISOString(),
      author: "model",
    };
    await this.persistActiveSession({
      itemID: params.itemID,
      paperTitle: params.paperTitle ?? session.threadTitle,
    });
    return session.summary;
  }

  getContinuityContext(params: {
    itemID: number;
    sourceFingerprint?: string;
    maxChars?: number;
  }) {
    return buildSessionContinuity({
      sessionId: sessionStore.get(params.itemID)?.sessionId ?? "",
      ...params,
    });
  }

  async searchMessages(params: {
    itemID: number;
    query: string;
    scope?: "current" | "saved" | "all";
  }) {
    const query = params.query.trim().normalize("NFKC").toLocaleLowerCase();
    if (!query) return [];
    const active = sessionStore.get(params.itemID);
    const sessions = new Map<
      string,
      { title: string; messages: MessageRecord[] }
    >();
    if (params.scope !== "saved" && active)
      sessions.set(active.sessionId, {
        title: active.threadTitle,
        messages: messageStore.listRaw(active.sessionId),
      });
    if (
      params.scope !== "current" &&
      resolveSessionHistoryPrefs().persistHistory
    ) {
      for (const entry of await this.repository.listSessions(params.itemID)) {
        if (sessions.has(entry.sessionId)) continue;
        const snapshot = await this.repository.readSessionSnapshot(
          params.itemID,
          entry.sessionId,
        );
        if (snapshot)
          sessions.set(entry.sessionId, {
            title: snapshot.title,
            messages: snapshot.messages ?? [],
          });
      }
    }
    const prefs = resolveSessionHistoryPrefs();
    return [...sessions].flatMap(([sessionId, session]) =>
      session.messages
        .filter(
          (message) =>
            (message.role === "user" || prefs.mode !== "prompts-only") &&
            !isLikelySilentToolMessage(message) &&
            message.text.normalize("NFKC").toLocaleLowerCase().includes(query),
        )
        .map((message) => ({
          sessionId,
          title: session.title,
          messageId: message.id,
          text: message.text,
          role: message.role,
        })),
    );
  }

  async openSavedSession(params: { itemID: number; sessionId: string }) {
    const snapshot = await this.repository.readSessionSnapshot(
      params.itemID,
      params.sessionId,
    );
    if (!snapshot) {
      return undefined;
    }

    const session = applySessionSnapshot(snapshot);
    sessionStore.set(session);
    const data = getAddonData();
    if (data) {
      data.currentSessionId = session.sessionId;
    }
    return session;
  }

  async renameSavedSession(params: {
    itemID: number;
    sessionId: string;
    title: string;
  }) {
    const snapshot = await this.repository.readSessionSnapshot(
      params.itemID,
      params.sessionId,
    );
    const title = trimSessionTitle(params.title);
    if (!snapshot || !title) {
      return undefined;
    }

    const renamedSnapshot = {
      ...snapshot,
      title,
      updatedAt: this.now().toISOString(),
    };
    const index = await this.repository.readPaperIndex(params.itemID);
    await this.repository.saveSessionSnapshot({
      paperItemID: params.itemID,
      paperTitle: index.paperTitle,
      snapshot: renamedSnapshot,
    });

    const activeSession = sessionStore.get(params.itemID);
    if (activeSession?.sessionId === params.sessionId) {
      sessionStore.set({
        ...activeSession,
        threadTitle: title,
        updatedAt: renamedSnapshot.updatedAt,
      });
    }

    return renamedSnapshot;
  }

  async deleteSavedSession(params: { itemID: number; sessionId: string }) {
    await this.repository.deleteSession(params.itemID, params.sessionId);
    const activeSession = sessionStore.get(params.itemID);
    if (activeSession?.sessionId === params.sessionId) {
      sessionStore.reset(params.itemID, activeSession.mode);
      const data = getAddonData();
      if (data?.currentSessionId === params.sessionId) {
        data.currentSessionId = undefined;
      }
    }
  }

  async deleteAllSavedSessions(params: { itemID: number }) {
    await this.repository.deleteAllSessions(params.itemID);
    const activeSession = sessionStore.get(params.itemID);
    if (activeSession) {
      sessionStore.reset(params.itemID, activeSession.mode);
    }
    const data = getAddonData();
    if (data) {
      data.currentSessionId = undefined;
    }
  }

  async startNewSessionDraft(params: {
    itemID: number;
    mode: EngineMode;
    paperTitle: string;
  }) {
    await this.persistActiveSession({
      itemID: params.itemID,
      paperTitle: params.paperTitle,
    });
    sessionStore.reset(params.itemID, params.mode);
    return this.ensureDraftSession({
      itemID: params.itemID,
      mode: params.mode,
      title: params.paperTitle,
    });
  }
}

export const sessionHistoryService = new SessionHistoryService();
