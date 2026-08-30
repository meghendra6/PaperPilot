import {
  getResearchWorkspaceCapability,
  type ResearchWorkspaceCapabilityID,
} from "./capabilityRegistry";
import type {
  ResearchProject,
  ResearchWorkspaceProjectTemplateAssumption,
  ResearchWorkspaceProjectTemplateSnapshot,
} from "./persistence/contracts";

export const RESEARCH_PROJECT_TEMPLATE_REGISTRY_VERSION = 1 as const;

export type ResearchWorkspaceProjectTemplateID =
  | "exploratory-literature-review"
  | "systematic-review"
  | "reproduction-project"
  | "technology-comparison"
  | "paper-reading-group";

export interface ResearchWorkspaceProjectTemplateDefinition {
  templateID: ResearchWorkspaceProjectTemplateID;
  templateVersion: number;
  name: string;
  description: string;
  suggestedResearchQuestion: string;
  assumptions: ResearchWorkspaceProjectTemplateAssumption[];
  capabilityPresetIDs: string[];
}

export interface ResearchWorkspaceProjectTemplatePreview {
  template: ResearchWorkspaceProjectTemplateDefinition;
  projectName: string;
  description: string;
  researchQuestion: string;
  assumptions: ResearchWorkspaceProjectTemplateAssumption[];
  capabilityPresetIDs: string[];
}

function clone<T>(value: T): T {
  return typeof globalThis.structuredClone === "function"
    ? globalThis.structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const entry of Object.values(value as Record<string, unknown>)) {
    deepFreeze(entry);
  }
  return value;
}

const TEMPLATE_REGISTRY = deepFreeze<
  readonly ResearchWorkspaceProjectTemplateDefinition[]
>([
  {
    templateID: "exploratory-literature-review",
    templateVersion: 1,
    name: "Exploratory literature review",
    description:
      "Map an unfamiliar field, compare terminology, and identify evidence gaps before narrowing the question.",
    suggestedResearchQuestion:
      "What concepts, methods, disagreements, and evidence gaps define this topic?",
    assumptions: [
      {
        assumptionID: "scope-flexibility",
        label: "Scope flexibility",
        value:
          "The scope may evolve as terminology and subfields become clearer.",
      },
      {
        assumptionID: "coverage-goal",
        label: "Coverage goal",
        value: "Prioritize conceptual coverage over exhaustive retrieval.",
      },
    ],
    capabilityPresetIDs: [
      "relationship-graph",
      "project-synthesis",
      "citation-context",
      "contradiction-gap-dashboard",
      "living-review",
    ],
  },
  {
    templateID: "systematic-review",
    templateVersion: 1,
    name: "Systematic review",
    description:
      "Use explicit scope, screening decisions, provenance, and repeatable evidence synthesis.",
    suggestedResearchQuestion:
      "For the predefined population, intervention, comparison, and outcomes, what does the admitted evidence show?",
    assumptions: [
      {
        assumptionID: "protocol-before-screening",
        label: "Protocol before screening",
        value:
          "Eligibility criteria are recorded before final screening decisions.",
      },
      {
        assumptionID: "exclusion-provenance",
        label: "Exclusion provenance",
        value:
          "Every exclusion requires a stage, reason, and protocol snapshot.",
      },
    ],
    capabilityPresetIDs: [
      "screening-log",
      "evidence-matrix",
      "citation-reference-health",
      "contradiction-gap-dashboard",
      "living-review",
    ],
  },
  {
    templateID: "reproduction-project",
    templateVersion: 1,
    name: "Reproduction project",
    description:
      "Track implementation assumptions, missing methodological details, and reproducibility blockers.",
    suggestedResearchQuestion:
      "Can the reported result be reproduced under the documented implementation and evaluation conditions?",
    assumptions: [
      {
        assumptionID: "target-result",
        label: "Target result",
        value:
          "Select a specific result, metric, and evaluation setting before implementation.",
      },
      {
        assumptionID: "environment-recording",
        label: "Environment recording",
        value:
          "Record code, data, dependencies, hardware, seeds, and deviations.",
      },
    ],
    capabilityPresetIDs: [
      "critical-read",
      "methodology-audit",
      "reproducibility-audit",
      "paper-to-code",
      "citation-reference-health",
      "living-review",
    ],
  },
  {
    templateID: "technology-comparison",
    templateVersion: 1,
    name: "Technology comparison",
    description:
      "Compare technologies under explicit workloads, constraints, metrics, and non-comparable conditions.",
    suggestedResearchQuestion:
      "Under which workloads and constraints does each technology provide a meaningful advantage?",
    assumptions: [
      {
        assumptionID: "comparison-dimensions",
        label: "Comparison dimensions",
        value:
          "Make workload, hardware, software, scale, metric, and quality constraints explicit.",
      },
      {
        assumptionID: "non-comparability",
        label: "Non-comparability",
        value:
          "Label results with materially different conditions as non-comparable.",
      },
    ],
    capabilityPresetIDs: [
      "quick-compare",
      "evidence-matrix",
      "relationship-graph",
      "contradiction-gap-dashboard",
      "citation-reference-health",
    ],
  },
  {
    templateID: "paper-reading-group",
    templateVersion: 1,
    name: "Paper reading group",
    description:
      "Coordinate close reading, discussion questions, citation context, and follow-up review.",
    suggestedResearchQuestion:
      "What should the group understand, challenge, and revisit after reading these papers?",
    assumptions: [
      {
        assumptionID: "reader-judgment-first",
        label: "Reader judgment first",
        value:
          "Participants record their own interpretation before generated synthesis.",
      },
      {
        assumptionID: "discussion-record",
        label: "Discussion record",
        value:
          "Keep open questions and disagreements visible for later sessions.",
      },
    ],
    capabilityPresetIDs: [
      "critical-read",
      "paper-mastery",
      "citation-context",
      "citation-stance",
      "living-review",
    ],
  },
]);

function normalizedText(value: string, label: string, maximum = 5_000) {
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
    const assumptionID = normalizedText(
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
      label: normalizedText(assumption.label, "Template assumption label", 300),
      value: normalizedText(assumption.value, "Template assumption value"),
      ...(assumption.description?.trim()
        ? {
            description: normalizedText(
              assumption.description,
              "Template assumption description",
            ),
          }
        : {}),
    };
  });
}

function normalizeCapabilityPresetIDs(
  values: readonly string[],
  requireRegistered: boolean,
) {
  if (values.length > 100) {
    throw new Error(
      "A project template supports at most 100 capability presets.",
    );
  }
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const capabilityID = normalizedText(value, "Capability preset ID", 200);
    if (!/^[a-z0-9][a-z0-9-]*$/.test(capabilityID)) {
      throw new Error(`Capability preset ID is invalid: ${capabilityID}.`);
    }
    if (requireRegistered) {
      getResearchWorkspaceCapability(
        capabilityID as ResearchWorkspaceCapabilityID,
      );
    }
    if (seen.has(capabilityID)) continue;
    seen.add(capabilityID);
    normalized.push(capabilityID);
  }
  return normalized;
}

export function normalizeResearchWorkspaceCapabilityPresetIDs(
  values: readonly string[],
) {
  return normalizeCapabilityPresetIDs(values, true);
}

export function listResearchWorkspaceProjectTemplates() {
  return clone(TEMPLATE_REGISTRY);
}

export function getResearchWorkspaceProjectTemplate(templateID: string) {
  const template = TEMPLATE_REGISTRY.find(
    (entry) => entry.templateID === templateID,
  );
  if (!template)
    throw new Error(`Unknown research project template: ${templateID}.`);
  return clone(template);
}

export function createResearchWorkspaceProjectTemplatePreview(
  templateID: string,
): ResearchWorkspaceProjectTemplatePreview {
  const template = getResearchWorkspaceProjectTemplate(templateID);
  return {
    template,
    projectName: template.name,
    description: template.description,
    researchQuestion: template.suggestedResearchQuestion,
    assumptions: clone(template.assumptions),
    capabilityPresetIDs: [...template.capabilityPresetIDs],
  };
}

export function instantiateResearchWorkspaceProjectTemplate(params: {
  preview: ResearchWorkspaceProjectTemplatePreview;
  appliedAt: string;
}) {
  const registered = getResearchWorkspaceProjectTemplate(
    params.preview.template.templateID,
  );
  if (registered.templateVersion !== params.preview.template.templateVersion) {
    throw new Error(
      "The project template preview is stale. Reopen the template selector.",
    );
  }
  if (!Number.isFinite(Date.parse(params.appliedAt))) {
    throw new Error("Template appliedAt must be an ISO date.");
  }
  const templateSnapshot: ResearchWorkspaceProjectTemplateSnapshot = {
    registryVersion: RESEARCH_PROJECT_TEMPLATE_REGISTRY_VERSION,
    templateID: registered.templateID,
    templateVersion: registered.templateVersion,
    templateName: registered.name,
    description: registered.description,
    suggestedResearchQuestion: registered.suggestedResearchQuestion,
    registryAssumptions: clone(registered.assumptions),
    registryCapabilityPresetIDs: [...registered.capabilityPresetIDs],
    appliedAt: params.appliedAt,
  };
  return {
    projectName: normalizedText(
      params.preview.projectName,
      "Project name",
      500,
    ),
    description: normalizedText(
      params.preview.description,
      "Project description",
    ),
    researchQuestion: normalizedText(
      params.preview.researchQuestion,
      "Research question",
    ),
    templateSnapshot,
    templateAssumptions: normalizeResearchWorkspaceTemplateAssumptions(
      params.preview.assumptions,
    ),
    capabilityPresetIDs: normalizeResearchWorkspaceCapabilityPresetIDs(
      params.preview.capabilityPresetIDs,
    ),
  };
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
  normalizedText(snapshot.templateID, "Template snapshot ID", 200);
  normalizedText(snapshot.templateName, "Template snapshot name", 500);
  normalizedText(snapshot.description, "Template snapshot description");
  normalizedText(
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
  normalizeCapabilityPresetIDs(snapshot.registryCapabilityPresetIDs, false);
  normalizeResearchWorkspaceTemplateAssumptions(
    project.templateAssumptions ?? [],
  );
  normalizeCapabilityPresetIDs(project.capabilityPresetIDs ?? [], false);
  return project;
}

export function updateResearchWorkspaceProjectTemplateSettings(
  project: ResearchProject,
  params: {
    assumptions: readonly ResearchWorkspaceProjectTemplateAssumption[];
    capabilityPresetIDs: readonly string[];
  },
) {
  if (!project.templateSnapshot) {
    throw new Error("This project was not created from a template.");
  }
  const updated: ResearchProject = {
    ...clone(project),
    templateAssumptions: normalizeResearchWorkspaceTemplateAssumptions(
      params.assumptions,
    ),
    capabilityPresetIDs: normalizeResearchWorkspaceCapabilityPresetIDs(
      params.capabilityPresetIDs,
    ),
  };
  validateResearchWorkspaceProjectTemplateState(updated);
  return updated;
}

export function serializeResearchWorkspaceProjectTemplateJSON(
  project: ResearchProject,
) {
  validateResearchWorkspaceProjectTemplateState(project);
  return `${JSON.stringify(
    {
      templateSnapshot: project.templateSnapshot ?? null,
      templateAssumptions: project.templateAssumptions ?? [],
      capabilityPresetIDs: project.capabilityPresetIDs ?? [],
    },
    null,
    2,
  )}\n`;
}

export function renderResearchWorkspaceProjectTemplateMarkdown(
  project: ResearchProject,
) {
  validateResearchWorkspaceProjectTemplateState(project);
  if (!project.templateSnapshot) return "## Project template\n\nNone.\n";
  const assumptions = project.templateAssumptions ?? [];
  const presets = project.capabilityPresetIDs ?? [];
  return [
    "## Project template",
    "",
    `- Template: ${project.templateSnapshot.templateName}`,
    `- Template ID: \`${project.templateSnapshot.templateID}\``,
    `- Template version: ${project.templateSnapshot.templateVersion}`,
    `- Applied at: ${project.templateSnapshot.appliedAt}`,
    "",
    "### Editable assumptions",
    assumptions.length
      ? assumptions
          .map((assumption) => `- **${assumption.label}**: ${assumption.value}`)
          .join("\n")
      : "- None.",
    "",
    "### Recommended capability presets",
    presets.length
      ? presets.map((preset) => `- \`${preset}\``).join("\n")
      : "- None.",
    "",
    "The template recommends capabilities but does not run them automatically or hide other capabilities.",
    "",
  ].join("\n");
}
