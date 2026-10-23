import { assertStudioID } from "./contracts";

export interface BoardCard {
  id: string;
  title: string;
  description: string;
  columnID: string;
  labels: string[];
  documentIDs: string[];
  archived: boolean;
  [key: string]: unknown;
}
export interface StudioBoard {
  schemaVersion: 1;
  columns: Array<{ id: string; title: string; [key: string]: unknown }>;
  cards: BoardCard[];
  [key: string]: unknown;
}
export function newBoard(): StudioBoard {
  return {
    schemaVersion: 1,
    columns: [
      { id: "planned", title: "Planned" },
      { id: "in-progress", title: "In progress" },
      { id: "done", title: "Done" },
    ],
    cards: [],
  };
}
export function parseBoard(source: string): StudioBoard {
  const data = JSON.parse(source) as StudioBoard;
  if (
    data?.schemaVersion !== 1 ||
    !Array.isArray(data.columns) ||
    !data.columns.length ||
    data.columns.length > 30 ||
    !Array.isArray(data.cards) ||
    data.cards.length > 2000
  )
    throw new Error("Unsupported board format. The source is preserved.");
  const columns = new Set<string>();
  const ids = new Set<string>();
  for (const column of data.columns) {
    assertStudioID(column?.id);
    if (
      columns.has(column.id) ||
      typeof column.title !== "string" ||
      !column.title.trim()
    )
      throw new Error("Invalid or duplicate board column.");
    columns.add(column.id);
  }
  for (const card of data.cards) {
    assertStudioID(card?.id);
    if (
      ids.has(card.id) ||
      typeof card.title !== "string" ||
      typeof card.description !== "string" ||
      !columns.has(card.columnID) ||
      typeof card.archived !== "boolean" ||
      !Array.isArray(card.labels) ||
      card.labels.some((label) => typeof label !== "string") ||
      !Array.isArray(card.documentIDs)
    )
      throw new Error("Invalid board card.");
    card.documentIDs.forEach(assertStudioID);
    ids.add(card.id);
  }
  return data;
}
export function moveCard(
  board: StudioBoard,
  id: string,
  columnID: string,
  beforeID?: string,
) {
  const card = board.cards.find((card) => card.id === id);
  if (!card || !board.columns.some((column) => column.id === columnID))
    throw new Error("The card or column no longer exists.");
  if (beforeID === id) return;
  if (
    beforeID &&
    !board.cards.some(
      (target) => target.id === beforeID && target.columnID === columnID,
    )
  )
    throw new Error("The drop target is no longer in this column.");
  board.cards = board.cards.filter((entry) => entry.id !== id);
  card.columnID = columnID;
  const at = beforeID
    ? board.cards.findIndex((entry) => entry.id === beforeID)
    : -1;
  board.cards.splice(at < 0 ? board.cards.length : at, 0, card);
}
