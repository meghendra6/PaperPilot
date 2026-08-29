import {
  getResearchWorkspaceItem,
  loadResearchWorkspacePaper,
  resolveResearchWorkspaceSource,
  type ResearchWorkspacePaper,
} from "./paperSource";

declare const Zotero: any;

export const RESEARCH_WORKSPACE_SELECTION_LIMIT = 12;

export type ResearchWorkspaceLaunchOrigin =
  | "tools-menu"
  | "item-context-menu"
  | "item-pane"
  | "workspace-new-selection"
  | "api";

export type ResearchWorkspaceSelectionMode = "home" | "single" | "multi";

export type ResearchWorkspaceSkipCode =
  | "no-pdf"
  | "ambiguous-pdf"
  | "not-pdf"
  | "duplicate-source"
  | "selection-limit"
  | "unavailable"
  | "load-failed"
  | "source-changed";

export interface ResearchWorkspaceSelectionCandidate {
  selectedIndex: number;
  selectedItemID: number;
  sourceID: string;
  libraryID: number;
  itemID: number;
  itemKey: string;
  attachmentID: number;
  attachmentKey: string;
  title: string;
}

export interface ResearchWorkspaceSkippedSelection {
  selectedIndex: number;
  selectedItemID?: number;
  title: string;
  code: ResearchWorkspaceSkipCode;
  reason: string;
}

export interface ResearchWorkspaceSelectionSnapshot {
  id: string;
  origin: ResearchWorkspaceLaunchOrigin;
  capturedAt: string;
  mode: ResearchWorkspaceSelectionMode;
  selectedCount: number;
  candidates: readonly ResearchWorkspaceSelectionCandidate[];
  skipped: readonly ResearchWorkspaceSkippedSelection[];
}

export interface ResearchWorkspaceSnapshotLoadResult {
  papers: readonly ResearchWorkspacePaper[];
  skipped: readonly ResearchWorkspaceSkippedSelection[];
}

let snapshotSequence = 0;

function itemID(item: any) {
  const value = Number(item?.id);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function itemTitle(item: any) {
  return String(
    item?.getField?.("title") ||
      item?.getDisplayTitle?.() ||
      "Unavailable item",
  );
}

function skipCode(error: unknown): ResearchWorkspaceSkipCode {
  const message = error instanceof Error ? error.message : String(error);
  if (/Multiple PDF attachments/i.test(message)) return "ambiguous-pdf";
  if (/No PDF attachment/i.test(message)) return "no-pdf";
  if (/not a PDF/i.test(message)) return "not-pdf";
  return "unavailable";
}

function freezeEntries<T extends object>(entries: T[]): readonly T[] {
  for (const entry of entries) Object.freeze(entry);
  return Object.freeze(entries);
}

function selectionMode(count: number): ResearchWorkspaceSelectionMode {
  if (count === 0) return "home";
  if (count === 1) return "single";
  return "multi";
}

/**
 * Captures stable Zotero identifiers at launcher activation time. The returned
 * value contains no Zotero item or DOM references and is deeply immutable.
 */
export async function captureResearchWorkspaceSelection(
  params: {
    items?: readonly any[];
    origin?: ResearchWorkspaceLaunchOrigin;
    limit?: number;
    now?: string;
  } = {},
): Promise<ResearchWorkspaceSelectionSnapshot> {
  const selected = Array.from(
    params.items ?? Zotero.getActiveZoteroPane?.()?.getSelectedItems?.() ?? [],
  );
  const limit = Math.max(
    1,
    Math.floor(params.limit ?? RESEARCH_WORKSPACE_SELECTION_LIMIT),
  );
  const candidates: ResearchWorkspaceSelectionCandidate[] = [];
  const skipped: ResearchWorkspaceSkippedSelection[] = [];
  const seen = new Set<string>();

  for (const [selectedIndex, item] of selected.slice(0, limit).entries()) {
    try {
      const resolved = await resolveResearchWorkspaceSource(item);
      if (seen.has(resolved.sourceID)) {
        skipped.push({
          selectedIndex,
          selectedItemID: itemID(item),
          title: resolved.title,
          code: "duplicate-source",
          reason:
            "This exact PDF is already present in the captured selection.",
        });
        continue;
      }
      seen.add(resolved.sourceID);
      candidates.push({
        selectedIndex,
        selectedItemID: itemID(item) ?? resolved.itemID,
        sourceID: resolved.sourceID,
        libraryID: resolved.libraryID,
        itemID: resolved.itemID,
        itemKey: resolved.itemKey,
        attachmentID: resolved.attachmentID,
        attachmentKey: resolved.attachmentKey,
        title: resolved.title,
      });
    } catch (error) {
      skipped.push({
        selectedIndex,
        selectedItemID: itemID(item),
        title: itemTitle(item),
        code: skipCode(error),
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  for (const [offset, item] of selected.slice(limit).entries()) {
    skipped.push({
      selectedIndex: limit + offset,
      selectedItemID: itemID(item),
      title: itemTitle(item),
      code: "selection-limit",
      reason: `Only the first ${limit} selected rows are captured per workspace.`,
    });
  }

  const capturedAt = params.now ?? new Date().toISOString();
  snapshotSequence += 1;
  return Object.freeze({
    id: `research-workspace-${Date.now()}-${snapshotSequence}`,
    origin: params.origin ?? "api",
    capturedAt,
    mode: selectionMode(candidates.length),
    selectedCount: selected.length,
    candidates: freezeEntries(candidates),
    skipped: freezeEntries(skipped),
  });
}

/** Loads only the exact attachment IDs recorded in an immutable snapshot. */
export async function loadResearchWorkspaceSnapshotPapers(
  snapshot: ResearchWorkspaceSelectionSnapshot,
  maxCharacters = 1_500_000,
): Promise<ResearchWorkspaceSnapshotLoadResult> {
  const papers: ResearchWorkspacePaper[] = [];
  const skipped = [...snapshot.skipped];

  for (const candidate of snapshot.candidates) {
    try {
      const attachment = await getResearchWorkspaceItem(candidate.attachmentID);
      if (!attachment) {
        throw new Error("The captured PDF attachment is no longer available.");
      }
      const paper = await loadResearchWorkspacePaper(attachment, maxCharacters);
      if (paper.sourceID !== candidate.sourceID) {
        skipped.push({
          selectedIndex: candidate.selectedIndex,
          selectedItemID: candidate.selectedItemID,
          title: candidate.title,
          code: "source-changed",
          reason:
            "The attachment identity changed after capture; it was not loaded.",
        });
        continue;
      }
      papers.push(paper);
    } catch (error) {
      skipped.push({
        selectedIndex: candidate.selectedIndex,
        selectedItemID: candidate.selectedItemID,
        title: candidate.title,
        code: "load-failed",
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return Object.freeze({
    papers: freezeEntries(papers),
    skipped: freezeEntries(skipped),
  });
}
