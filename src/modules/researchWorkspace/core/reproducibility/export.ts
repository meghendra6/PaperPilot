// @ts-nocheck -- Ported feature core is guarded by strict runtime parsers.
import * as readiness_1 from "./readiness";
function exportReproducibilityMarkdown(report) {
  const readiness = (0, readiness_1.calculateReproducibilityReadiness)(report);
  const lines = [
    "# Reproducibility Audit",
    "",
    report.summary,
    "",
    `Readiness: **${readiness.label} (${Math.round(readiness.score * 100)}%)**`,
    "",
    "## Artifacts",
    "",
  ];
  for (const a of report.artifacts)
    lines.push(
      `- **${a.label}** (${a.kind}): ${a.availability}${a.value ? ` — ${a.value}` : ""}${a.version ? ` (${a.version})` : ""}${a.url ? ` — ${a.url}` : ""}`,
    );
  lines.push("", "## Blockers", "");
  if (!report.blockers.length) lines.push("- None identified.");
  else
    for (const b of report.blockers)
      lines.push(
        `- **${b.severity.toUpperCase()}** ${b.description} — Mitigation: ${b.mitigation}`,
      );
  lines.push("", "## Minimal reproduction steps", "");
  report.minimalReproductionSteps.forEach((s, i) =>
    lines.push(`${i + 1}. ${s}`),
  );
  if (report.verificationCommands.length) {
    lines.push(
      "",
      "## Verification commands",
      "",
      "```bash",
      ...report.verificationCommands,
      "```",
    );
  }
  return lines.join("\n");
}

export {
  exportReproducibilityMarkdown,
  exportReproducibilityMarkdown as reproducibilityReportToMarkdown,
};
