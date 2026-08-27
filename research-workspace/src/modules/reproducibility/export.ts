"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.reproducibilityReportToMarkdown = void 0;
exports.exportReproducibilityMarkdown = exportReproducibilityMarkdown;
const readiness_1 = __require("src/modules/reproducibility/readiness.ts");
function exportReproducibilityMarkdown(report) {
    const readiness = (0, readiness_1.calculateReproducibilityReadiness)(report);
    const lines = ["# Reproducibility Audit", "", report.summary, "", `Readiness: **${readiness.label} (${Math.round(readiness.score * 100)}%)**`, "", "## Artifacts", ""];
    for (const a of report.artifacts)
        lines.push(`- **${a.label}** (${a.kind}): ${a.availability}${a.value ? ` — ${a.value}` : ""}${a.version ? ` (${a.version})` : ""}${a.url ? ` — ${a.url}` : ""}`);
    lines.push("", "## Blockers", "");
    if (!report.blockers.length)
        lines.push("- None identified.");
    else
        for (const b of report.blockers)
            lines.push(`- **${b.severity.toUpperCase()}** ${b.description} — Mitigation: ${b.mitigation}`);
    lines.push("", "## Minimal reproduction steps", "");
    report.minimalReproductionSteps.forEach((s, i) => lines.push(`${i + 1}. ${s}`));
    if (report.verificationCommands.length) {
        lines.push("", "## Verification commands", "", "```bash", ...report.verificationCommands, "```");
    }
    return lines.join("\n");
}
exports.reproducibilityReportToMarkdown = exportReproducibilityMarkdown;