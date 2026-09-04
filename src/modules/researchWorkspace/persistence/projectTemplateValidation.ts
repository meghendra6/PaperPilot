import type {
  ResearchProject,
  ResearchWorkspaceProjectTemplateAssumption,
} from "./contracts";

export const RESEARCH_PROJECT_TEMPLATE_REGISTRY_VERSION = 1 as const;

export function normalizeResearchWorkspaceTemplateText(
  value: string,
  label: string,
  maximum = 5_000,
) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) throw new Error(`${label} is required.`);
  if (normalized.length > maximum) throw new Error(`${label} is too long.`);
  return normalized;
}

export function normalizeResearchWorkspaceTemplateAssumptions(
  assumptions: readonly ResearchWorkspaceProjectTemplateAssumption[],
) {
  if (assumptions.length > 100) {
    throw new Error("A project template supports at most 100 assumptions.");
  }
  const seen = new Set<string>();
  return assumptions.map((assumption) => {
    const assumptionID = normalizeResearchWorkspaceTemplateText(
      assumption.assumptionID,
      "Template assumption ID",
      200,
    );
    if (!/^[a-z0-9][a-z0-9-]*$/.test(assumptionID)) {
      throw new Error(`Template assumption ID is invalid: ${assumptionID}.`);
    }
    if (seen.has(assumptionID)) {
      throw new Error(`Duplicate template assumption: ${assumptionID}.`);
    }
    seen.add(assumptionID);
    return {
      assumptionID,
      label: normalizeResearchWorkspaceTemplateText(
        assumption.label,
        "Template assumption label",
        300,
      ),
      value: normalizeResearchWorkspaceTemplateText(
        assumption.value,
        "Template assumption value",
      ),
      ...(assumption.description?.trim()
        ? {
            description: normalizeResearchWorkspaceTemplateText(
              assumption.description,
              "Template assumption description",
            ),
          }
        : {}),
    };
  });
}

export function normalizeResearchWorkspaceTemplatePresetIDs(
  values: readonly string[],
) {
  if (values.length > 100) {
    throw new Error(
      "A project template supports at most 100 capability presets.",
    );
  }
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const capabilityID = normalizeResearchWorkspaceTemplateText(
      value,
      "Capability preset ID",
      200,
    );
    if (!/^[a-z0-9][a-z0-9-]*$/.test(capabilityID)) {
      throw new Error(`Capability preset ID is invalid: ${capabilityID}.`);
    }
    if (seen.has(capabilityID)) continue;
    seen.add(capabilityID);
    normalized.push(capabilityID);
  }
  return normalized;
}

export function validateResearchWorkspaceProjectTemplateState(
  project: ResearchProject,
) {
  if (!project.templateSnapshot) {
    if (project.templateAssumptions || project.capabilityPresetIDs) {
      throw new Error(
        "Template assumptions and capability presets require a template snapshot.",
      );
    }
    return project;
  }
  const snapshot = project.templateSnapshot;
  if (snapshot.registryVersion !== RESEARCH_PROJECT_TEMPLATE_REGISTRY_VERSION) {
    throw new Error("Project template registry version is unsupported.");
  }
  normalizeResearchWorkspaceTemplateText(
    snapshot.templateID,
    "Template snapshot ID",
    200,
  );
  normalizeResearchWorkspaceTemplateText(
    snapshot.templateName,
    "Template snapshot name",
    500,
  );
  normalizeResearchWorkspaceTemplateText(
    snapshot.description,
    "Template snapshot description",
  );
  normalizeResearchWorkspaceTemplateText(
    snapshot.suggestedResearchQuestion,
    "Template snapshot research question",
  );
  if (
    !Number.isInteger(snapshot.templateVersion) ||
    snapshot.templateVersion < 1
  ) {
    throw new Error("Template snapshot version must be positive.");
  }
  if (!Number.isFinite(Date.parse(snapshot.appliedAt))) {
    throw new Error("Template snapshot appliedAt must be an ISO date.");
  }
  normalizeResearchWorkspaceTemplateAssumptions(snapshot.registryAssumptions);
  normalizeResearchWorkspaceTemplatePresetIDs(
    snapshot.registryCapabilityPresetIDs,
  );
  normalizeResearchWorkspaceTemplateAssumptions(
    project.templateAssumptions ?? [],
  );
  normalizeResearchWorkspaceTemplatePresetIDs(
    project.capabilityPresetIDs ?? [],
  );
  return project;
}
