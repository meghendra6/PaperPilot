import {
  buildCollectionLinkedArtifactPlan,
  type CollectionLinkedArtifactPlan,
} from "../paperArtifactPersistence";
import type { PaperArtifactCard } from "../paperArtifacts";
import {
  buildWorkspaceArtifactSummary,
  type WorkspaceArtifactSummary,
} from "./artifactSummary";

export interface WorkspaceArtifactBundle {
  summary: WorkspaceArtifactSummary;
  plan: CollectionLinkedArtifactPlan;
}

export function buildWorkspaceArtifactBundle(params: {
  workspaceTitle: string;
  sourceItemID: number;
  sourceTitle: string;
  collectionID: number;
  collectionName?: string;
  cards: PaperArtifactCard[];
  exportedAt?: string;
}): WorkspaceArtifactBundle {
  const plan = buildCollectionLinkedArtifactPlan({
    sourceItemID: params.sourceItemID,
    sourceTitle: params.sourceTitle,
    collectionID: params.collectionID,
    collectionName: params.collectionName,
    cards: params.cards,
    exportedAt: params.exportedAt,
  });

  return {
    summary: buildWorkspaceArtifactSummary({
      workspaceTitle: params.workspaceTitle,
      artifacts: plan.reusableArtifacts,
    }),
    plan,
  };
}
