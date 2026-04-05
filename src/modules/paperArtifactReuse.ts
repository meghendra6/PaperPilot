import { buildPaperArtifactMarkdown } from "./paperArtifactSerialization";
import type { PaperArtifactCard } from "./paperArtifacts";

export interface ReusableArtifactPayload {
  title: string;
  markdown: string;
  summary: string;
  tags: string[];
  collectionHint?: string;
}

export interface ReusableArtifactSaveRecord {
  schemaVersion: 1;
  sourceItemID: number;
  collectionID?: number;
  savedAt: string;
  payload: ReusableArtifactPayload;
}

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function buildReusableArtifactTitle(params: {
  parentTitle: string;
  cardTitle: string;
  collectionName?: string;
}) {
  const parentTitle =
    normalizeWhitespace(params.parentTitle) || "Untitled paper";
  const cardTitle = normalizeWhitespace(params.cardTitle) || "Artifact";
  const collectionName = normalizeWhitespace(params.collectionName || "");
  return collectionName
    ? `[${collectionName}] ${parentTitle} — ${cardTitle}`
    : `${parentTitle} — ${cardTitle}`;
}

export function buildReusableArtifactPayload(params: {
  parentTitle: string;
  card: PaperArtifactCard;
  collectionName?: string;
}): ReusableArtifactPayload {
  const title = buildReusableArtifactTitle({
    parentTitle: params.parentTitle,
    cardTitle: params.card.title,
    collectionName: params.collectionName,
  });

  const tags = [
    "paper-artifact",
    params.card.kind,
    params.collectionName
      ? `collection:${normalizeWhitespace(params.collectionName).toLowerCase()}`
      : undefined,
  ].filter((value): value is string => Boolean(value));

  return {
    title,
    markdown: buildPaperArtifactMarkdown(params.card),
    summary: normalizeWhitespace(params.card.summary),
    tags,
    ...(params.collectionName
      ? { collectionHint: normalizeWhitespace(params.collectionName) }
      : {}),
  };
}

export function buildReusableArtifactSaveRecord(params: {
  sourceItemID: number;
  parentTitle: string;
  card: PaperArtifactCard;
  collectionID?: number;
  collectionName?: string;
  savedAt?: string;
}): ReusableArtifactSaveRecord {
  return {
    schemaVersion: 1,
    sourceItemID: params.sourceItemID,
    ...(typeof params.collectionID === "number"
      ? { collectionID: params.collectionID }
      : {}),
    savedAt: params.savedAt || new Date().toISOString(),
    payload: buildReusableArtifactPayload({
      parentTitle: params.parentTitle,
      card: params.card,
      collectionName: params.collectionName,
    }),
  };
}
