import type { ResearchWorkspaceArtifactType } from "./contracts";

export interface ResearchWorkspaceArtifactPayloadValidationContext {
  projectID: string;
  sourceIDs: readonly string[];
  membersRevision: number;
  artifactInputs: readonly Record<string, unknown>[];
}

export type ResearchWorkspaceArtifactPayloadValidator = (
  payload: unknown,
  context: ResearchWorkspaceArtifactPayloadValidationContext,
) => void;

const validators = new Map<
  ResearchWorkspaceArtifactType,
  ResearchWorkspaceArtifactPayloadValidator
>();

export function registerResearchWorkspaceArtifactPayloadValidator(
  artifactType: ResearchWorkspaceArtifactType,
  validator: ResearchWorkspaceArtifactPayloadValidator,
) {
  validators.set(artifactType, validator);
}

export function validateRegisteredResearchWorkspaceArtifactPayload(
  artifactType: ResearchWorkspaceArtifactType,
  payload: unknown,
  context: ResearchWorkspaceArtifactPayloadValidationContext,
) {
  validators.get(artifactType)?.(payload, context);
}
