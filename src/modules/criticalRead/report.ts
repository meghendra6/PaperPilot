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
      step.orientation
        ? `### Extraction orientation\n\n- Mode: ${step.orientation.extractionMode}\n- Notice: ${step.orientation.notice}${step.orientation.sourceLocations.length ? `\n- Indexed source locations: ${step.orientation.sourceLocations.join("; ")}` : ""}${step.orientation.captions.length ? `\n- Caption coverage: ${step.orientation.captions.join("; ")}` : ""}`
        : undefined,
      step.output?.scanObservations
        ? `### Scan observations\n\n- Abstract signal: ${step.output.scanObservations.abstractSignal}\n- Figure/table signals: ${bullets(step.output.scanObservations.figureTableSignals)}\n- Open questions: ${bullets(step.output.scanObservations.openQuestions)}`
        : undefined,
      step.output?.researchQuestion
        ? `### Research question\n\n- Question: ${step.output.researchQuestion.question}\n- Problem: ${step.output.researchQuestion.problem}\n- Setting: ${step.output.researchQuestion.setting}\n- Claimed gap: ${step.output.researchQuestion.claimedGap}\n- Reader comparison: ${step.output.researchQuestion.readerComparison}`
        : undefined,
      step.output?.evidenceConclusion
        ? `### Independent evidence conclusion\n\n- Supports: ${bullets(step.output.evidenceConclusion.supports)}\n- Does not support: ${bullets(step.output.evidenceConclusion.doesNotSupport)}\n- Strongest result: ${step.output.evidenceConclusion.strongestResult}\n- Weakest result: ${step.output.evidenceConclusion.weakestResult}\n- Confidence: ${step.output.evidenceConclusion.confidence}`
        : undefined,
      step.output?.authorComparison
        ? `### Author comparison\n\n- Author conclusion: ${step.output.authorComparison.authorConclusionStatus}${step.output.authorComparison.unavailableReason ? ` — ${step.output.authorComparison.unavailableReason}` : ""}\n- Agreements: ${bullets(step.output.authorComparison.agreements)}\n- Reader omissions: ${bullets(step.output.authorComparison.readerOmissions)}\n- Stronger author claims: ${bullets(step.output.authorComparison.strongerAuthorClaims)}\n- Author caveats: ${bullets(step.output.authorComparison.authorCaveats)}\n- Interpretive differences: ${bullets(step.output.authorComparison.interpretiveDifferences)}`
        : undefined,
      step.output?.methodComparison
        ? `### Reader vs Paper Pilot method comparison\n\n- Agreements: ${bullets(step.output.methodComparison.agreements)}\n- Differences: ${bullets(step.output.methodComparison.differences)}\n- Unresolved: ${bullets(step.output.methodComparison.unresolved)}`
        : undefined,
      step.output?.finalSynthesis
        ? `### Final synthesis\n\n- Strongest supported claim: ${step.output.finalSynthesis.strongestSupportedClaim}\n- Key residual uncertainty: ${step.output.finalSynthesis.keyResidualUncertainty}\n- Next reading or experiment: ${step.output.finalSynthesis.nextReadingOrExperiment}`
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
  const reviewerPapers = params.state.steps.flatMap((step) =>
    step.discovery
      ? [
          ...step.discovery.verifiedMain,
          ...step.discovery.otherPeerReviewed,
          ...step.discovery.noveltyRadar,
        ].filter((paper) => paper.reviewInsight)
      : [],
  );
  const reviewerPerspective = reviewerPapers.length
    ? [
        "## Reviewer perspective (public sources)",
        "This optional perspective was added only after the reader-first gate. It is separate from reader judgment, paper claims, and Paper Pilot inference.",
        ...reviewerPapers.map((paper) => {
          const insight = paper.reviewInsight!;
          return [
            `### ${paper.title}`,
            `- Valued strengths: ${insight.valuedStrengths.join("; ") || "Not recorded"}`,
            `- Concerns: ${insight.concerns.join("; ") || "Not recorded"}`,
            `- Reviewer priorities: ${insight.reviewerPriorities.join("; ") || "Not recorded"}`,
            `- Disagreements: ${insight.disagreements.join("; ") || "Not recorded"}`,
            insight.authorResponseContext
              ? `- Author response / revision: ${insight.authorResponseContext}`
              : undefined,
            insight.decisionContext
              ? `- Decision context: ${insight.decisionContext}`
              : undefined,
            `- Limitations: ${insight.limitations.join("; ") || "Not recorded"}`,
            ...insight.sourceURLs.map(
              (url) => `- Public review source: ${url}`,
            ),
          ]
            .filter(Boolean)
            .join("\n");
        }),
      ].join("\n\n")
    : undefined;

  return [
    `# Critical Read: ${params.paperTitle}`,
    "This report preserves the reader's independent judgments separately from Paper Pilot synthesis. Public-review insights are not used inside the seven-step analysis; a permitted reviewer perspective may appear afterward as a distinct section.",
    ...sections,
    reviewerPerspective,
  ]
    .filter(Boolean)
    .join("\n\n");
}
