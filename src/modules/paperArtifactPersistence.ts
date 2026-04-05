import {
  buildPaperArtifactExportPayload,
  type SerializedPaperArtifactExport,
} from "./paperArtifactSerialization";
import type { PaperArtifactCard } from "./paperArtifacts";
import {
  buildReusableArtifactPayload,
  type ReusableArtifactPayload,
} from "./paperArtifactReuse";

export interface CollectionLinkedArtifactPlan {
  exportPayload: SerializedPaperArtifactExport;
  reusableArtifacts: ReusableArtifactPayload[];
}

export interface CollectionLinkedArtifactEntryState {
  enabled: boolean;
  reason: string;
  cardCount: number;
}

export function buildCollectionLinkedArtifactPlan(params: {
  sourceItemID: number;
  sourceTitle: string;
  collectionID: number;
  collectionName?: string;
  cards: PaperArtifactCard[];
  exportedAt?: string;
}): CollectionLinkedArtifactPlan {
  return {
    exportPayload: buildPaperArtifactExportPayload({
      sourceItemID: params.sourceItemID,
      collectionID: params.collectionID,
      cards: params.cards,
      exportedAt: params.exportedAt,
    }),
    reusableArtifacts: params.cards.map((card) =>
      buildReusableArtifactPayload({
        parentTitle: params.sourceTitle,
        card,
        collectionName: params.collectionName,
      }),
    ),
  };
}

export function getCollectionLinkedArtifactEntryState(params: {
  collectionID?: number;
  cards: PaperArtifactCard[];
}): CollectionLinkedArtifactEntryState {
  const cardCount = params.cards.length;
  if (!cardCount) {
    return {
      enabled: false,
      reason: "Need at least one artifact card before saving reusable output.",
      cardCount: 0,
    };
  }

  if (typeof params.collectionID !== "number") {
    return {
      enabled: false,
      reason:
        "Choose a collection before saving a collection-linked artifact set.",
      cardCount,
    };
  }

  return {
    enabled: true,
    reason:
      cardCount === 1
        ? "Ready to save 1 artifact into the selected collection."
        : `Ready to save ${cardCount} artifacts into the selected collection.`,
    cardCount,
  };
}
