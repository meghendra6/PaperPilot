import { getPref } from "../utils/prefs";
import type { ResearchBriefQuery } from "./researchBrief";
import {
  buildResearchBriefQuestion,
  parseResearchBriefResponse,
} from "./researchBrief";
import {
  buildPaperToolQuestion,
  getPaperToolPreset,
  parsePaperToolResponse,
  type PaperToolPresetID,
} from "./paperTools";
import { normalizeResponseLanguage } from "./translation/responseLanguage";

export type PaperArtifactKind =
  | "research-brief"
  | "paper-compare"
  | PaperToolPresetID;

export interface PaperArtifactSection {
  heading: string;
  items: string[];
  evidence?: "explicit" | "inference" | "mixed";
}

export interface PaperArtifactCard {
  kind: PaperArtifactKind;
  title: string;
  summary: string;
  sections: PaperArtifactSection[];
  searchQueries?: ResearchBriefQuery[];
  sourceLabel: string;
  updatedAt: string;
}

export interface PaperArtifactRequest {
  kind: PaperArtifactKind;
  label: string;
  prompt: string;
}

export interface PaperArtifactEvidencePresentation {
  label: string;
  tone: "neutral" | "grounded" | "caution";
}

export interface PaperArtifactCardMetrics {
  sectionCount: number;
  itemCount: number;
  hasInferenceContent: boolean;
  hasExplicitContent: boolean;
  hasSearchQueries: boolean;
}

export function getPaperArtifactEvidencePresentation(
  evidence?: PaperArtifactSection["evidence"],
): PaperArtifactEvidencePresentation {
  switch (evidence) {
    case "explicit":
      return {
        label: "Directly grounded in the paper",
        tone: "grounded",
      };
    case "inference":
      return {
        label: "Model inference / extrapolation",
        tone: "caution",
      };
    case "mixed":
      return {
        label: "Mixed evidence: paper-grounded + inference",
        tone: "neutral",
      };
    default:
      return {
        label: "Evidence labeling unavailable",
        tone: "neutral",
      };
  }
}

export function getPaperArtifactCardMetrics(
  card: PaperArtifactCard,
): PaperArtifactCardMetrics {
  const evidences = card.sections.map((section) => section.evidence);
  return {
    sectionCount: card.sections.length,
    itemCount: card.sections.reduce(
      (total, section) => total + section.items.length,
      0,
    ),
    hasInferenceContent: evidences.some(
      (evidence) => evidence === "inference" || evidence === "mixed",
    ),
    hasExplicitContent: evidences.some(
      (evidence) => evidence === "explicit" || evidence === "mixed",
    ),
    hasSearchQueries: Boolean(card.searchQueries?.length),
  };
}

function buildResearchBriefCard(raw: string): PaperArtifactCard {
  const brief = parseResearchBriefResponse(raw);
  const sections: PaperArtifactSection[] = [
    {
      heading: "Contributions",
      items: brief.contributions,
      evidence: "explicit" as const,
    },
    {
      heading: "Methods",
      items: brief.methods,
      evidence: "explicit" as const,
    },
    {
      heading: "Limitations",
      items: brief.limitations,
      evidence: "mixed" as const,
    },
    {
      heading: "Follow-up questions",
      items: brief.followUpQuestions,
      evidence: "inference" as const,
    },
  ].filter((section) => section.items.length);

  return {
    kind: "research-brief",
    title: "Research brief",
    summary: brief.summary,
    sections,
    searchQueries: brief.searchQueries,
    sourceLabel:
      "Grounded in the active paper context. Limitations and follow-ups may include model-assisted inference.",
    updatedAt: new Date().toISOString(),
  };
}

function buildPaperToolCard(
  raw: string,
  presetID: PaperToolPresetID,
): PaperArtifactCard {
  const preset = getPaperToolPreset(presetID);
  if (!preset) {
    throw new Error(`Unknown paper tool preset: ${presetID}`);
  }
  const result = parsePaperToolResponse(raw, presetID);
  return {
    kind: presetID,
    title: preset.label,
    summary: result.overview,
    sections: result.sections.map((section) => ({
      heading: section.heading,
      items: section.bullets,
      evidence: section.evidence,
    })),
    sourceLabel:
      "Evidence labels distinguish direct paper claims from model inference.",
    updatedAt: new Date().toISOString(),
  };
}

export function buildPaperArtifactRequest(
  item: Pick<any, "getField" | "getCreators">,
  kind: PaperArtifactKind,
): PaperArtifactRequest {
  const responseLanguage = normalizeResponseLanguage(
    "Zotero" in globalThis ? getPref("responseLanguage") : undefined,
  );
  if (kind === "research-brief") {
    return {
      kind,
      label: "Research brief",
      prompt: buildResearchBriefQuestion(item, responseLanguage),
    };
  }

  if (kind === "paper-compare") {
    throw new Error(
      "paper-compare requests are built via the compare module, not the generic artifact request builder.",
    );
  }

  const preset = getPaperToolPreset(kind);
  if (!preset) {
    throw new Error(`Unknown paper tool preset: ${kind}`);
  }

  return {
    kind,
    label: preset.label,
    prompt: buildPaperToolQuestion(item, kind, responseLanguage),
  };
}

export function parsePaperArtifactCard(
  kind: PaperArtifactKind,
  raw: string,
): PaperArtifactCard {
  if (kind === "research-brief") {
    return buildResearchBriefCard(raw);
  }

  if (kind === "paper-compare") {
    throw new Error(
      "paper-compare cards are parsed via the compare module, not the generic artifact parser.",
    );
  }

  return buildPaperToolCard(raw, kind);
}
