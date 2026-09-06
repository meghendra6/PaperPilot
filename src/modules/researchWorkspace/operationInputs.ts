import { researchWorkspaceArtifactPayloadFingerprint } from "./artifactFingerprint";
import { isResearchWorkspaceMemberExcluded } from "./memberState";
import type { ResearchWorkspacePaper } from "./paperSource";
import type {
  ResearchProject,
  ResearchWorkspaceArtifact,
  ResearchWorkspaceArtifactLineage,
  ResearchWorkspaceProjectMember,
  ResearchWorkspaceSourceRecord,
} from "./persistence/contracts";

export interface ProjectSemanticDetails {
  project: ResearchProject;
  members: ResearchWorkspaceProjectMember[];
  sources: ResearchWorkspaceSourceRecord[];
  artifacts: ResearchWorkspaceArtifact[];
}

export interface ProjectOperationAdmission {
  scopeFingerprint: string;
  operationInputFingerprint: string;
  artifactInputs: NonNullable<
    ResearchWorkspaceArtifactLineage["artifactInputs"]
  >;
}

export function projectScopeFingerprint(
  details: Pick<ProjectSemanticDetails, "project" | "members">,
  sourceIDs: readonly string[],
) {
  return researchWorkspaceArtifactPayloadFingerprint({
    question: details.project.researchQuestion ?? "",
    scope: details.project.scope ?? null,
    assumptions: details.project.templateAssumptions ?? [],
    comparisonQuestions:
      details.project.comparisonQuestions?.map(({ id, question }) => ({
        id,
        question,
      })) ?? [],
    sources: [...new Set(sourceIDs)].sort().map((sourceID) => {
      const member = details.members.find(
        (entry) => entry.sourceID === sourceID,
      );
      return {
        sourceID,
        present: Boolean(member),
        excluded: member ? isResearchWorkspaceMemberExcluded(member) : true,
      };
    }),
  });
}

export function projectArtifactMatchesInput(
  artifact: ResearchWorkspaceArtifact,
  input: ProjectOperationAdmission["artifactInputs"][number],
) {
  const sourceFingerprints = artifact.lineage.inputs.map(
    ({ sourceID, contentFingerprint }) => ({ sourceID, contentFingerprint }),
  );
  return (
    artifact.status === "complete" &&
    artifact.type === input.artifactType &&
    artifact.version === input.version &&
    researchWorkspaceArtifactPayloadFingerprint(artifact.payload) ===
      input.payloadFingerprint &&
    (!input.sourceIDs ||
      JSON.stringify([...input.sourceIDs].sort()) ===
        JSON.stringify([...artifact.sourceIDs].sort())) &&
    (!input.sourceFingerprints ||
      researchWorkspaceArtifactPayloadFingerprint(
        [...input.sourceFingerprints].sort((a, b) =>
          a.sourceID.localeCompare(b.sourceID),
        ),
      ) ===
        researchWorkspaceArtifactPayloadFingerprint(
          sourceFingerprints.sort((a, b) =>
            a.sourceID.localeCompare(b.sourceID),
          ),
        ))
  );
}

export function admittedProjectArtifacts(
  details: ProjectSemanticDetails,
  papers: readonly {
    sourceID: string;
    contentFingerprint: { value: string };
  }[],
) {
  const fingerprints = new Map(
    papers.map((paper) => [paper.sourceID, paper.contentFingerprint.value]),
  );
  const byID = new Map(
    details.artifacts.map((artifact) => [artifact.artifactID, artifact]),
  );
  const current = (
    artifact: ResearchWorkspaceArtifact,
    visited = new Set<string>(),
  ): boolean => {
    if (visited.has(artifact.artifactID)) return false;
    const path = new Set(visited).add(artifact.artifactID);
    return (
      artifact.status === "complete" &&
      artifact.sourceIDs.length > 0 &&
      (!artifact.lineage.scopeFingerprint ||
        artifact.lineage.scopeFingerprint ===
          projectScopeFingerprint(details, artifact.sourceIDs)) &&
      artifact.sourceIDs.every(
        (sourceID) =>
          fingerprints.has(sourceID) &&
          artifact.lineage.inputs.some(
            (input) =>
              input.sourceID === sourceID &&
              input.contentFingerprint === fingerprints.get(sourceID),
          ),
      ) &&
      artifact.lineage.inputs.every(
        (input) =>
          fingerprints.get(input.sourceID) === input.contentFingerprint,
      ) &&
      (artifact.lineage.artifactInputs ?? []).every((input) => {
        const upstream = byID.get(input.artifactID);
        return (
          upstream !== undefined &&
          current(upstream, path) &&
          projectArtifactMatchesInput(upstream, input)
        );
      })
    );
  };
  return details.artifacts.filter((artifact) => current(artifact));
}

export function createProjectOperationAdmission(
  details: ProjectSemanticDetails,
  papers: readonly ResearchWorkspacePaper[],
  operationInput: unknown,
  artifacts = admittedProjectArtifacts(details, papers),
): ProjectOperationAdmission {
  const scopeFingerprint = projectScopeFingerprint(
    details,
    papers.map((paper) => paper.sourceID),
  );
  const artifactInputs = artifacts.map((artifact) => ({
    artifactID: artifact.artifactID,
    artifactType: artifact.type,
    version: artifact.version,
    updatedAt: artifact.updatedAt,
    payloadFingerprint: researchWorkspaceArtifactPayloadFingerprint(
      artifact.payload,
    ),
    sourceIDs: [...artifact.sourceIDs],
    sourceFingerprints: artifact.lineage.inputs.map(
      ({ sourceID, contentFingerprint }) => ({ sourceID, contentFingerprint }),
    ),
  }));
  return {
    scopeFingerprint,
    artifactInputs,
    operationInputFingerprint: researchWorkspaceArtifactPayloadFingerprint({
      operationInput,
      scopeFingerprint,
      sources: papers.map((paper) => paper.sourceID).sort(),
      artifactInputs: [...artifactInputs].sort((a, b) =>
        a.artifactID.localeCompare(b.artifactID),
      ),
    }),
  };
}

/** Only admitted semantic settings belong in model input, never reading UI state. */
export function projectModelContext(
  details: Pick<ProjectSemanticDetails, "project" | "members">,
  sourceIDs: readonly string[],
) {
  const {
    projectID,
    researchQuestion,
    scope,
    comparisonQuestions,
    templateAssumptions,
  } = details.project;
  return {
    project: {
      projectID,
      researchQuestion,
      scope,
      templateAssumptions,
      comparisonQuestions: comparisonQuestions?.map(({ id, question }) => ({
        id,
        question,
      })),
    },
    sourceIDs: [...sourceIDs].sort(),
  };
}
