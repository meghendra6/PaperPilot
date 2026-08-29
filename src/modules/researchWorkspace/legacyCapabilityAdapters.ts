import {
  getResearchWorkspaceCapabilityForOperation,
  type ResearchWorkspaceCapabilityID,
} from "./capabilityRegistry";
import type { ResearchWorkspaceArtifact } from "./persistence/contracts";

export interface ReadResearchWorkspaceArtifactResult {
  artifact: ResearchWorkspaceArtifact;
  capabilityID?: ResearchWorkspaceCapabilityID;
  legacy: boolean;
  legacyOperation?: string;
}

export function readResearchWorkspaceArtifact(
  artifact: ResearchWorkspaceArtifact,
): ReadResearchWorkspaceArtifactResult {
  const definition = getResearchWorkspaceCapabilityForOperation(
    artifact.lineage.operation,
  );
  if (artifact.lineage.operation === "critical-read") {
    return {
      artifact: {
        ...artifact,
        type: "methodology-audit",
        title: "Methodology Audit (legacy)",
        lineage: { ...artifact.lineage },
      },
      capabilityID: "methodology-audit",
      legacy: true,
      legacyOperation: artifact.lineage.operation,
    };
  }
  if (
    artifact.type === "paper-mastery" &&
    (artifact.lineage.operation === "paper-mastery" ||
      artifact.lineage.operation === "paper-mastery-grade")
  ) {
    return {
      artifact: {
        ...artifact,
        title: "Paper Mastery (legacy workspace session)",
        lineage: { ...artifact.lineage },
      },
      capabilityID: "paper-mastery",
      legacy: true,
      legacyOperation: artifact.lineage.operation,
    };
  }
  const legacy = Boolean(
    definition?.legacyOperations?.includes(artifact.lineage.operation),
  );
  return {
    artifact,
    capabilityID: definition?.id,
    legacy,
    ...(legacy ? { legacyOperation: artifact.lineage.operation } : {}),
  };
}
