import { assertDocumentName, assertStudioID } from "./contracts";
import {
  MAX_BACKUP_TEXT,
  parseDocumentBackup,
  type StudioDocumentBackup,
} from "./backup";
import type {
  StudioConversation,
  StudioTurn,
  StudioChange,
} from "./aiContracts";

export interface StudioProjectContext {
  schemaVersion: 1;
  sourceProjectID: string;
  projectName: string;
  // Historical snapshots are readable records, never current Zotero source bindings.
  researchSnapshots: Array<Record<string, unknown>>;
  currentConversation: StudioConversation;
  conversations: Array<{ id: string; conversation: StudioConversation }>;
}

function boundedText(value: unknown, max: number): asserts value is string {
  if (typeof value !== "string" || value.length > max)
    throw new Error("Invalid project bundle text.");
}

export function portableConversation(
  value: unknown,
  projectID: string,
): StudioConversation {
  const data = value as StudioConversation;
  if (
    data?.schemaVersion !== 1 ||
    data.projectID !== projectID ||
    !Array.isArray(data.turns) ||
    data.turns.length > 2000
  )
    throw new Error("Invalid project conversation in the bundle.");
  const turnIDs = new Set<string>(),
    changeIDs = new Set<string>();
  const turns = data.turns.map((turn): StudioTurn => {
    assertStudioID(turn?.id);
    if (turnIDs.has(turn.id)) throw new Error("Duplicate conversation turn.");
    turnIDs.add(turn.id);
    boundedText(turn.question, 20000);
    boundedText(turn.reply, 2000000);
    boundedText(turn.model, 300);
    if (
      !Number.isFinite(Date.parse(turn.createdAt)) ||
      !["codex", "claude", "local"].includes(turn.provider) ||
      !["running", "complete", "failed", "canceled"].includes(turn.status) ||
      !Array.isArray(turn.context) ||
      turn.context.length > 30 ||
      !Array.isArray(turn.changes) ||
      turn.changes.length > 30
    )
      throw new Error("Invalid conversation turn metadata.");
    const context = turn.context.map((entry) => {
      assertStudioID(entry?.id);
      assertDocumentName(entry.name);
      if (!Number.isSafeInteger(entry.revision) || entry.revision < 1)
        throw new Error("Invalid context revision.");
      return { id: entry.id, name: entry.name, revision: entry.revision };
    });
    const changes = turn.changes.map((change): StudioChange => {
      assertStudioID(change?.id);
      if (changeIDs.has(change.id))
        throw new Error("Duplicate proposal identifier.");
      changeIDs.add(change.id);
      if (
        !["replace", "append", "draft", "create", "rename", "archive"].includes(
          change.kind,
        ) ||
        !["pending", "applied", "rejected"].includes(change.decision) ||
        !Number.isSafeInteger(change.expectedRevision) ||
        change.expectedRevision < 0
      )
        throw new Error("Invalid imported proposal.");
      boundedText(change.documentID, 128);
      boundedText(change.name, 240);
      boundedText(change.before, 1000000);
      boundedText(change.after, 1000000);
      if (change.proposedAfter !== undefined)
        boundedText(change.proposedAfter, 1000000);
      boundedText(change.reason, 20000);
      if (change.kind !== "create") assertStudioID(change.documentID);
      if (change.kind === "create" || change.kind === "rename")
        assertDocumentName(change.name);
      return {
        id: change.id,
        kind: change.kind,
        documentID: change.documentID,
        expectedRevision: change.expectedRevision,
        name: change.name,
        before: change.before,
        after: change.after,
        ...(change.proposedAfter !== undefined
          ? { proposedAfter: change.proposedAfter }
          : {}),
        reason: change.reason,
        decision: change.decision,
      };
    });
    if (turn.error !== undefined) boundedText(turn.error, 20000);
    return {
      id: turn.id,
      createdAt: turn.createdAt,
      question: turn.question,
      provider: turn.provider,
      model: turn.model,
      context,
      status: turn.status,
      reply: turn.reply,
      changes,
      ...(turn.error ? { error: turn.error } : {}),
    };
  });
  return { schemaVersion: 1, projectID, turns };
}

export function parseProjectContext(value: unknown): StudioProjectContext {
  if (JSON.stringify(value)?.length > 8 * 1024 * 1024)
    throw new Error("Project context exceeds 8 MiB.");
  const data = value as StudioProjectContext;
  if (
    data?.schemaVersion !== 1 ||
    !Array.isArray(data.researchSnapshots) ||
    data.researchSnapshots.length > 20 ||
    data.researchSnapshots.some(
      (snapshot) =>
        !snapshot || typeof snapshot !== "object" || Array.isArray(snapshot),
    ) ||
    !Array.isArray(data.conversations) ||
    data.conversations.length > 200
  )
    throw new Error("Invalid project context bundle.");
  assertStudioID(data.sourceProjectID);
  boundedText(data.projectName, 1000);
  const ids = new Set<string>();
  return {
    schemaVersion: 1,
    sourceProjectID: data.sourceProjectID,
    projectName: data.projectName,
    researchSnapshots: data.researchSnapshots,
    currentConversation: portableConversation(
      data.currentConversation,
      data.sourceProjectID,
    ),
    conversations: data.conversations.map((archive) => {
      assertStudioID(archive?.id);
      if (ids.has(archive.id))
        throw new Error("Duplicate conversation archive.");
      ids.add(archive.id);
      return {
        id: archive.id,
        conversation: portableConversation(
          archive.conversation,
          data.sourceProjectID,
        ),
      };
    }),
  };
}

export function projectBundle(
  documents: StudioDocumentBackup,
  context: StudioProjectContext,
) {
  const normalized = parseProjectContext(context);
  if (
    JSON.stringify(documents).length +
      encodeProjectText(JSON.stringify(normalized, null, 2)).length +
      65536 >
    MAX_BACKUP_TEXT
  )
    throw new Error(
      "Document history and project context exceed the 96 MiB restore limit.",
    );
  if (documents.manifest.projectID !== normalized.sourceProjectID)
    throw new Error("Project bundle identity mismatch.");
  const text = JSON.stringify({
    format: "paperpilot-local-project",
    schemaVersion: 1,
    documents,
    context: normalized,
  });
  if (text.length > MAX_BACKUP_TEXT)
    throw new Error("Project bundles must be at most 96 MiB.");
  return text;
}

export function assertProjectSnapshotRevision(
  documents: StudioDocumentBackup,
  currentRevision: number,
) {
  const captured = documents.manifest;
  if (
    captured.revision !== currentRevision &&
    !(
      currentRevision === 0 &&
      captured.revision === 1 &&
      captured.documents.length === 0
    )
  )
    throw new Error(
      "Project documents changed while collecting the backup. Export again after saving current work.",
    );
}

export function parseProjectBundle(text: string) {
  if (typeof text !== "string" || text.length > MAX_BACKUP_TEXT)
    throw new Error("Project bundles must be at most 96 MiB.");
  const data = JSON.parse(text);
  if (data?.format !== "paperpilot-local-project" || data.schemaVersion !== 1)
    throw new Error("Unsupported project bundle.");
  const documents = parseDocumentBackup(JSON.stringify(data.documents));
  const context = parseProjectContext(data.context);
  if (documents.manifest.projectID !== context.sourceProjectID)
    throw new Error("Project bundle identity mismatch.");
  return { documents, context };
}

export function encodeProjectText(text: string) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 32768)
    binary += String.fromCharCode(...bytes.subarray(index, index + 32768));
  return btoa(binary);
}
