import {
  createCriticalReadLocalizer,
  getCriticalReadStepCopy,
} from "./localization";
import type { CriticalReadState } from "./types";
import type { DiscoveredPaper } from "../discovery/types";

function formatBullets(values: string[], empty = "Not recorded") {
  return values.length
    ? values.map((value) => `- ${value}`).join("\n")
    : `- ${empty}`;
}

export function buildCriticalReadReportMarkdown(params: {
  paperTitle: string;
  state: CriticalReadState;
  responseLanguage?: unknown;
}) {
  const t = createCriticalReadLocalizer(params.responseLanguage);
  const bullets = (values: string[]) =>
    formatBullets(values, t("Not recorded"));
  const sections = params.state.steps.map((step) => {
    const discovery = step.discovery;
    const discoveryPaper = (lane: string, paper: DiscoveredPaper) =>
      [
        `  - [${lane}] ${paper.title} — ${paper.relevanceReason}`,
        `    - ${t("Publication class")}: ${t(paper.publicationClass)}; ${t("confidence")}: ${t(paper.evidenceConfidence)}`,
        ...paper.publicationEvidence.map(
          (entry) =>
            `    - ${t("Evidence")} (${entry.supports.map((support) => t(support)).join(", ")}): ${entry.url}`,
        ),
      ].join("\n");
    const discovered = discovery
      ? [
          `- ${t("Verified main-conference papers")}: ${discovery.verifiedMain.length}`,
          `- ${t("Other peer-reviewed work")}: ${discovery.otherPeerReviewed.length}`,
          `- ${t("Frontier / novelty radar")}: ${discovery.noveltyRadar.length}`,
          ...discovery.verifiedMain.map((paper) =>
            discoveryPaper(t("Verified main"), paper),
          ),
          ...discovery.otherPeerReviewed.map((paper) =>
            discoveryPaper(t("Other peer-reviewed"), paper),
          ),
          ...discovery.noveltyRadar.map((paper) =>
            discoveryPaper(t("Novelty radar"), paper),
          ),
          ...discovery.limitations.map(
            (limitation) => `  - ${t("Limitation")}: ${limitation}`,
          ),
        ].join("\n")
      : undefined;
    return [
      `## ${step.id}. ${getCriticalReadStepCopy(step.id, params.responseLanguage).title}`,
      step.readerInput
        ? `### ${t("Reader assessment")}\n\n${step.readerInput}`
        : undefined,
      step.output
        ? `### ${t("Paper Pilot synthesis")}\n\n${step.output.summary}`
        : undefined,
      step.orientation
        ? `### ${t("Extraction orientation")}\n\n- ${t("Mode")}: ${t(step.orientation.extractionMode)}\n- ${t("Notice")}: ${t(step.orientation.notice)}${step.orientation.sourceLocations.length ? `\n- ${t("Indexed source locations")}: ${step.orientation.sourceLocations.join("; ")}` : ""}${step.orientation.captions.length ? `\n- ${t("Caption coverage")}: ${step.orientation.captions.join("; ")}` : ""}`
        : undefined,
      step.output?.scanObservations
        ? `### ${t("Scan observations")}\n\n- ${t("Abstract signal")}: ${step.output.scanObservations.abstractSignal}\n- ${t("Figure/table signals")}: ${bullets(step.output.scanObservations.figureTableSignals)}\n- ${t("Open questions")}: ${bullets(step.output.scanObservations.openQuestions)}`
        : undefined,
      step.output?.researchQuestion
        ? `### ${t("Research question")}\n\n- ${t("Question")}: ${step.output.researchQuestion.question}\n- ${t("Problem")}: ${step.output.researchQuestion.problem}\n- ${t("Setting")}: ${step.output.researchQuestion.setting}\n- ${t("Claimed gap")}: ${step.output.researchQuestion.claimedGap}\n- ${t("Reader comparison")}: ${step.output.researchQuestion.readerComparison}`
        : undefined,
      step.output?.evidenceConclusion
        ? `### ${t("Independent evidence conclusion")}\n\n- ${t("Supports")}: ${bullets(step.output.evidenceConclusion.supports)}\n- ${t("Does not support")}: ${bullets(step.output.evidenceConclusion.doesNotSupport)}\n- ${t("Strongest result")}: ${step.output.evidenceConclusion.strongestResult}\n- ${t("Weakest result")}: ${step.output.evidenceConclusion.weakestResult}\n- ${t("Confidence")}: ${t(step.output.evidenceConclusion.confidence)}`
        : undefined,
      step.output?.authorComparison
        ? `### ${t("Author comparison")}\n\n- ${t("Author conclusion")}: ${t(step.output.authorComparison.authorConclusionStatus)}${step.output.authorComparison.unavailableReason ? ` — ${step.output.authorComparison.unavailableReason}` : ""}\n- ${t("Agreements")}: ${bullets(step.output.authorComparison.agreements)}\n- ${t("Reader omissions")}: ${bullets(step.output.authorComparison.readerOmissions)}\n- ${t("Stronger author claims")}: ${bullets(step.output.authorComparison.strongerAuthorClaims)}\n- ${t("Author caveats")}: ${bullets(step.output.authorComparison.authorCaveats)}\n- ${t("Interpretive differences")}: ${bullets(step.output.authorComparison.interpretiveDifferences)}`
        : undefined,
      step.output?.methodComparison
        ? `### ${t("Reader vs Paper Pilot method comparison")}\n\n- ${t("Agreements")}: ${bullets(step.output.methodComparison.agreements)}\n- ${t("Differences")}: ${bullets(step.output.methodComparison.differences)}\n- ${t("Unresolved")}: ${bullets(step.output.methodComparison.unresolved)}`
        : undefined,
      step.output?.finalSynthesis
        ? `### ${t("Final synthesis")}\n\n- ${t("Strongest supported claim")}: ${step.output.finalSynthesis.strongestSupportedClaim}\n- ${t("Key residual uncertainty")}: ${step.output.finalSynthesis.keyResidualUncertainty}\n- ${t("Next reading or experiment")}: ${step.output.finalSynthesis.nextReadingOrExperiment}`
        : undefined,
      step.output?.items.length
        ? `### ${t("Findings")}\n\n${bullets(step.output.items)}`
        : undefined,
      step.output?.sourceLocators.length
        ? `### ${t("Source locations")}\n\n${bullets(step.output.sourceLocators)}`
        : undefined,
      step.output?.limitations.length
        ? `### ${t("Limits and uncertainty")}\n\n${bullets(step.output.limitations)}`
        : undefined,
      step.output?.methodChecks?.length
        ? `### ${t("Method checks")}\n\n${step.output.methodChecks
            .map(
              (check) =>
                `- **${check.area} — ${t(check.status)}**: ${check.finding}${check.sourceLocator ? ` (${check.sourceLocator})` : ""}`,
            )
            .join("\n")}`
        : undefined,
      step.output?.provenance?.some((entry) => entry.source === "paper_claim")
        ? `### ${t("Paper claims")}\n\n${bullets(
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
        ? `### ${t("Agent inference")}\n\n${bullets(
            step.output.provenance
              .filter((entry) => entry.source === "agent_inference")
              .map(
                (entry) =>
                  `${entry.text}${entry.sourceLocator ? ` (${entry.sourceLocator})` : ""}`,
              ),
          )}`
        : undefined,
      step.output?.alternatives?.length
        ? `### ${t("Alternative explanations and tests")}\n\n${step.output.alternatives
            .map(
              (alternative) =>
                `- **${t("Alternative")}:** ${alternative.explanation}\n  - ${t("Could explain")}: ${alternative.explainedResult}\n  - ${t("Challenges")}: ${alternative.challengedAssumption}\n  - ${t("Discriminating test")}: ${alternative.discriminatingExperiment}\n  - ${t("Addressed by paper")}: ${t(alternative.addressedByPaper)}${alternative.sourceLocator ? ` (${alternative.sourceLocator})` : ""}`,
            )
            .join("\n")}`
        : undefined,
      discovered ? `### ${t("Discovery map")}\n\n${discovered}` : undefined,
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
        `## ${t("Reviewer perspective (public sources)")}`,
        t(
          "This optional perspective was added only after the reader-first gate. It is separate from reader judgment, paper claims, and Paper Pilot inference.",
        ),
        ...reviewerPapers.map((paper) => {
          const insight = paper.reviewInsight!;
          return [
            `### ${paper.title}`,
            `- ${t("Valued strengths")}: ${insight.valuedStrengths.join("; ") || t("Not recorded")}`,
            `- ${t("Concerns")}: ${insight.concerns.join("; ") || t("Not recorded")}`,
            `- ${t("Reviewer priorities")}: ${insight.reviewerPriorities.join("; ") || t("Not recorded")}`,
            `- ${t("Disagreements")}: ${insight.disagreements.join("; ") || t("Not recorded")}`,
            insight.authorResponseContext
              ? `- ${t("Author response / revision")}: ${insight.authorResponseContext}`
              : undefined,
            insight.decisionContext
              ? `- ${t("Decision context")}: ${insight.decisionContext}`
              : undefined,
            `- ${t("Limitations")}: ${insight.limitations.join("; ") || t("Not recorded")}`,
            ...insight.sourceURLs.map(
              (url) => `- ${t("Public review source")}: ${url}`,
            ),
          ]
            .filter(Boolean)
            .join("\n");
        }),
      ].join("\n\n")
    : undefined;

  return [
    `# ${t("Critical Read")}: ${params.paperTitle}`,
    t(
      "This report preserves the reader's independent judgments separately from Paper Pilot synthesis. Public-review insights are not used inside the seven-step analysis; a permitted reviewer perspective may appear afterward as a distinct section.",
    ),
    ...sections,
    reviewerPerspective,
  ]
    .filter(Boolean)
    .join("\n\n");
}
