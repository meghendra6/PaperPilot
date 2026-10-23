/**
 * How long a reader action may wait for the paper's Paper Pilot pane. A
 * request older than this is not auto-submitted when a pane renders later,
 * so a click from minutes ago cannot start a run by surprise.
 */
export const PENDING_READER_ACTION_TTL_MS = 2 * 60_000;

export function isPendingReaderActionFresh(
  updatedAt: string | undefined,
  now = Date.now(),
): boolean {
  const queuedAt = Date.parse(String(updatedAt || ""));
  if (!Number.isFinite(queuedAt)) return false;
  return now - queuedAt <= PENDING_READER_ACTION_TTL_MS;
}

/** The reader-window message for actions that need the paper's item pane. */
export const STANDALONE_READER_ACTION_MESSAGE =
  "Open this PDF in a Zotero tab to use Paper Pilot actions.";

type ReaderWindowLike = {
  tabID?: unknown;
  _window?: { location?: { href?: string } } | null;
};

/**
 * True for Zotero's standalone reader window (ReaderWindow). It has no tab
 * and no item pane, so Paper Pilot's pane cannot show an action's answer.
 */
export function isStandaloneReaderWindow(reader: unknown): boolean {
  const candidate = reader as ReaderWindowLike | undefined;
  if (!candidate || candidate.tabID) return false;
  return Boolean(candidate._window?.location?.href?.includes("reader.xhtml"));
}
