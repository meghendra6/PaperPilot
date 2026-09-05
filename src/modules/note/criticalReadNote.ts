import { buildCriticalReadReportMarkdown } from "../criticalRead/report";
import type { CriticalReadState } from "../criticalRead/types";

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function buildCriticalReadNoteHtml(params: {
  paperTitle: string;
  state: CriticalReadState;
  responseLanguage?: unknown;
}) {
  return `<pre>${escapeHtml(buildCriticalReadReportMarkdown(params))}</pre>`;
}

export async function saveCriticalReadToNote(params: {
  item: {
    id: number;
    libraryID: number;
    isAttachment?: () => boolean;
    parentItemID?: number | false;
  };
  paperTitle: string;
  state: CriticalReadState;
  responseLanguage?: unknown;
}) {
  const zotero = (globalThis as { Zotero?: any }).Zotero;
  if (!zotero?.Item) throw new Error("Zotero note APIs are unavailable.");
  const parent =
    params.item.isAttachment?.() && params.item.parentItemID
      ? zotero.Items.get(params.item.parentItemID) || params.item
      : params.item.isAttachment?.()
        ? undefined
        : params.item;
  const note = new zotero.Item("note");
  note.libraryID = parent?.libraryID ?? params.item.libraryID;
  if (parent) note.parentID = parent.id;
  note.setNote(buildCriticalReadNoteHtml(params));
  await note.saveTx();
  return note;
}
