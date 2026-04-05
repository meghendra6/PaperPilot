import { buildPaperArtifactMarkdown } from "../paperArtifactSerialization";
import {
  buildWorkspaceArtifactBundle,
  type WorkspaceArtifactBundle,
} from "../workspace/artifactBundle";
import type { PaperArtifactCard } from "../paperArtifacts";
import { chooseCollectionForRecommendation } from "../relatedRecommendations";

type NoteParentCandidate = {
  id: number;
  libraryID: number;
  isAttachment?: () => boolean;
  parentItemID?: number | false;
  getField?: (field: string) => unknown;
};

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function resolveNoteParentItem(item: NoteParentCandidate) {
  if (!item.isAttachment?.()) {
    return item;
  }

  const parentID = item.parentItemID;
  const parent =
    parentID && "Zotero" in globalThis
      ? (
          globalThis as {
            Zotero?: { Items?: { get: (id: number) => unknown } };
          }
        ).Zotero?.Items?.get(parentID)
      : undefined;
  return (parent as NoteParentCandidate | undefined) || item;
}

export function buildPaperArtifactNoteHtml(card: PaperArtifactCard) {
  return [
    `<h1>${escapeHtml(card.title)}</h1>`,
    `<p>${escapeHtml(card.summary)}</p>`,
    `<p><strong>Source note:</strong> ${escapeHtml(card.sourceLabel)}</p>`,
    "<pre>",
    escapeHtml(buildPaperArtifactMarkdown(card)),
    "</pre>",
  ].join("");
}

function buildCollectionLinkedArtifactNoteHtml(params: {
  sourceTitle: string;
  collectionName?: string;
  bundle: WorkspaceArtifactBundle;
}) {
  const workspaceSummary = params.bundle.summary;

  const payload = JSON.stringify(
    {
      workspaceSummary,
      exportPayload: params.bundle.plan.exportPayload,
      reusableArtifacts: params.bundle.plan.reusableArtifacts,
    },
    null,
    2,
  );

  return [
    `<h1>${escapeHtml(workspaceSummary.title)}</h1>`,
    `<p>${escapeHtml(workspaceSummary.summary)}</p>`,
    `<p><strong>Source paper:</strong> ${escapeHtml(params.sourceTitle)}</p>`,
    params.collectionName
      ? `<p><strong>Collection:</strong> ${escapeHtml(params.collectionName)}</p>`
      : "",
    "<h2>Artifacts</h2>",
    "<ul>",
    ...params.bundle.plan.reusableArtifacts.map(
      (artifact) =>
        `<li><strong>${escapeHtml(artifact.title)}</strong>: ${escapeHtml(artifact.summary)}</li>`,
    ),
    "</ul>",
    "<pre>",
    escapeHtml(payload),
    "</pre>",
  ]
    .filter(Boolean)
    .join("");
}

function createNoteItem(
  zotero: { Item: new (type: string) => any },
  libraryID: number,
  noteHtml: string,
) {
  const note = new zotero.Item("note");
  note.libraryID = libraryID;
  note.setNote(noteHtml);
  return note;
}

function resolveSourceItemTitle(item: NoteParentCandidate) {
  const rawTitle = item.getField?.("title");
  if (typeof rawTitle === "string" && rawTitle.trim()) {
    return rawTitle.trim();
  }
  return "Current paper";
}

export async function savePaperArtifactToNote(params: {
  item: NoteParentCandidate;
  card: PaperArtifactCard;
}) {
  const parentItem = resolveNoteParentItem(params.item);
  const zotero = (
    globalThis as { Zotero?: { Item: new (type: string) => any } }
  ).Zotero;
  if (!zotero?.Item) {
    throw new Error("Zotero note APIs are unavailable.");
  }
  const note = new zotero.Item("note");
  note.libraryID = parentItem.libraryID;
  note.parentID = parentItem.id;
  note.setNote(buildPaperArtifactNoteHtml(params.card));
  await note.saveTx();
  return note;
}

export async function savePaperArtifactToCollection(params: {
  item: NoteParentCandidate;
  card: PaperArtifactCard;
}) {
  const zotero = (
    globalThis as {
      Zotero?: {
        Item: new (type: string) => any;
        Items?: { getAsync?: (id: number) => Promise<unknown> };
      };
    }
  ).Zotero;
  if (!zotero?.Item) {
    throw new Error("Zotero note APIs are unavailable.");
  }

  const sourceItem =
    typeof zotero.Items?.getAsync === "function"
      ? ((await zotero.Items.getAsync(params.item.id)) as NoteParentCandidate)
      : params.item;
  const collection = await chooseCollectionForRecommendation(sourceItem);
  if (!collection) {
    throw new Error(
      "Select or create a Zotero collection before saving the artifact.",
    );
  }

  const note = createNoteItem(
    zotero,
    sourceItem.libraryID,
    buildPaperArtifactNoteHtml(params.card),
  );
  await note.saveTx();
  if (typeof collection.addItems === "function") {
    await collection.addItems([note.id]);
  }
  return { note, collection };
}

export async function savePaperArtifactSetToCollection(params: {
  item: NoteParentCandidate;
  cards: PaperArtifactCard[];
}) {
  const zotero = (
    globalThis as {
      Zotero?: {
        Item: new (type: string) => any;
        Items?: { getAsync?: (id: number) => Promise<unknown> };
      };
    }
  ).Zotero;
  if (!zotero?.Item) {
    throw new Error("Zotero note APIs are unavailable.");
  }
  if (!params.cards.length) {
    throw new Error(
      "Need at least one artifact card before saving reusable output.",
    );
  }

  const sourceItem =
    typeof zotero.Items?.getAsync === "function"
      ? ((await zotero.Items.getAsync(params.item.id)) as NoteParentCandidate)
      : params.item;
  const collection = await chooseCollectionForRecommendation(sourceItem);
  if (!collection) {
    throw new Error(
      "Select or create a Zotero collection before saving the artifact.",
    );
  }

  const sourceTitle = resolveSourceItemTitle(sourceItem);
  const bundle = buildWorkspaceArtifactBundle({
    workspaceTitle: `${sourceTitle} workspace`,
    sourceItemID: sourceItem.id,
    sourceTitle,
    collectionID: collection.id,
    collectionName: collection.name,
    cards: params.cards,
  });
  const note = createNoteItem(
    zotero,
    sourceItem.libraryID,
    buildCollectionLinkedArtifactNoteHtml({
      sourceTitle,
      collectionName: collection.name,
      bundle,
    }),
  );
  await note.saveTx();
  if (typeof collection.addItems === "function") {
    await collection.addItems([note.id]);
  }
  return {
    note,
    collection,
    plan: bundle.plan,
    workspaceSummary: bundle.summary,
  };
}
