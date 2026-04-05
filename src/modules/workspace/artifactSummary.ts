import type { ReusableArtifactPayload } from "../paperArtifactReuse";

export interface WorkspaceArtifactSummary {
  schemaVersion: 1;
  title: string;
  artifactCount: number;
  artifactTitles: string[];
  collectionHints: string[];
  tags: string[];
  summary: string;
}

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function buildWorkspaceArtifactSummary(params: {
  workspaceTitle: string;
  artifacts: ReusableArtifactPayload[];
}): WorkspaceArtifactSummary {
  const title =
    normalizeWhitespace(params.workspaceTitle) || "Workspace artifacts";
  const artifactTitles = params.artifacts
    .map((artifact) => normalizeWhitespace(artifact.title))
    .filter(Boolean);
  const collectionHints = [
    ...new Set(
      params.artifacts
        .map((artifact) => normalizeWhitespace(artifact.collectionHint || ""))
        .filter(Boolean),
    ),
  ];
  const tags = [
    ...new Set(
      params.artifacts
        .flatMap((artifact) =>
          artifact.tags.map((tag) => normalizeWhitespace(tag)),
        )
        .filter(Boolean),
    ),
  ];

  const summaryParts = [
    `${artifactTitles.length} artifact${artifactTitles.length === 1 ? "" : "s"}`,
    collectionHints.length
      ? `collections: ${collectionHints.join(", ")}`
      : undefined,
  ].filter(Boolean);

  return {
    schemaVersion: 1,
    title,
    artifactCount: artifactTitles.length,
    artifactTitles,
    collectionHints,
    tags,
    summary: summaryParts.join(" · "),
  };
}
