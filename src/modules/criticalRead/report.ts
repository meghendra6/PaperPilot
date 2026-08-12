import type { CriticalReadState } from "./types";
import type { DiscoveredPaper } from "../discovery/types";

function bullets(values: string[], empty = "Not recorded") {
  return values.length
    ? values.map((value) => `- ${value}`).join("\n")
    : `- ${empty}`;
}

export function buildCriticalReadReportMarkdown(params: {
  paperTitle: string;
  state: CriticalReadState;
}) {
  const sections = params.state.steps.map((step) => {
    const discovery = step.discovery;
    const discoveryPaper = (lane: string, paper: DiscoveredPaper) =>
      [
        `  - [${lane}] ${paper.title} — ${paper.relevanceReason}`,
        `    - Publication class: ${paper.publicationClass}; confidence: ${paper.evidenceConfidence}`,
        ...paper.publicationEvidence.map(
          (entry) =>
            `    - Evidence (${entry.supports.join(", ")}): ${entry.url}`,
        ),
      ].join("\n");
    const discovered = discovery
      ? [
          `- Verified main-conference papers: ${discovery.verifiedMain.length}`,
          `- Other peer-reviewed work: ${discovery.otherPeerReviewed.length}`,
          `- Frontier / novelty radar: ${discovery.noveltyRadar.length}`,
          ...discovery.verifiedMain.map((paper) =>
            discoveryPaper("Verified main", paper),
          ),
          ...discovery.otherPeerReviewed.map((paper) =>
            discoveryPaper("Other peer-reviewed", paper),
          ),
          ...discovery.noveltyRadar.map((paper) =>
            discoveryPaper("Novelty radar", paper),
          ),
          ...discovery.limitations.map(
            (limitation) => `  - Limitation: ${limitation}`,
          ),
        ].join("\n")
      : undefined;
    return [
      `## ${step.id}. ${step.title}`,
      step.readerInput
        ? `### Reader assessment\n\n${step.readerInput}`
        : undefined,
      step.output
        ? `### Paper Pilot synthesis\n\n${step.output.summary}`
        : undefined,
      step.output?.items.length
        ? `### Findings\n\n${bullets(step.output.items)}`
        : undefined,
      step.output?.sourceLocators.length
        ? `### Source locations\n\n${bullets(step.output.sourceLocators)}`
        : undefined,
      step.output?.limitations.length
        ? `### Limits and uncertainty\n\n${bullets(step.output.limitations)}`
        : undefined,
      step.output?.methodChecks?.length
        ? `### Method checks\n\n${step.output.methodChecks
            .map(
              (check) =>
                `- **${check.area} — ${check.status}**: ${check.finding}${check.sourceLocator ? ` (${check.sourceLocator})` : ""}`,
            )
            .join("\n")}`
        : undefined,
      step.output?.provenance?.some((entry) => entry.source === "paper_claim")
        ? `### Paper claims\n\n${bullets(
            step.output.provenance
              .filter((entry) => entry.source === "paper_claim")
              .map(
                (entry) =>
                  `${entry.text}${entry.sourceLocator ? ` (${entry.sourceLocator})` : ""}`,
              ),
          )}`
        : undefined,
      step.output?.provenance?.some(
        (entry) => entry.source === "agent_inference",
      )
        ? `### Agent inference\n\n${bullets(
            step.output.provenance
              .filter((entry) => entry.source === "agent_inference")
              .map(
                (entry) =>
                  `${entry.text}${entry.sourceLocator ? ` (${entry.sourceLocator})` : ""}`,
              ),
          )}`
        : undefined,
      step.output?.alternatives?.length
        ? `### Alternative explanations and tests\n\n${step.output.alternatives
            .map(
              (alternative) =>
                `- **Alternative:** ${alternative.explanation}\n  - Could explain: ${alternative.explainedResult}\n  - Challenges: ${alternative.challengedAssumption}\n  - Discriminating test: ${alternative.discriminatingExperiment}\n  - Addressed by paper: ${alternative.addressedByPaper}${alternative.sourceLocator ? ` (${alternative.sourceLocator})` : ""}`,
            )
            .join("\n")}`
        : undefined,
      discovered ? `### Discovery map\n\n${discovered}` : undefined,
    ]
      .filter(Boolean)
      .join("\n\n");
  });

  return [
    `# Critical Read: ${params.paperTitle}`,
    "This report preserves the reader's independent judgments separately from Paper Pilot synthesis. Public-review insights are not used in the seven-step analysis.",
    ...sections,
  ].join("\n\n");
}
