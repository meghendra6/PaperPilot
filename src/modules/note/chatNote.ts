import type { MessageRecord } from "../message/types";
import { assertRequestContextCurrent } from "../context/requestContext";

declare const Zotero: any;
const escape = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
export async function resolveChatNoteTarget(message: MessageRecord) {
  const snapshot = message.requestContext ?? message.request?.requestContext;
  if (!snapshot)
    throw new Error(
      "This older message has no captured PDF source. Ask again before saving a source-linked note.",
    );
  await assertRequestContextCurrent(snapshot);
  const item = await Zotero.Items.getAsync(snapshot.itemID);
  if (item?.isAttachment?.())
    throw new Error(
      "Create a parent bibliographic item before saving this answer as its note.",
    );
  if (!item) throw new Error("The original source paper is unavailable.");
  return {
    itemID: Number(item.id),
    libraryID: Number(item.libraryID),
    title: String(item.getField("title") || "Untitled paper"),
    sourceID: snapshot.sourceID,
  };
}
export interface ChatNoteContext {
  question?: string;
  sessionID?: string;
}
export function buildChatNotePreview(
  message: MessageRecord,
  target: { title: string; libraryID: number; sourceID: string },
  context: ChatNoteContext = {},
): string {
  return [
    `Destination: ${target.title} (library ${target.libraryID})`,
    `Source: ${target.sourceID}`,
    `Conversation: ${context.sessionID || message.provenance?.sessionId || "unavailable"}\nMessage: ${message.id}${message.provenance ? `\nOriginal conversation: ${message.provenance.sessionId}\nOriginal message: ${message.provenance.messageId}` : ""}`,
    "AI interpretation. A matched PDF passage confirms its location, not the claim's truth.",
    `Question\n${context.question || message.request?.question || (message.role === "user" ? message.text : "Original question unavailable")}`,
    `Answer\n${message.text}`,
    `Source passages\n${message.citations?.length ? message.citations.map((citation) => `[${citation.id}] ${citation.status === "verified" ? "PDF location matched" : `Location ${citation.status}`} · ${citation.sourceID}${citation.pageIndex === undefined ? "" : ` · PDF page ${citation.pageIndex + 1}`}\n${citation.quote}`).join("\n\n") : "No locally matched passage was attached to this answer."}`,
  ].join("\n\n");
}
export function buildChatNoteHtml(
  message: MessageRecord,
  sourceTitle: string,
  context: ChatNoteContext = {},
): string {
  const snapshot = message.requestContext ?? message.request?.requestContext;
  return `<h1>Paper Pilot conversation</h1><pre>${escape(buildChatNotePreview(message, { title: sourceTitle, libraryID: snapshot?.source.libraryID ?? 0, sourceID: snapshot?.sourceID ?? "unavailable" }, context))}</pre>`;
}
export async function saveChatMessageToNote(
  message: MessageRecord,
  expected: { itemID: number; libraryID: number; sourceID: string },
  context: ChatNoteContext = {},
) {
  const target = await resolveChatNoteTarget(message);
  if (
    target.itemID !== expected.itemID ||
    target.libraryID !== expected.libraryID ||
    target.sourceID !== expected.sourceID
  )
    throw new Error("The note destination changed. Preview it again.");
  const note = new Zotero.Item("note");
  note.libraryID = target.libraryID;
  note.parentID = target.itemID;
  note.setNote(buildChatNoteHtml(message, target.title, context));
  await note.saveTx();
  return note.id as number;
}
