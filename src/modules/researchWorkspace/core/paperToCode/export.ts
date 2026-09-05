function exportPaperToCodeMarkdown(
  report: Pick<
    ReturnType<typeof import("./parser").parsePaperToCodeResponse>,
    | "objective"
    | "inputs"
    | "outputs"
    | "pseudocode"
    | "trace"
    | "invariants"
    | "ambiguities"
    | "minimalReproduction"
    | "paperCodeDivergences"
  > & {
    complexity: {
      compute: string;
      memory: string;
      communication?: string;
      bottleneck?: string;
    };
    tests: { name: string; purpose: string; expected?: string }[];
  },
) {
  const lines = [
    "# Paper-to-Code Specification",
    "",
    report.objective,
    "",
    "## Inputs and outputs",
    "",
    `- Inputs: ${report.inputs.length ? report.inputs.join(", ") : "Not specified"}`,
    `- Outputs: ${report.outputs.length ? report.outputs.join(", ") : "Not specified"}`,
    "",
    "## Pseudocode",
    "",
    "```text",
    report.pseudocode,
    "```",
    "",
    "## Execution trace",
    "",
  ];
  for (const step of report.trace) {
    lines.push(
      `### ${step.order}. ${step.name}`,
      `- Operation: ${step.operation}`,
      `- Input shapes: ${step.inputShapes.join(", ") || "unspecified"}`,
      `- Output shapes: ${step.outputShapes.join(", ") || "unspecified"}`,
      `- State reads: ${step.stateReads.join(", ") || "none stated"}`,
      `- State writes: ${step.stateWrites.join(", ") || "none stated"}`,
      `- Memory/communication: ${step.memoryOrCommunication.join(", ") || "none stated"}`,
      "",
    );
  }
  lines.push("## Invariants", "");
  if (!report.invariants.length) lines.push("- None extracted.");
  for (const invariant of report.invariants)
    lines.push(`- **${invariant.statement}** — ${invariant.consequence}`);
  lines.push(
    "",
    "## Complexity",
    "",
    `- Compute: ${report.complexity.compute}`,
    `- Memory: ${report.complexity.memory}`,
  );
  if (report.complexity.communication)
    lines.push(`- Communication: ${report.complexity.communication}`);
  if (report.complexity.bottleneck)
    lines.push(`- Bottleneck: ${report.complexity.bottleneck}`);
  lines.push("", "## Implementation ambiguities", "");
  if (!report.ambiguities.length) lines.push("- None extracted.");
  for (const ambiguity of report.ambiguities)
    lines.push(
      `- **${ambiguity.question}** (${ambiguity.impact}) — ${ambiguity.proposedExperiment}`,
    );
  lines.push("", "## Minimal reproduction", "");
  report.minimalReproduction.forEach((step) => lines.push(`- [ ] ${step}`));
  lines.push("", "## Validation tests", "");
  report.tests.forEach((test) =>
    lines.push(
      `- [ ] **${test.name}** — ${test.purpose}${test.expected ? `; expected: ${test.expected}` : ""}`,
    ),
  );
  if (report.paperCodeDivergences.length) {
    lines.push("", "## Paper/code divergences", "");
    for (const divergence of report.paperCodeDivergences)
      lines.push(
        `- **${divergence.area}** — paper: ${divergence.paperStatement}; code: ${divergence.codeBehavior}; impact: ${divergence.impact}`,
      );
  }
  return lines.join("\n");
}

export {
  exportPaperToCodeMarkdown,
  exportPaperToCodeMarkdown as paperToCodeReportToMarkdown,
};
